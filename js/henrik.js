/**
 * OLYCITY · HenrikDev API client
 * Stats de SAISON : fetch 100 matchs, filtre sur l'acte en cours.
 */

import { CONFIG } from '../config.js';
import { storage } from './storage.js';

const BASE = 'https://api.henrikdev.xyz/valorant';

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

  // 1. MMR — rank actuel + peak + stats de saison
  const mmr = await fetchHenrik(
    `/v3/mmr/${region}/pc/${encodeURIComponent(name)}/${encodeURIComponent(tag)}`
  );
  const tier = mmr?.data?.current?.tier?.name || 'Unrated';
  const rr   = mmr?.data?.current?.rr ?? null;
  const peak = mmr?.data?.peak?.tier?.name ?? null;
  const playerPuuid = mmr?.data?.account?.puuid;

  // Win rate + season ID depuis seasonal[] (acte en cours)
  let seasonWr = null, seasonGames = null, seasonWins = null, currentSeasonId = null;
  const seasonal = mmr?.data?.seasonal || [];
  if (seasonal.length > 0) {
    const currentAct = seasonal[seasonal.length - 1];
    seasonGames     = currentAct.games ?? null;
    seasonWins      = currentAct.wins  ?? null;
    currentSeasonId = currentAct.season?.id ?? null;
    if (seasonGames > 0) seasonWr = Math.round((seasonWins / seasonGames) * 100);
    console.log(`[HenrikDev] ${name}: ${currentAct.season?.short} — ${seasonWins}W/${seasonGames}G = ${seasonWr}%WR`);
  }

  // 2. Matchs de l'acte en cours — on fetch 50 et on filtre par season_id
  let topAgents = [];
  let kda = null, games = 0;

  try {
    const matches = await fetchHenrik(
      `/v3/matches/${region}/${encodeURIComponent(name)}/${encodeURIComponent(tag)}?filter=competitive&size=50`
    );
    const allMatches = matches?.data || [];

    // Filtre par date : on garde les matchs des 75 derniers jours (≈ durée d'un acte)
    // On utilise game_start (Unix timestamp secondes) — plus fiable que game_start_patched
    const cutoff = Date.now() - 75 * 24 * 60 * 60 * 1000;
    let ml = allMatches.filter(m => {
      const startSec = m.metadata?.game_start;
      if (!startSec) return false;
      return startSec * 1000 >= cutoff;
    });
    // Log pour diagnostic
    if (allMatches.length > 0) {
      const sample = allMatches[0]?.metadata?.game_start;
      const sampleDate = sample ? new Date(sample * 1000).toLocaleDateString('fr-FR') : 'N/A';
      console.log(`[HenrikDev] ${name}: ${allMatches.length} matchs total, dernier: ${sampleDate}, filtrés 75j: ${ml.length}`);
    }
    // Fallback si aucun match récent (joueur inactif ce trimestre)
    if (ml.length === 0) ml = allMatches.slice(0, 15);
    games = ml.length;

    const agentMap = {};
    let totK = 0, totD = 0, totA = 0, counted = 0;

    // Log first match player list to debug matching
    if (ml.length > 0) {
      const firstMatch = ml[0];
      const firstPlayers = firstMatch.players?.all_players || [];
      const nameTagList = firstPlayers.map(p => `${p.name}#${p.tag}(${p.puuid?.slice(0,8)})`).join(', ');
      console.log(`[HenrikDev] ${name} — first match players: ${nameTagList.slice(0, 200)}`);
      console.log(`[HenrikDev] ${name} — looking for puuid:${playerPuuid?.slice(0,8)} or name:${name}#${tag}`);
    }

    let foundCount = 0;
    ml.forEach(m => {
      try {
        const allPlayers = m.players?.all_players || [];
        const me = allPlayers.find(p => p.puuid === playerPuuid)
                || allPlayers.find(p =>
                    p.name?.toLowerCase() === name.toLowerCase() &&
                    p.tag?.toLowerCase()  === tag.toLowerCase()
                  );
        if (!me) return;
        foundCount++;

        const agentName = normalizeAgentName(me.character);
        if (!agentName) return;

        if (!agentMap[agentName]) {
          agentMap[agentName] = { name: agentName, games: 0, kills: 0, deaths: 0, assists: 0 };
        }
        agentMap[agentName].games++;

        const kills   = me.stats?.kills   || 0;
        const deaths  = me.stats?.deaths  || 0;
        const assists = me.stats?.assists || 0;

        agentMap[agentName].kills   += kills;
        agentMap[agentName].deaths  += deaths;
        agentMap[agentName].assists += assists;

        totK += kills;
        totD += deaths;
        totA += assists;
        counted++;
      } catch(matchErr) {
        console.warn('[HenrikDev] Error parsing match:', matchErr.message);
      }
    });

    games = counted;

    console.log(`[HenrikDev] ${name} — trouvé dans ${foundCount}/${ml.length} matchs, agentMap:`, Object.keys(agentMap));
    topAgents = Object.values(agentMap)
      .sort((a, b) => b.games - a.games)
      .slice(0, 3);

    if (games > 0) {
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
    // Priorité au winrate de saison, fallback sur les 10 derniers matchs
    wr: seasonWr,
    wrGames: seasonGames,
    wrWins: seasonWins,
    kda, games,
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
