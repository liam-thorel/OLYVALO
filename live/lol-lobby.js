/**
 * Les 10 joueurs de la partie LoL en cours, avec ce qui aide à la lire :
 * rang et winrate SoloQ, maîtrise du champion joué, rôle principal.
 *
 * Tout vient de l'API locale du client (LCU), déjà utilisée par le script :
 * aucune clé Riot, aucun service externe. Le client sait répondre pour
 * n'importe quel joueur — c'est ce qu'il fait quand on ouvre un profil.
 *
 * La collecte se fait UNE fois par partie : une quarantaine de requêtes
 * locales, rien qui justifie de les refaire à chaque battement.
 */

const { soloRankFromStats, summarizeSoloQueue } = require('./lol-profile-utils');

const TEAM_ORDER = 'ORDER'; // équipe bleue, 100
const TEAM_CHAOS = 'CHAOS'; // équipe rouge, 200
const VALID_POSITIONS = new Set(['top', 'jungle', 'mid', 'adc', 'support']);
// Historique lu pour deviner le rôle principal. Vingt parties suffisent à
// dégager une tendance sans alourdir la collecte.
const HISTORY_SIZE = 20;

function normalizePosition(value) {
  const raw = String(value || '').toUpperCase();
  if (raw.includes('UTILITY') || raw.includes('SUPPORT')) return 'support';
  if (raw.includes('JUNGLE')) return 'jungle';
  if (raw.includes('MID')) return 'mid';
  if (raw.includes('BOTTOM') || raw === 'BOT' || raw.includes('CARRY') || raw === 'ADC') return 'adc';
  if (raw.includes('TOP')) return 'top';
  return '';
}

/**
 * Participants de la partie, d'après /lol-gameflow/v1/session.
 *
 * Le client range les deux équipes dans gameData.teamOne / teamTwo, et les
 * champions dans playerChampionSelections. On lit les deux : selon la file,
 * l'un ou l'autre peut manquer d'un champ.
 */
function participantsFromGameflow(session, myPuuid = '') {
  const data = session?.gameData || {};
  const selections = new Map((Array.isArray(data.playerChampionSelections) ? data.playerChampionSelections : [])
    .filter(entry => entry?.puuid)
    .map(entry => [String(entry.puuid), entry]));
  const teams = [
    [TEAM_ORDER, Array.isArray(data.teamOne) ? data.teamOne : []],
    [TEAM_CHAOS, Array.isArray(data.teamTwo) ? data.teamTwo : []],
  ];
  const myTeam = teams.find(([, players]) => players.some(player => myPuuid && String(player?.puuid || '') === String(myPuuid)))?.[0] || '';

  const seen = new Set();
  const participants = [];
  teams.forEach(([team, players]) => {
    players.forEach(player => {
      const puuid = String(player?.puuid || '').trim();
      // Joueur masqué (mode streamer côté adverse, bot) : on garde son
      // champion, sans rien pouvoir chercher d'autre.
      const key = puuid || `${team}:${participants.length}`;
      if (seen.has(key)) return;
      seen.add(key);
      const championId = Number(player?.championId || selections.get(puuid)?.championId || 0);
      participants.push({
        puuid,
        team,
        ally: myTeam ? team === myTeam : null,
        self: Boolean(myPuuid && puuid === String(myPuuid)),
        championId,
        position: normalizePosition(player?.selectedPosition || player?.assignedPosition),
        summonerId: player?.summonerId ? String(player.summonerId) : '',
        name: String(player?.gameName && player?.tagLine ? `${player.gameName}#${player.tagLine}` : player?.summonerName || ''),
      });
    });
  });
  return participants;
}

/**
 * Maîtrise du champion joué. Le client renvoie une liste, sous plusieurs
 * formes selon l'endpoint qui répond.
 */
