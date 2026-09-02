/**
 * OLYCITY LIVE — League of Legends
 *
 * Utilise l'API locale du League Client (LCU), authentifiée via le lockfile
 * du client — même principe que le lockfile Riot Client pour Valorant.
 *
 * Le port 2999 (Live Client Data API, exposé par le process de jeu lui-même)
 * ne répond plus sur les clients récents protégés par Vanguard : il n'est donc
 * pas utilisable. Le LCU, lui, est exposé par LeagueClientUx (l'appli de lobby,
 * non protégée par Vanguard) et reste accessible pendant toute la partie.
 *
 * Le champion et le matchup ne sont disponibles que pendant la sélection de
 * champion (endpoint /lol-champ-select/v1/session, qui disparaît une fois en
 * jeu) — on les capture à ce moment-là et on les garde en cache pour les
 * pousser une fois la game lancée.
 *
 * En fin de game, on capture un résumé (KDA, CS, items, victoire/défaite,
 * variation de rang) via /lol-end-of-game/v1/eog-stats-block. Le format exact
 * de cet endpoint n'est pas officiellement documenté par Riot — l'extraction
 * est défensive (plusieurs chemins essayés) et le payload brut est loggé pour
 * pouvoir ajuster si le format diffère de ce qui est attendu ici.
 */
const https = require('https');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { historyGames, soloRankFromStats, summarizeSoloQueue } = require('./lol-profile-utils');
const { fetchOpggSoloProfile } = require('./opgg-profile');
const { lolHistorySummary } = require('./history-index');

const HEARTBEAT_MS = 20000;
// Phases actives d'une game : GameStart = chargement, InProgress = en jeu, Reconnect = reco après un crash.
const ACTIVE_PHASES = new Set(['GameStart', 'InProgress', 'Reconnect']);
// Phases de fin de partie où on tente de récupérer le résumé avant de considérer la session terminée.
const POST_GAME_PHASES = new Set(['WaitingForStats', 'PreEndOfGame', 'EndOfGame']);
const POST_GAME_TIMEOUT_MS = 45000;
// Tolérance avant de considérer le client/la game injoignable — un poll raté isolé
// (timeout réseau, LCU momentanément occupé) ne doit pas déclencher une fausse fin de game.
const MAX_MISSED_POLLS = 3;
const PROFILE_REFRESH_MS = 15 * 60 * 1000;
const PROFILE_HISTORY_PAGE_SIZE = 100;
const PROFILE_HISTORY_LIMIT = 500;
const OPGG_PROFILE_REFRESH_MS = 6 * 60 * 60 * 1000;

const RANKED_QUEUE_TYPES = { 420: 'RANKED_SOLO_5x5', 440: 'RANKED_FLEX_SR' };
const ROSTER_ACCOUNTS = [
  { riotId: 'phileas fogg#OLY', mainRole: 'support' },
  { riotId: 'FakePlasticTrees#1706', mainRole: 'top' },
  { riotId: 'NoWaY#alone', mainRole: 'adc' },
  { riotId: 'RayBaz#OLY', mainRole: 'top' },
  { riotId: 'M A I R#LGND', mainRole: 'mid' },
  { riotId: 'Stupefiant#NOXUS', mainRole: '' },
];

async function syncRosterProfiles({ putFB, fetchProfile = fetchOpggSoloProfile, scriptVersion, onError = () => {} }) {
  let updated = 0;
  const failures = [];
  for (const account of ROSTER_ACCOUNTS) {
    try {
      const profile = await fetchProfile(account.riotId, 'euw');
      if (account.mainRole) {
        profile.soloQueue.mainRole = account.mainRole;
        profile.soloQueue.mainRoleSource = 'season-champions';
      }
      await putFB(`live/lolProfiles/${safeFirebaseKey(account.riotId)}`, {
        ...profile,
        updatedAt: Date.now(),
        scriptVersion,
      });
      updated += 1;
    } catch (error) {
      failures.push(account.riotId);
      onError(account.riotId, error);
    }
  }
  return { updated, failures };
}

// Seules les files classées (Solo/Duo, Flex) sont trackées : pas de notif, de
// pari ni de stats pour les normales, ARAM, Practice Tool, Co-op vs IA, etc.
function isRankedLolQueue(queueId) {
  return Object.prototype.hasOwnProperty.call(RANKED_QUEUE_TYPES, Number(queueId));
}

