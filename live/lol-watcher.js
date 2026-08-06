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

const HEARTBEAT_MS = 20000;
// Phases actives d'une game : GameStart = chargement, InProgress = en jeu, Reconnect = reco après un crash.
const ACTIVE_PHASES = new Set(['GameStart', 'InProgress', 'Reconnect']);
// Phases de fin de partie où on tente de récupérer le résumé avant de considérer la session terminée.
const POST_GAME_PHASES = new Set(['WaitingForStats', 'PreEndOfGame', 'EndOfGame']);
const POST_GAME_TIMEOUT_MS = 45000;
// Tolérance avant de considérer le client/la game injoignable — un poll raté isolé
// (timeout réseau, LCU momentanément occupé) ne doit pas déclencher une fausse fin de game.
const MAX_MISSED_POLLS = 3;

const RANKED_QUEUE_TYPES = { 420: 'RANKED_SOLO_5x5', 440: 'RANKED_FLEX_SR' };

const LOCKFILE_PATHS = [
  path.join('C:', 'Riot Games', 'League of Legends', 'lockfile'),
  path.join(process.env['ProgramFiles(x86)'] || '', 'Riot Games', 'League of Legends', 'lockfile'),
  path.join(process.env.ProgramFiles || '', 'Riot Games', 'League of Legends', 'lockfile'),
];

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

// Filet de secours si League est installé ailleurs que les emplacements par défaut :
// on retrouve port + token dans la ligne de commande du process LeagueClientUx.exe.
function readLockfileFromProcess() {
  try {
    const output = execFileSync('powershell.exe', [
      '-NoProfile', '-Command',
      "(Get-CimInstance Win32_Process -Filter \"Name='LeagueClientUx.exe'\").CommandLine",
    ], { timeout: 3000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' });
    const portMatch = output.match(/--app-port=(\d+)/);
    const tokenMatch = output.match(/--remoting-auth-token=([\w-]+)/);
    if (portMatch && tokenMatch) return { port: Number(portMatch[1]), password: tokenMatch[1], protocol: 'https' };
  } catch {}
  return null;
}

function readLockfile() {
  return readLockfileFromDisk() || readLockfileFromProcess();
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
  return { tier: entry.tier || '', division: entry.division || '', lp: entry.leaguePoints ?? null };
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

function createLolWatcher({ putFB, ts, scriptVersion, log = console.log }) {
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
  let rankBefore = null;
  let postGameSince = 0;
  let capturedResult = null;
  let missedPolls = 0;
  let identityHeartbeat = 0;
  let identityKey = '';
  let identitySnapshot = null;
  let identityPhase = '';

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
    rankBefore = null;
    postGameSince = 0;
    capturedResult = null;
  }

  async function markInactive() {
    if (!wasActive || !sessionKey) return;
    await putFB(`live/lolSessions/${safeFirebaseKey(sessionKey)}`, {
      active: false,
      ts: Date.now(),
      playerName: sessionKey,
      matchId: currentMatchId,
      result: capturedResult || null,
    });
    // Historique persistant (une entrée par game) — sert à calculer les
    // winrates perso pour le moteur de cotes des paris.
    if (capturedResult) {
      const histKey = safeFirebaseKey(currentMatchId || String(matchStartedAt));
      await putFB(`live/lolHistory/${histKey}`, {
        playerName: sessionKey,
        ts: Date.now(),
        ...capturedResult,
      });
    }
    resetMatchState();
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
    await putFB(`live/lolClients/${key}`, {
      ...identitySnapshot,
      game: 'lol',
      games: ['lol'],
      connected: true,
      phase: phase || 'Unknown',
      lastSeen: now,
      scriptVersion,
    });
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
      log(`[${ts()}] 🔵 LoL — eog-stats-block reçu (voir olycity-live.log pour le détail brut)`);
      log(`[${ts()}] [lol-eog-raw] ${JSON.stringify(eogRes.data)}`);
      const stats = extractEndOfGameStats(eogRes.data, myPuuid);
      const rankAfter = currentQueueId ? await fetchRank(cachedLock, currentQueueId) : null;
      const items = await ensureItemData();

      capturedResult = {
        ...stats,
        durationLabel: formatDuration(stats?.gameLengthSeconds),
        champion: currentChampion,
        queueId: currentQueueId,
        queueDescription: currentQueueDescription,
        items: (stats?.itemIds || []).map(id => items[id]).filter(Boolean),
        rankBefore,
        rankAfter,
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
    currentQueueId = sessionRes.data?.gameData?.queue?.id ?? currentQueueId;
    const summonerRes = await lcuGet(cachedLock, '/lol-summoner/v1/current-summoner');
    await publishIdentity(summonerRes.data, phase);

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

    const isNewMatch = !wasActive || sessionKey !== playerName;
    if (isNewMatch) {
      matchStartedAt = Date.now();
      sessionKey = playerName;
      log(`[${ts()}] 🔵 LoL — game détectée pour ${playerName}`);
    }
    wasActive = true;

    const now = Date.now();
    if (!isNewMatch && now - lastHeartbeat < HEARTBEAT_MS) return;
    lastHeartbeat = now;

    const queue = sessionRes.data?.gameData?.queue || {};
    const gameId = sessionRes.data?.gameData?.gameId;
    const myPuuid = summonerRes.data?.puuid;
    const mySelection = (sessionRes.data?.gameData?.playerChampionSelections || []).find(p => p.puuid === myPuuid);

    const champions = await ensureChampionData();
    const champion = mySelection ? champions[mySelection.championId] : null;
    const matchup = champSelectMatchupChampionId ? champions[champSelectMatchupChampionId] : null;
    if (champion) currentChampion = champion;
    if (queue.description) currentQueueDescription = queue.description;
    // Figé une seule fois au début de la game : si le gameId Riot n'est pas encore
    // dispo au tout premier push, on ne veut pas qu'il change en cours de route
    // (ça romprait le dédoublonnage des notifs et ouvrirait un 2e round de paris).
    if (!currentMatchId) currentMatchId = gameId ? String(gameId) : String(matchStartedAt);
    const region = await ensureRegion();

    await putFB(`live/lolSessions/${safeFirebaseKey(sessionKey)}`, {
      active: true,
      ts: now,
      matchId: currentMatchId,
      playerName: sessionKey,
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

module.exports = { createLolWatcher, readLockfile, lcuGet, safeFirebaseKey };
