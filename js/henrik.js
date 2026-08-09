/**
 * OLYCITY · HenrikDev API client
 * Rank Riot + statistiques et top agents de l'acte via la pagination v4.
 */

import { CONFIG } from '../config.js';
import { storage } from './storage.js';
import {
  aggregateCompetitiveMatches,
  matchSeasonId,
  rateLimitDelayMs,
  selectActMatches,
  shouldStopMatchPagination,
} from './valorant-season.mjs?v=20260809-val-roster-season';

const BASE = 'https://api.henrikdev.xyz/valorant';
const MATCH_PAGE_SIZE = 10;
const MAX_MATCH_PAGES = 20;
const MAX_RATE_LIMIT_RETRIES = 3;

const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function fetchHenrik(path) {
  for (let attempt = 0; attempt <= MAX_RATE_LIMIT_RETRIES; attempt += 1) {
    let response;
    try {
      response = await fetch(`${BASE}${path}`, {
        method: 'GET',
        headers: { Authorization: CONFIG.HENRIK_API_KEY },
      });
    } catch (error) {
      console.error('[HenrikDev] Network error', error);
      throw new Error('NETWORK');
    }
    if (response.status === 429 && attempt < MAX_RATE_LIMIT_RETRIES) {
      const delayMs = rateLimitDelayMs(response.headers);
      console.info(`[HenrikDev] Quota atteint, reprise automatique dans ${Math.ceil(delayMs / 1000)}s.`);
      await wait(delayMs);
      continue;
    }
    if (response.status === 429) throw new Error('RATE_LIMIT');
    if (response.status === 401) throw new Error('AUTH_REQUIRED');
    if (response.status === 403) throw new Error('COMPTE_PRIVE');
    if (response.status === 404) throw new Error('NOT_FOUND');
    if (!response.ok) throw new Error(`HTTP_${response.status}`);
    return response.json();
  }
  throw new Error('RATE_LIMIT');
}

function latestSeasonFromMmr(mmr, seasonId = null) {
  const seasonal = Array.isArray(mmr?.data?.seasonal) ? mmr.data.seasonal : [];
  return seasonal.find(season => season?.season?.id === seasonId)
    || seasonal[seasonal.length - 1]
    || null;
}

async function fetchCompetitiveActMatches({ region, name, tag, puuid, expectedSeasonId = null }) {
  const matches = [];
  const seenMatchIds = new Set();
  let seasonId = expectedSeasonId;
  let pages = 0;
  let truncated = false;

  for (let pageIndex = 0; pageIndex < MAX_MATCH_PAGES; pageIndex += 1) {
    const start = pageIndex * MATCH_PAGE_SIZE;
    const identityPath = puuid
      ? `/v4/by-puuid/matches/${region}/pc/${encodeURIComponent(puuid)}`
      : `/v4/matches/${region}/pc/${encodeURIComponent(name)}/${encodeURIComponent(tag)}`;
    const response = await fetchHenrik(
      `${identityPath}?mode=competitive&size=${MATCH_PAGE_SIZE}&start=${start}`,
    );
    const page = Array.isArray(response?.data) ? response.data : [];
    pages += 1;

    if (!seasonId) seasonId = page.map(matchSeasonId).find(Boolean) || null;
    const selected = selectActMatches(page, seasonId);
    if (!seasonId) seasonId = selected.seasonId;

    for (const match of selected.matches) {
      const matchId = match?.metadata?.match_id || match?.metadata?.matchid;
      if (matchId && seenMatchIds.has(matchId)) continue;
      if (matchId) seenMatchIds.add(matchId);
      matches.push(match);
    }

    if (shouldStopMatchPagination(page, seasonId, MATCH_PAGE_SIZE)) break;
    if (pageIndex === MAX_MATCH_PAGES - 1) truncated = true;
    await wait(250);
  }

  return { matches, seasonId, pages, truncated };
}

/**
 * Synchronise un joueur sur tout l'acte compétitif disponible.
 */
export async function syncPlayer(player) {
  if (!player.riot) throw new Error('NO_RIOT_ID');
  const { name, tag, region } = player.riot;

  const mmr = await fetchHenrik(
    `/v3/mmr/${region}/pc/${encodeURIComponent(name)}/${encodeURIComponent(tag)}`,
  );
  const tier = mmr?.data?.current?.tier?.name || 'Unrated';
  const rr = mmr?.data?.current?.rr ?? null;
  const peak = mmr?.data?.peak?.tier?.name ?? null;
  const playerPuuid = mmr?.data?.account?.puuid;
  const latestMmrSeason = latestSeasonFromMmr(mmr);

  let matchResult = { matches: [], seasonId: latestMmrSeason?.season?.id || null, pages: 0, truncated: false };
  try {
    matchResult = await fetchCompetitiveActMatches({
      region,
      name,
      tag,
      puuid: playerPuuid,
      // La première partie paginée est la source la plus fiable pour l'acte
      // courant. L'ordre du tableau MMR n'est pas garanti par Riot.
      expectedSeasonId: null,
    });
  } catch (error) {
    console.warn('[HenrikDev] Match pagination failed for', player.name, error.message);
    if (['AUTH_REQUIRED', 'RATE_LIMIT', 'COMPTE_PRIVE'].includes(error.message)) throw error;
  }

  const season = latestSeasonFromMmr(mmr, matchResult.seasonId);
  const seasonGames = Number.isFinite(Number(season?.games)) ? Number(season.games) : null;
  const seasonWins = Number.isFinite(Number(season?.wins)) ? Number(season.wins) : null;
  const aggregate = aggregateCompetitiveMatches(matchResult.matches, {
    puuid: playerPuuid,
    name,
    tag,
  });
  const winRate = seasonGames > 0 && seasonWins != null
    ? Math.round((seasonWins / seasonGames) * 100)
    : aggregate.winRatePct;

  return {
    rank: tier,
    rr,
    peak,
    wr: winRate,
    wrGames: seasonGames ?? aggregate.games,
    wrWins: seasonWins ?? aggregate.wins,
    kda: aggregate.kda,
    kd: aggregate.kd,
    acs: aggregate.acs,
    hsPercent: aggregate.hsPercent,
    games: aggregate.games,
    topAgents: aggregate.topAgents,
    topAgentStats: aggregate.topAgentStats,
    seasonId: matchResult.seasonId,
    matchPages: matchResult.pages,
    truncated: matchResult.truncated,
    statsSource: 'henrik-v4-act',
    syncedAt: Date.now(),
  };
}

export async function syncAllPlayers(players, {
  onPlayerSynced = () => {},
  onPlayerError = () => {},
  delayMs = 2000,
} = {}) {
  const playersWithRiot = players.filter(player => player.riot);
  let successCount = 0;
  const errors = [];

  for (const player of playersWithRiot) {
    try {
      const stats = await syncPlayer(player);
      onPlayerSynced(player.name, stats);
      successCount += 1;
      await wait(delayMs);
    } catch (error) {
      onPlayerError(player.name, error.message);
      errors.push({ player: player.name, error: error.message });
      if (error.message === 'AUTH_REQUIRED' || error.message === 'RATE_LIMIT') {
        return { successCount, errors, halted: true, haltReason: error.message };
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