const LOCKFILE_PATHS = [
  path.join('C:', 'Riot Games', 'League of Legends', 'lockfile'),
  path.join(process.env['ProgramFiles(x86)'] || '', 'Riot Games', 'League of Legends', 'lockfile'),
  path.join(process.env.ProgramFiles || '', 'Riot Games', 'League of Legends', 'lockfile'),
];

// Journal persistant à côté du script — sert à diagnostiquer à distance
// pourquoi le client League n'est pas détecté sur un poste donné, sans avoir
// besoin d'une console visible (le launcher démarre le process minimisé).
const DEBUG_LOG_PATH = path.join(__dirname, 'olycity-live.log');
// Contrairement à olycity.log (tronqué au démarrage par index.js), ce journal
// n'avait aucune limite : sur un poste sans League, il grossissait sans fin.
const MAX_DEBUG_LOG_BYTES = 1024 * 1024;

function writeDebugLog(message) {
  try {
    if (fs.existsSync(DEBUG_LOG_PATH) && fs.statSync(DEBUG_LOG_PATH).size > MAX_DEBUG_LOG_BYTES) {
      fs.truncateSync(DEBUG_LOG_PATH, 0);
    }
    fs.appendFileSync(DEBUG_LOG_PATH, `[${new Date().toLocaleTimeString('fr-FR')}] ${message}\n`);
  } catch {}
}

function readLockfileFromDisk() {
  for (const lockPath of LOCKFILE_PATHS) {
    try {
      if (!fs.existsSync(lockPath)) continue;
      const [, , port, password, protocol] = fs.readFileSync(lockPath, 'utf8').trim().split(':');
      if (port && password) return { port: Number(port), password, protocol: protocol || 'https' };
    } catch {}
  }
  return null;
}

// Espacement des sondes PowerShell après échecs consécutifs. La lecture disque
// reste tentée à chaque poll (elle ne coûte qu'un existsSync), mais le repli
// par process lance un powershell.exe : à 3 s de poll, un poste sans League en
// démarrait ~28 800 par jour, en tâche de fond, sur une machine de jeu. La
// première sonde reste immédiate — un League déjà lancé est détecté aussitôt.
const PROCESS_PROBE_BACKOFF_MS = [0, 15_000, 30_000, 60_000, 120_000, 300_000];

function nextProbeDelay(misses) {
  const index = Math.min(Math.max(0, misses), PROCESS_PROBE_BACKOFF_MS.length - 1);
  return PROCESS_PROBE_BACKOFF_MS[index];
}

/** La sonde process vaut-elle son coût maintenant ? */
function shouldProbeProcess(state = {}, now = Date.now()) {
  const { misses = 0, lastProbeAt = 0 } = state;
  if (!lastProbeAt) return true;
  return now - lastProbeAt >= nextProbeDelay(misses);
}

// Filet de secours si League est installé ailleurs que les emplacements par défaut :
// on retrouve port + token dans la ligne de commande du process LeagueClientUx.exe.
// Timeout généreux (6s) : une requête WMI peut être lente sur un poste chargé
// (jeu + script en tâche de fond), un timeout trop court fait échouer le filet
// de secours silencieusement à chaque poll.
function readLockfileFromProcess() {
  try {
    const output = execFileSync('powershell.exe', [
      '-NoProfile', '-Command',
      "(Get-CimInstance Win32_Process -Filter \"Name='LeagueClientUx.exe'\").CommandLine",
    ], { timeout: 6000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' });
    // Pas de log ici : l'absence de League est le cas NORMAL, et cette ligne
    // n'était pas soumise à l'étranglement de readLockfile() plus bas — elle
    // écrivait donc une ligne par poll. Le compteur de tentatives suffit.
    if (!output || !output.trim()) return null;
    const portMatch = output.match(/--app-port=(\d+)/);
    const tokenMatch = output.match(/--remoting-auth-token=([\w-]+)/);
    if (portMatch && tokenMatch) return { port: Number(portMatch[1]), password: tokenMatch[1], protocol: 'https' };
    writeDebugLog(`[lockfile] Process LeagueClientUx.exe trouvé mais port/token non extraits — commandLine="${output.trim().slice(0, 200)}"`);
  } catch (error) {
    writeDebugLog(`[lockfile] Échec requête PowerShell — ${error.message}`);
  }
  return null;
}

let lockfileMissCount = 0;
const processProbe = { misses: 0, lastProbeAt: 0 };

function readLockfile(now = Date.now()) {
  // Toujours tenté : un existsSync par poll est négligeable.
  const fromDisk = readLockfileFromDisk();
  if (fromDisk) {
    lockfileMissCount = 0;
    processProbe.misses = 0;
    processProbe.lastProbeAt = 0;
    return fromDisk;
  }

  // Le repli process, lui, est espacé progressivement.
  if (shouldProbeProcess(processProbe, now)) {
    processProbe.lastProbeAt = now;
    const fromProcess = readLockfileFromProcess();
    if (fromProcess) {
      lockfileMissCount = 0;
      processProbe.misses = 0;
      processProbe.lastProbeAt = 0;
      return fromProcess;
    }
    processProbe.misses += 1;
  }

  lockfileMissCount++;
  // Log seulement de temps en temps (1er échec, puis ~toutes les minutes à 3s/poll) pour ne pas noyer le fichier.
  if (lockfileMissCount === 1 || lockfileMissCount % 20 === 0) {
    writeDebugLog(`[lockfile] Non trouvé sur disque (${LOCKFILE_PATHS.join(' | ')}) ni via process — tentative #${lockfileMissCount}`);
  }
  return null;
}

function lcuGet(lock, endpoint) {
  return new Promise(resolve => {
    const auth = Buffer.from(`riot:${lock.password}`).toString('base64');
    const r = https.get({
      hostname: '127.0.0.1', port: lock.port, path: endpoint,
      headers: { Authorization: `Basic ${auth}` },
      agent: new https.Agent({ rejectUnauthorized: false }),
      timeout: 2000,
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve({ ok: res.statusCode === 200, data: JSON.parse(d) }); }
        catch { resolve({ ok: res.statusCode === 200, data: d }); }
      });
    });
    r.on('error', () => resolve({ ok: false }));
    r.on('timeout', () => { r.destroy(); resolve({ ok: false }); });
  });
}

