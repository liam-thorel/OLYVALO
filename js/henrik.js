/**
 * OLYCITY · HenrikDev API client
 * Stats de SAISON : fetch 100 matchs, filtre sur l'acte en cours.
 */

import { CONFIG } from '../config.js';
import { storage } from './storage.js';

const BASE = 'https://api.henrikdev.xyz/valorant';

// Saison actuelle : Episode 10 Act 1 (2026)
// On filtre les matchs des 120 derniers jours (~une saison complète)
const SEASON_DAYS = 120;
const SEASON_MS = SEASON_DAYS * 24 * 60 * 60 * 1000;

async function fetchHenrik(path) {
  const url = `${BASE}${path}`;
  console.log('[HenrikDev] Fetch', url);
  let res;
  try {
    res = await fetch(url, {
      method: 'GET',
      headers: { 'Authorization': CONFIG.HENRIK_API_KEY },
    });
  } catch (e) {
    console.error('[HenrikDev] Network error', e);
    throw new Error('NETWORK');
  }
  console.log('[HenrikDev] Status', res.status);
  if (res.status === 429) throw new Error('RATE_LIMIT');
  if (res.status === 401 || res.status === 403) throw new Error('AUTH_REQUIRED');
  if (res.status === 404) throw new Error('NOT_FOUND');
  if (!res.ok) throw new Error('HTTP_' + res.status);
  return res.json();
}

/**
 * Normalise un nom d'agent retourné par l'API (ex: "omen" → "Omen", "KAY/O" intact)
 */
function normalizeAgentName(raw) {
  if (!raw) return null;
  // KAY/O est toujours "KAY/O" dans valorant-api mais HenrikDev retourne parfois "KAYO"
  const map = {
    'kayo': 'KAY/O', 'kay/o': 'KAY/O',
    'deadlock': 'Deadlock', 'vyse': 'Vyse',
    'tejo': 'Tejo', 'waylay': 'Waylay',
    'iso': 'Iso', 'clove': 'Clove',
  };
  const lower = raw.toLowerCase().replace(/\s/g, '');
  if (map[lower]) return map[lower];
  // Capitalize first letter of each word
  return raw.replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Sync a single player.
 * Fetches up to 100 competitive matches, filters to current season.
 * Returns { rank, rr, peak, wr, kda, games, topAgents, syncedAt }
 */
export async function syncPlayer(player) {
  if (!player.riot) throw new Error('NO_RIOT_ID');
  const { name, tag, region } = player.riot;

  // 1. MMR — rank actuel + peak
  const mmr = await fetchHenrik(
    `/v3/mmr/${region}/pc/${encodeURIComponent(name)}/${encodeURIComponent(tag)}`
  );
  const tier = mmr?.data?.current?.tier?.name || 'Unrated';
  const rr   = mmr?.data?.current?.rr ?? null;
  const peak = mmr?.data?.peak?.tier?.name ?? null;
  const playerPuuid = mmr?.data?.account?.puuid;

  // 2. Matchs compétitifs — on fetch 100 pour avoir la saison entière
  let topAgents = [];
  let wr = null, kda = null, games = 0;

  try {
    const matches = await fetchHenrik(
      `/v3/matches/${region}/${encodeURIComponent(name)}/${encodeURIComponent(tag)}?filter=competitive&size=100`
    );
    const allMatches = matches?.data || [];

    // Filtre sur la saison actuelle (SEASON_DAYS jours)
    const cutoff = Date.now() - SEASON_MS;
    const ml = allMatches.filter(m => {
      const ts = m.metadata?.game_start_patched
        ? new Date(m.metadata.game_start_patched).getTime()
        : (m.metadata?.game_start || 0) * 1000;
      return ts >= cutoff;
    });

    games = ml.length;
    console.log(`[HenrikDev] ${name}: ${allMatches.length} total → ${games} cette saison`);

    if (games === 0) {
      // Fallback: utilise tous les matchs si aucun dans la fenêtre saison
      // (compte inactif ou début de saison)
      games = Math.min(allMatches.length, 30);
      ml.push(...allMatches.slice(0, games));
      console.log(`[HenrikDev] ${name}: fallback sur ${games} derniers matchs`);
    }

    const agentMap = {};
    let totK = 0, totD = 0, totA = 0, totW = 0, counted = 0;

    ml.forEach(m => {
      try {
      const allPlayers = m.players?.all_players || [];
      const me = allPlayers.find(p => p.puuid === playerPuuid)
              || allPlayers.find(p =>
                  p.name?.toLowerCase() === name.toLowerCase() &&
                  p.tag?.toLowerCase()  === tag.toLowerCase()
                );
      if (!me) return;

      const rawAgent = me.character;
      const agentName = normalizeAgentName(rawAgent);
      if (!agentName) return;

      if (!agentMap[agentName]) {
        agentMap[agentName] = { games: 0, kills: 0, deaths: 0, assists: 0, wins: 0 };
      }
      agentMap[agentName].games++;

      const kills   = me.stats?.kills   || 0;
      const deaths  = me.stats?.deaths  || 0;
      const assists = me.stats?.assists || 0;

      agentMap[agentName].kills   += kills;
      agentMap[agentName].deaths  += deaths;
      agentMap[agentName].assists += assists;

      // Win check : teams.red.has_won / teams.blue.has_won
      const myTeam = (me.team || '').toLowerCase();
      const won = m.teams?.[myTeam]?.has_won === true;
      if (won) { agentMap[agentName].wins++; totW++; }

      totK += kills;
      totD += deaths;
      totA += assists;
      counted++;
      } catch(matchErr) {
        console.warn('[HenrikDev] Error parsing match:', matchErr.message);
      }
    });

    // Réassigne games au nombre de matchs réellement parsés
    games = counted;

    topAgents = Object.values(agentMap)
      .sort((a, b) => b.games - a.games)
      .slice(0, 3);

    if (games > 0) {
      wr  = Math.round((totW / games) * 100);
      kda = totD > 0
        ? ((totK + totA) / totD).toFixed(2)
        : (totK + totA).toFixed(2);
    }

  } catch (e) {
    console.warn('[HenrikDev] Matches failed for', player.name, e.message);
    if (e.message === 'AUTH_REQUIRED' || e.message === 'RATE_LIMIT') throw e;
  }

  return {
    rank: tier, rr, peak,
    wr, kda, games,
    topAgents: topAgents.map(a => a.name),
    syncedAt: Date.now(),
  };
}

/**
 * Sync all players with riot IDs sequentially.
 */
export async function syncAllPlayers(players, {
  onPlayerSynced = () => {},
  onPlayerError  = () => {},
  delayMs = 1500,
} = {}) {
  const playersWithRiot = players.filter(p => p.riot);
  let successCount = 0;
  const errors = [];

  for (const player of playersWithRiot) {
    try {
      const stats = await syncPlayer(player);
      onPlayerSynced(player.name, stats);
      successCount++;
      await new Promise(r => setTimeout(r, delayMs));
    } catch (e) {
      onPlayerError(player.name, e.message);
      errors.push({ player: player.name, error: e.message });
      if (e.message === 'AUTH_REQUIRED' || e.message === 'RATE_LIMIT') {
        return { successCount, errors, halted: true, haltReason: e.message };
      }
    }
  }

  return { successCount, errors, halted: false };
}

export function persistPlayerStats(playerName, stats) {
  const all = storage.getPlayerStats();
  all[playerName] = stats;
  storage.setPlayerStats(all);
}