function masteryFor(payload, championId) {
  const list = Array.isArray(payload) ? payload
    : Array.isArray(payload?.masteries) ? payload.masteries
      : Array.isArray(payload?.championMasteries) ? payload.championMasteries
        : [];
  const entry = list.find(item => Number(item?.championId) === Number(championId));
  if (!entry) return null;
  const points = Number(entry.championPoints ?? entry.points ?? 0);
  if (!Number.isFinite(points) || points < 0) return null;
  return { points, level: Number(entry.championLevel ?? entry.level ?? 0) || null };
}

const TIERS = ['IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'EMERALD', 'DIAMOND', 'MASTER', 'GRANDMASTER', 'CHALLENGER'];
const APEX = new Set(['MASTER', 'GRANDMASTER', 'CHALLENGER']);
const DIVISION_ORDER = { IV: 0, III: 1, II: 2, I: 3, '': 3 };

/** Valeur comparable d'un rang : palier, puis division, puis LP. */
function rankScore(rank) {
  const tier = TIERS.indexOf(String(rank?.tier || '').toUpperCase());
  if (tier < 0) return -1;
  const division = APEX.has(TIERS[tier]) ? 3 : (DIVISION_ORDER[String(rank?.division || '').toUpperCase()] ?? 0);
  return tier * 10_000 + division * 1_000 + Math.min(999, Math.max(0, Number(rank?.lp) || 0));
}

/** Le meilleur de plusieurs rangs, ou null. */
function bestRank(ranks) {
  return (ranks || []).filter(rank => rankScore(rank) >= 0)
    .reduce((best, rank) => (!best || rankScore(rank) > rankScore(best) ? rank : best), null);
}

/**
 * Plus hauts rangs SoloQ connus du client : saison en cours et précédente.
 * Le client ne garde pas plus loin — l'historique complet vient d'op.gg.
 */
function clientPeaks(payload) {
  const queues = Array.isArray(payload?.queues) ? payload.queues : [];
  const solo = queues.find(queue => queue?.queueType === 'RANKED_SOLO_5x5') || payload?.queueMap?.RANKED_SOLO_5x5;
  if (!solo) return [];
  return [
    { tier: solo.highestTier, division: solo.highestDivision },
    { tier: solo.previousSeasonHighestTier, division: solo.previousSeasonHighestDivision },
    { tier: solo.previousSeasonEndTier, division: solo.previousSeasonEndDivision },
  ].filter(rank => rankScore(rank) >= 0);
}

/**
 * Le client ne donne que les VICTOIRES des autres joueurs : leurs défaites
 * valent 0. Calculé tel quel, chaque adversaire affichait 100 % de winrate.
 * Hors de soi, des défaites à zéro ne sont donc pas une information : on
 * efface le winrate plutôt que de l'inventer — op.gg le complète ensuite.
 */
function trustworthyRank(rank, self) {
  if (!rank || self || Number(rank.losses) > 0) return rank;
  return { ...rank, wins: null, losses: null, games: null, winRate: null };
}

function riotIdOf(summoner, fallback = '') {
  if (summoner?.gameName) return summoner.tagLine ? `${summoner.gameName}#${summoner.tagLine}` : String(summoner.gameName);
  return fallback || '';
}

/**
 * Collecte complète. `lcu(endpoint)` renvoie { ok, data } — injecté pour que
 * la logique se teste sans client LoL.
 */
async function collectLobby({ lcu, session, myPuuid, champions = {}, log = () => {} }) {
  const participants = participantsFromGameflow(session, myPuuid);
  const players = [];
  let masteryUnavailable = false;
  let masteryTried = false;

  for (const participant of participants) {
    const champion = champions[participant.championId] || null;
    const base = {
      puuid: participant.puuid,
      riotId: participant.name,
      team: participant.team,
      ally: participant.ally,
      self: participant.self,
      // Le numéro du champion part toujours : si la liste Data Dragon n'a pas
      // pu être chargée, le site retrouve l'icône à partir de lui seul.
      championId: participant.championId || null,
      champion: champion ? { name: champion.name, image: champion.image } : null,
      position: participant.position,
      mainRole: '',
      rank: null,
      peak: null,
      mastery: null,
    };
    if (!participant.puuid) { players.push(base); continue; }
    const id = encodeURIComponent(participant.puuid);

    const summoner = await lcu(`/lol-summoner/v2/summoners/puuid/${id}`);
    if (summoner.ok) base.riotId = riotIdOf(summoner.data, base.riotId);

    const ranked = await lcu(`/lol-ranked/v1/ranked-stats/${id}`);
    if (ranked.ok) {
      base.rank = trustworthyRank(soloRankFromStats(ranked.data), participant.self);
      const peak = bestRank([...clientPeaks(ranked.data), base.rank]);
      if (peak) base.peak = { tier: peak.tier, division: APEX.has(String(peak.tier).toUpperCase()) ? '' : peak.division || '', lp: peak.lp ?? null, source: 'client' };
    }

    // Deux endpoints selon la version du client : par PUUID (récents), par
    // identifiant d'invocateur (anciens).
    if (participant.championId && !masteryUnavailable) {
      let mastery = await lcu(`/lol-champion-mastery/v1/${id}/champion-mastery`);
      const summonerId = participant.summonerId || summoner.data?.summonerId;
      if (!mastery.ok && summonerId) mastery = await lcu(`/lol-collections/v1/inventories/${encodeURIComponent(summonerId)}/champion-mastery`);
      if (mastery.ok) base.mastery = masteryFor(mastery.data, participant.championId);
      else if (!masteryTried) {
        // Ni l'un ni l'autre ne répond pour le premier joueur : le client ne
        // les expose pas, inutile d'insister pour les neuf suivants.
        masteryUnavailable = true;
        log('[lol] maîtrise indisponible sur ce client');
      }
      masteryTried = true;
    }

    const history = await lcu(`/lol-match-history/v1/products/lol/${id}/matches?begIndex=0&endIndex=${HISTORY_SIZE - 1}`);
    if (history.ok) {
      const summary = summarizeSoloQueue(history.data, { puuid: participant.puuid });
      if (VALID_POSITIONS.has(summary.mainRole)) base.mainRole = summary.mainRole;
    }

    players.push(base);
  }
  return players;
}

/**
 * Deuxième passe, sur op.gg : winrate de la saison (le client ne donne pas
 * les défaites des autres) et rangs des saisons passées, pour le peak de tous
 * les temps. Joueur par joueur, espacés : op.gg n'est pas une API, il ne faut
 * pas le marteler. Un échec laisse simplement la donnée du client.
 */
async function enrichLobby(players, { fetchProfile, region = 'euw', pauseMs = 400, wait = ms => new Promise(resolve => setTimeout(resolve, ms)), log = () => {} }) {
  const enriched = [];
  for (const player of players) {
    if (!player.riotId || !player.riotId.includes('#')) { enriched.push(player); continue; }
    let profile = null;
    try {
      profile = await fetchProfile(player.riotId, region);
    } catch (error) {
      log(`[lol] op.gg ${player.riotId} : ${error.message}`);
    }
    const next = { ...player };
    const seasonRank = profile?.rank;
    if (seasonRank && Number.isFinite(Number(seasonRank.wins)) && Number.isFinite(Number(seasonRank.losses))) {
      next.rank = { ...(player.rank || {}), ...seasonRank };
    }
    const seasons = Array.isArray(profile?.pastSeasons) ? profile.pastSeasons : [];
    const peak = bestRank([player.peak, ...seasons, next.rank]);
    if (peak) {
      next.peak = {
        tier: peak.tier,
        division: APEX.has(String(peak.tier).toUpperCase()) ? '' : peak.division || '',
        lp: peak.lp ?? null,
        source: seasons.length ? 'op.gg' : (player.peak?.source || 'client'),
        seasons: seasons.length,
      };
    }
    enriched.push(next);
    await wait(pauseMs);
  }
  return enriched;
}

module.exports = {
  participantsFromGameflow, masteryFor, collectLobby, normalizePosition,
  enrichLobby, bestRank, rankScore, clientPeaks, trustworthyRank,
  TEAM_ORDER, TEAM_CHAOS, HISTORY_SIZE,
};