// Requête HTTPS simple vers un hôte externe avec certificat valide (Data Dragon).
function httpsGetJson(hostname, path) {
  return new Promise(resolve => {
    const r = https.get({ hostname, path, timeout: 5000 }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve({ ok: res.statusCode === 200, data: JSON.parse(d) }); }
        catch { resolve({ ok: false }); }
      });
    });
    r.on('error', () => resolve({ ok: false }));
    r.on('timeout', () => { r.destroy(); resolve({ ok: false }); });
  });
}

let ddragonVersion = null;
async function ensureDdragonVersion() {
  if (ddragonVersion) return ddragonVersion;
  const res = await httpsGetJson('ddragon.leagueoflegends.com', '/api/versions.json');
  ddragonVersion = (res.ok && res.data?.[0]) || null;
  return ddragonVersion;
}

// Cache des champions Data Dragon (id numérique -> nom + image), chargé une fois.
let championById = null;
async function ensureChampionData() {
  if (championById) return championById;
  try {
    const version = await ensureDdragonVersion();
    if (!version) return {};
    const champRes = await httpsGetJson('ddragon.leagueoflegends.com', `/cdn/${version}/data/en_US/champion.json`);
    if (!champRes.ok || !champRes.data?.data) return {};
    const map = {};
    Object.values(champRes.data.data).forEach(champ => {
      map[Number(champ.key)] = {
        name: champ.name,
        image: `https://ddragon.leagueoflegends.com/cdn/${version}/img/champion/${champ.image.full}`,
      };
    });
    championById = map;
    return championById;
  } catch {
    return {};
  }
}

// Cache des items Data Dragon (id numérique -> nom + image), chargé une fois.
let itemById = null;
async function ensureItemData() {
  if (itemById) return itemById;
  try {
    const version = await ensureDdragonVersion();
    if (!version) return {};
    const itemRes = await httpsGetJson('ddragon.leagueoflegends.com', `/cdn/${version}/data/en_US/item.json`);
    if (!itemRes.ok || !itemRes.data?.data) return {};
    const map = {};
    Object.entries(itemRes.data.data).forEach(([id, item]) => {
      map[Number(id)] = { name: item.name, image: `https://ddragon.leagueoflegends.com/cdn/${version}/img/item/${id}.png` };
    });
    itemById = map;
    return itemById;
  } catch {
    return {};
  }
}

// Les clés Firebase RTDB interdisent . # $ [ ] / — putFB ne fait aucun
// encodage d'URL, donc il faut substituer ces caractères directement.
function safeFirebaseKey(str) {
  return String(str).replace(/[.#$[\]/]/g, '_');
}

/**
 * Clé d'une entrée d'historique LoL. Le nom du joueur en fait partie, sinon
 * deux membres du roster dans la MÊME game écrivent sous la même clé et le
 * second efface le premier — la game disparaît de l'historique de l'un des
 * deux, avec son champion, son KDA et son résultat.
 *
 * Une entrée d'historique LoL décrit la partie D'UN joueur (voir
 * lolHistorySummary), pas la partie elle-même : deux entrées pour une game
 * jouée à deux est la forme correcte, pas un doublon.
 *
 * Les entrées écrites avant ce correctif gardent leur ancienne clé. Rien à
 * migrer : la lecture filtre sur playerName, pas sur le format de la clé.
 */
function lolHistoryKey(matchId, playerName, startedAt) {
  const match = matchId || String(startedAt || Date.now());
  // Sans nom de joueur exploitable on retombe sur l'ancienne clé : mieux vaut
  // le risque d'écrasement que des entrées « match-undefined » indistinctes.
  return playerName
    ? safeFirebaseKey(`${match}-${playerName}`)
    : safeFirebaseKey(match);
}

function formatDuration(totalSeconds) {
  const seconds = Math.max(0, Math.round(totalSeconds || 0));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

async function fetchRank(lock, queueId) {
  const queueType = RANKED_QUEUE_TYPES[queueId];
  if (!queueType) return null;
  const res = await lcuGet(lock, '/lol-ranked/v1/current-ranked-stats');
  if (!res.ok) return null;
  const entry = (res.data?.queues || []).find(q => q.queueType === queueType);
  if (!entry) return null;
  const wins = Number(entry.wins ?? entry.winCount ?? 0);
  const losses = Number(entry.losses ?? entry.lossCount ?? 0);
  const games = wins + losses;
  return {
    tier: entry.tier || '', division: entry.division || '', lp: entry.leaguePoints ?? null,
    wins, losses, games, winRate: games ? Math.round((wins / games) * 100) : 0,
  };
}

const opggProfileCache = new Map();
async function cachedOpggProfile(riotId, region) {
  const key = `${String(region || 'euw').toLowerCase()}:${String(riotId).toLowerCase()}`;
  const cached = opggProfileCache.get(key);
  if (cached && Date.now() - cached.fetchedAt < OPGG_PROFILE_REFRESH_MS) return cached.profile;
  const profile = await fetchOpggSoloProfile(riotId, region || 'euw');
  opggProfileCache.set(key, { fetchedAt: Date.now(), profile });
  return profile;
}

async function fetchSoloQueueProfile(lock, summoner, region = 'euw') {
  const ranked = await lcuGet(lock, '/lol-ranked/v1/current-ranked-stats');
  const rank = ranked.ok ? soloRankFromStats(ranked.data) : null;
  const collected = [];
  const seasonStart = new Date(new Date().getFullYear(), 0, 1).getTime();
  for (let begin = 0; begin < PROFILE_HISTORY_LIMIT; begin += PROFILE_HISTORY_PAGE_SIZE) {
    const end = begin + PROFILE_HISTORY_PAGE_SIZE - 1;
    const response = await lcuGet(lock, `/lol-match-history/v1/products/lol/current-summoner/matches?begIndex=${begin}&endIndex=${end}`);
    if (!response.ok) break;
    const batch = historyGames(response.data);
    if (!batch.length) break;
    collected.push(...batch);
    const oldest = Math.min(...batch.map(game => Number(game?.gameCreation ?? game?.gameCreationDate ?? game?.gameStartTimestamp ?? Date.now())));
    if (batch.length < PROFILE_HISTORY_PAGE_SIZE || oldest < seasonStart) break;
  }
  const champions = await ensureChampionData();
  const recent = summarizeSoloQueue(collected, summoner, champions, seasonStart);
  const riotId = summoner?.gameName && summoner?.tagLine ? `${summoner.gameName}#${summoner.tagLine}` : '';
  try {
    const season = await cachedOpggProfile(riotId, region);
    return {
      rank: rank || season.rank,
      soloQueue: { ...season.soloQueue, roles: recent.roles, mainRole: recent.mainRole, mainRoleSource: recent.mainRole ? 'recent-games' : '' },
      topChampions: season.topChampions,
      source: season.source,
      seasonVerified: season.seasonVerified,
      seasonId: season.seasonId,
    };
  } catch {
    return { rank, soloQueue: recent, topChampions: recent.topChampions, source: 'lcu-recent', seasonVerified: false };
  }
}

// Extraction défensive du résumé de fin de game — le format exact de
// eog-stats-block n'est pas documenté officiellement par Riot.
function extractEndOfGameStats(data, myPuuid) {
  if (!data) return null;
  const local = data.localPlayer || data.player || null;
  const stats = local?.stats || local || {};

  const num = (...keys) => {
    for (const key of keys) {
      const value = stats[key];
      if (typeof value === 'number') return value;
    }
    return 0;
  };

  const kills = num('CHAMPIONS_KILLED', 'kills', 'championsKilled');
  const deaths = num('NUM_DEATHS', 'deaths');
  const assists = num('ASSISTS', 'assists');
  const cs = num('MINIONS_KILLED', 'minionsKilled') + num('NEUTRAL_MINIONS_KILLED', 'neutralMinionsKilled');
  const level = num('LEVEL', 'level') || local?.level || 0;
  const gameLength = data.gameLength || data.gameDuration || 0;

  let win = null;
  const teams = Array.isArray(data.teams) ? data.teams : [];
  const myTeam = teams.find(t => t.isPlayerTeam || (Array.isArray(t.players) && t.players.some(p => p.puuid === myPuuid)));
  if (myTeam && typeof myTeam.won === 'boolean') win = myTeam.won;
  else if (typeof stats.WIN === 'boolean') win = stats.WIN;
  else if (typeof stats.WIN === 'string') win = stats.WIN.toLowerCase() === 'win';
  else if (typeof stats.WIN === 'number') win = stats.WIN === 1;

  let killParticipation = null;
  if (myTeam && Array.isArray(myTeam.players)) {
    const teamKills = myTeam.players.reduce((sum, p) => sum + (p.stats?.CHAMPIONS_KILLED ?? p.kills ?? 0), 0);
    if (teamKills > 0) killParticipation = Math.round(((kills + assists) / teamKills) * 100);
  }

  const rawItems = Array.isArray(local?.items) ? local.items.map(item => item.itemID ?? item.id ?? item)
    : [0, 1, 2, 3, 4, 5, 6].map(i => stats[`ITEM${i}`]).filter(Boolean);
  const itemIds = rawItems.map(Number).filter(id => id > 0);

  return { kills, deaths, assists, cs, level, gameLengthSeconds: gameLength, win, killParticipation, itemIds };
}

function createLolWatcher({
  putFB, getFB = async () => null, ts, scriptVersion, log = console.log,
  getIdentity = () => null, bindAccount = async () => {},
}) {
  let wasActive = false;
  let sessionKey = '';
  let matchStartedAt = 0;
  let lastHeartbeat = 0;
  let cachedLock = null;
  let cachedRegion = null;
  let champSelectMatchupChampionId = null;
  let champSelectPosition = null;
  let currentChampion = null;
  let currentQueueId = null;
  let currentQueueDescription = '';
  let currentMatchId = '';
  let currentRiotMatchId = '';
  let rankBefore = null;
  let postGameSince = 0;
  let capturedResult = null;
  let missedPolls = 0;
  let identityHeartbeat = 0;
  let identityKey = '';
  let identitySnapshot = null;
  let identityPhase = '';
  let profileHeartbeat = 0;
  let profileIdentityKey = '';
  let profileRefreshRunning = false;
  let rosterSyncCheckAt = 0;
  let rosterSyncRunning = false;
  let lastRosterSyncRequest = 0;

  async function handleRosterSyncRequest() {
    if (rosterSyncRunning) return;
    rosterSyncRunning = true;
    try {
      const request = await getFB('live/lolRosterSyncRequest');
      const requestedAt = Number(request?.requestedAt || 0);
      if (!requestedAt || requestedAt <= lastRosterSyncRequest || request?.status !== 'pending') return;
      const worker = identitySnapshot?.playerName || getIdentity()?.memberName || 'Script OLYCITY';
      const delay = [...worker].reduce((total, char) => total + char.charCodeAt(0), 0) % 2400;
      await new Promise(resolve => setTimeout(resolve, delay));
      const latest = await getFB('live/lolRosterSyncRequest');
      if (Number(latest?.requestedAt || 0) !== requestedAt || latest?.status !== 'pending') return;
      await putFB('live/lolRosterSyncRequest', { ...latest, status:'running', worker, startedAt:Date.now() });
      const claimed = await getFB('live/lolRosterSyncRequest');
      if (Number(claimed?.requestedAt || 0) !== requestedAt || claimed?.worker !== worker) return;
      lastRosterSyncRequest = requestedAt;
      const { updated, failures } = await syncRosterProfiles({
        putFB,
        scriptVersion,
        onError: (riotId, error) => writeDebugLog(`[lol-roster-sync] ${riotId}: ${error.message}`),
      });
      await putFB('live/lolRosterSyncRequest', {
        ...claimed,
        status: updated ? 'complete' : 'error',
        worker,
        updated,
        failures,
        completedAt: Date.now(),
        message: updated ? '' : 'Aucun profil n’a pu être actualisé.',
      });
      log(`[${ts()}] 🔵 LoL — roster synchronisé (${updated}/${ROSTER_ACCOUNTS.length})`);
    } catch (error) {
      writeDebugLog(`[lol-roster-sync] ${error.message}`);
    } finally {
      rosterSyncRunning = false;
    }
  }
  let eogLogged = false;

  function resetMatchState() {
    wasActive = false;
    sessionKey = '';
    matchStartedAt = 0;
    champSelectMatchupChampionId = null;
    champSelectPosition = null;
    currentChampion = null;
    currentQueueId = null;
    currentQueueDescription = '';
    currentMatchId = '';
    currentRiotMatchId = '';
    rankBefore = null;
    postGameSince = 0;
    capturedResult = null;
    eogLogged = false;
  }

  async function markInactive() {
    if (!wasActive || !sessionKey) return;
    const member = getIdentity();
    const endedSession = {
      active: false,
      ts: Date.now(),
      playerName: sessionKey,
      // Reporté aussi sur la fin de game : c'est ce message-là que le bot lit
      // pour poster le résumé et résoudre les paris.
      memberId: member?.memberId || '',
      member: member?.memberName || '',
      matchId: currentMatchId,
      result: capturedResult || null,
    };
    const history = capturedResult ? {
      key: lolHistoryKey(currentMatchId, sessionKey, matchStartedAt),
      value: {
        playerName: sessionKey,
        memberId: member?.memberId || '',
        member: member?.memberName || '',
        ts: Date.now(),
        ...capturedResult,
      },
    } : null;

    // Release local state before external writes so a slow backend cannot keep
    // the previous match alive or block detection of the next one.
    resetMatchState();
    await putFB(`live/lolSessions/${safeFirebaseKey(endedSession.playerName)}`, endedSession);
    // Historique persistant (une entrée par game) — sert à calculer les
    // winrates perso pour le moteur de cotes des paris.
    if (history) {
      await putFB(`live/lolHistory/${history.key}`, history.value);
      await putFB(`historyIndex/lol/${history.key}`, lolHistorySummary(history.value));
    }
  }

  async function ensureRegion() {
    if (cachedRegion) return cachedRegion;
    const res = await lcuGet(cachedLock, '/riotclient/region-locale');
    if (res.ok && res.data?.webRegion) cachedRegion = res.data.webRegion;
    return cachedRegion;
  }

  async function publishIdentity(summoner, phase) {
    const gameName = summoner?.gameName;
    const tagLine = summoner?.tagLine;
    const puuid = summoner?.puuid || '';
    if (!gameName || !tagLine) return;
    const playerName = `${gameName}#${tagLine}`;
    const key = safeFirebaseKey(playerName);
    const now = Date.now();
    if (key === identityKey && phase === identityPhase && now - identityHeartbeat < 60_000) return;
    if (identityKey && key !== identityKey) await markIdentityOffline();
    const region = await ensureRegion();
    identityKey = key;
    identityPhase = phase || '';
    identityHeartbeat = now;
    identitySnapshot = { playerName, puuid, region: region || '' };
    const member = getIdentity();
    // Le compte LoL courant est réenregistré sous le membre choisi à
    // l'installation — c'est ce qui garde le suivi valide après un renommage.
    await bindAccount({
      memberId: member?.memberId, memberName: member?.memberName,
      playerName, puuid, game: 'lol',
    }).catch(() => {});
    await putFB(`live/lolClients/${key}`, {
      ...identitySnapshot,
      game: 'lol',
      games: ['lol'],
      memberId: member?.memberId || '',
      member: member?.memberName || '',
      connected: true,
      phase: phase || 'Unknown',
      lastSeen: now,
      scriptVersion,
    });
    if (!profileRefreshRunning && (profileIdentityKey !== key || now - profileHeartbeat >= PROFILE_REFRESH_MS)) {
      profileIdentityKey = key;
      profileHeartbeat = now;
      profileRefreshRunning = true;
      const snapshot = { ...identitySnapshot };
      void fetchSoloQueueProfile(cachedLock, summoner, region)
        .then(profile => putFB(`live/lolProfiles/${key}`, {
          ...snapshot,
          rank: profile.rank,
          soloQueue: profile.soloQueue,
          topChampions: profile.topChampions,
          source: profile.source,
          seasonVerified: profile.seasonVerified,
          seasonId: profile.seasonId || null,
          updatedAt: now,
          scriptVersion,
        }))
        .catch(() => {})
        .finally(() => { profileRefreshRunning = false; });
    }
  }

  async function markIdentityOffline() {
    if (!identityKey || !identitySnapshot || identityPhase === 'Offline') return;
    await putFB(`live/lolClients/${identityKey}`, {
      ...identitySnapshot,
      game: 'lol',
      games: ['lol'],
      connected: false,
      phase: 'Offline',
      lastSeen: Date.now(),
      scriptVersion,
    });
    identityPhase = 'Offline';
  }

  // Pendant la sélection de champion : capture la lane (top/jungle/middle/bottom/utility,
  // valeurs telles que renvoyées par le LCU), le champion adverse au même poste
  // ("matchup") et le rang avant game. N'existe plus une fois en jeu, d'où le cache.
  async function updateChampSelectCache() {
    const res = await lcuGet(cachedLock, '/lol-champ-select/v1/session');
    if (!res.ok || !res.data) return;
    const mine = (res.data.myTeam || []).find(p => p.cellId === res.data.localPlayerCellId);
    if (mine?.assignedPosition) {
      champSelectPosition = mine.assignedPosition;
      const opponent = (res.data.theirTeam || []).find(p => p.assignedPosition === mine.assignedPosition && p.championId > 0);
      champSelectMatchupChampionId = opponent?.championId || null;
    }
    if (!rankBefore && currentQueueId) {
      rankBefore = await fetchRank(cachedLock, currentQueueId);
    }
  }

  // Tente de récupérer le résumé de fin de game + le rang après. Retourne true
  // une fois le résumé capturé (ou si on abandonne après timeout).
  async function tryCaptureEndOfGame(myPuuid) {
    const eogRes = await lcuGet(cachedLock, '/lol-end-of-game/v1/eog-stats-block');
    if (eogRes.ok && eogRes.data) {
      if (!eogLogged) {
        eogLogged = true;
        log(`[${ts()}] 🔵 LoL — résumé de fin de partie reçu`);
      }
      const stats = extractEndOfGameStats(eogRes.data, myPuuid);
      const rankAfter = currentQueueId ? await fetchRank(cachedLock, currentQueueId) : null;
      const items = await ensureItemData();
      const region = await ensureRegion();

      capturedResult = {
        ...stats,
        durationLabel: formatDuration(stats?.gameLengthSeconds),
        champion: currentChampion,
        queueId: currentQueueId,
        queueDescription: currentQueueDescription,
        items: (stats?.itemIds || []).map(id => items[id]).filter(Boolean),
        rankBefore,
        rankAfter,
        position: champSelectPosition || '',
        region: region || '',
      };
      return true;
    }
    if (postGameSince && Date.now() - postGameSince > POST_GAME_TIMEOUT_MS) {
      log(`[${ts()}] 🔵 LoL — pas de résumé de fin de game disponible (timeout)`);
      return true; // abandon, on marquera quand même la session inactive
    }
    return false;
  }

  async function poll() {
    if (Date.now() - rosterSyncCheckAt >= 10_000) {
      rosterSyncCheckAt = Date.now();
      void handleRosterSyncRequest();
    }
    if (!cachedLock) cachedLock = readLockfile();
    if (!cachedLock) {
      missedPolls++;
      if (missedPolls >= MAX_MISSED_POLLS) await markIdentityOffline();
      if (wasActive && missedPolls >= MAX_MISSED_POLLS) { log(`[${ts()}] 🔵 LoL — client fermé, fin de session`); await markInactive(); }
      return;
    }

    const sessionRes = await lcuGet(cachedLock, '/lol-gameflow/v1/session');
    if (!sessionRes.ok) {
      missedPolls++;
      if (missedPolls >= MAX_MISSED_POLLS) {
        cachedLock = null; // le client a peut-être redémarré (port/token changés)
        await markIdentityOffline();
        if (wasActive) { log(`[${ts()}] 🔵 LoL — client injoignable, fin de session`); await markInactive(); }
      }
      return;
    }
    missedPolls = 0;

    const phase = sessionRes.data?.phase;
    const queue = sessionRes.data?.gameData?.queue || {};
    const observedMatchId = sessionRes.data?.gameData?.gameId
      ? String(sessionRes.data.gameData.gameId)
      : '';
    currentQueueId = queue.id ?? currentQueueId;
    const summonerRes = await lcuGet(cachedLock, '/lol-summoner/v1/current-summoner');
    await publishIdentity(summonerRes.data, phase);

    // Seules les games classées (Solo/Duo, Flex) sont trackées. La présence
    // reste remontée normalement (publishIdentity ci-dessus, pour le statut
    // "en ligne" du panel admin), mais aucune session/notif/pari/stat pour
    // les normales, ARAM, Practice Tool, Co-op vs IA, etc.
    if (!isRankedLolQueue(currentQueueId)) {
      if (wasActive) { log(`[${ts()}] 🔵 LoL — passage en file non classée, fin de session trackée`); await markInactive(); }
      else resetMatchState();
      return;
    }

    if (phase === 'ChampSelect') {
      await updateChampSelectCache();
      return;
    }

    if (wasActive && POST_GAME_PHASES.has(phase)) {
      if (!postGameSince) postGameSince = Date.now();
      const done = await tryCaptureEndOfGame(summonerRes.data?.puuid);
      if (done) await markInactive();
      return;
    }

    const inGame = ACTIVE_PHASES.has(phase);
    if (!inGame) {
      if (wasActive) { log(`[${ts()}] 🔵 LoL — game terminée (${sessionKey})`); await markInactive(); }
      else resetMatchState();
      return;
    }

    const gameName = summonerRes.data?.gameName;
    const tagLine = summonerRes.data?.tagLine;
    if (!gameName || !tagLine) return; // identité pas encore dispo, on retentera au prochain poll
    const playerName = `${gameName}#${tagLine}`;

    if (wasActive && currentRiotMatchId && observedMatchId && currentRiotMatchId !== observedMatchId) {
      log(`[${ts()}] 🔵 LoL — nouvelle partie Riot détectée (${observedMatchId})`);
      await markInactive();
      currentQueueId = queue.id ?? null;
    }

    const isNewMatch = !wasActive || sessionKey !== playerName
      || Boolean(currentRiotMatchId && observedMatchId && currentRiotMatchId !== observedMatchId);
    if (isNewMatch) {
      matchStartedAt = Date.now();
      sessionKey = playerName;
      currentMatchId = observedMatchId || String(matchStartedAt);
      currentRiotMatchId = observedMatchId;
      log(`[${ts()}] 🔵 LoL — game détectée pour ${playerName}`);
    }
    wasActive = true;
    if (!currentRiotMatchId && observedMatchId) currentRiotMatchId = observedMatchId;

    const now = Date.now();
    if (!isNewMatch && now - lastHeartbeat < HEARTBEAT_MS) return;
    lastHeartbeat = now;

    const myPuuid = summonerRes.data?.puuid;
    const mySelection = (sessionRes.data?.gameData?.playerChampionSelections || []).find(p => p.puuid === myPuuid);

    const champions = await ensureChampionData();
    const champion = mySelection ? champions[mySelection.championId] : null;
    const matchup = champSelectMatchupChampionId ? champions[champSelectMatchupChampionId] : null;
    if (champion) currentChampion = champion;
    if (queue.description) currentQueueDescription = queue.description;
    const region = await ensureRegion();

    const sessionMember = getIdentity();
    await putFB(`live/lolSessions/${safeFirebaseKey(sessionKey)}`, {
      active: true,
      ts: now,
      matchId: currentMatchId,
      // Publié dès le début de game pour que le bot puisse revérifier lui-même
      // qu'on est bien en file classée avant de notifier ou d'ouvrir des paris.
      queueId: currentQueueId,
      playerName: sessionKey,
      memberId: sessionMember?.memberId || '',
      member: sessionMember?.memberName || '',
      puuid: myPuuid || '',
      mode: queue.gameMode || '',
      queueDescription: queue.description || '',
      champion: currentChampion,
      matchup: matchup ? { name: matchup.name, image: matchup.image } : null,
      position: champSelectPosition || '',
      rank: rankBefore,
      region: region || '',
      scriptVersion,
    });
  }

  return { poll, markInactive, markClientOffline: markIdentityOffline };
}

module.exports = {
  createLolWatcher, readLockfile, lcuGet, safeFirebaseKey, syncRosterProfiles,
  // exposés pour les tests
  shouldProbeProcess, nextProbeDelay, PROCESS_PROBE_BACKOFF_MS, MAX_DEBUG_LOG_BYTES, lolHistoryKey,
};
