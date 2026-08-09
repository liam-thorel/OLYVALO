const DEFAULT_MATCH_PAGE_SIZE = 10;

export function normalizeAgentName(raw) {
  if (!raw) return null;
  const normalized = String(raw).trim();
  const compact = normalized.toLowerCase().replace(/[\s/]/g, '');
  const aliases = {
    kayo: 'KAY/O',
    deadlock: 'Deadlock',
    vyse: 'Vyse',
    tejo: 'Tejo',
    waylay: 'Waylay',
    iso: 'Iso',
    clove: 'Clove',
  };
  if (aliases[compact]) return aliases[compact];
  return normalized.replace(/\b\w/g, character => character.toUpperCase());
}

export function matchSeasonId(match) {
  return match?.metadata?.season?.id
    || match?.metadata?.season_id
    || match?.metadata?.seasonId
    || null;
}

export function matchStartedAt(match) {
  const raw = match?.metadata?.started_at || match?.metadata?.game_start;
  if (typeof raw === 'number') return raw > 10_000_000_000 ? raw : raw * 1000;
  const parsed = Date.parse(raw || '');
  return Number.isFinite(parsed) ? parsed : 0;
}

export function selectActMatches(matches, expectedSeasonId = null) {
  const ordered = (Array.isArray(matches) ? matches : [])
    .filter(Boolean)
    .sort((left, right) => matchStartedAt(right) - matchStartedAt(left));
  const seasonId = expectedSeasonId || ordered.map(matchSeasonId).find(Boolean) || null;
  if (!seasonId) return { seasonId: null, matches: ordered };
  return {
    seasonId,
    matches: ordered.filter(match => matchSeasonId(match) === seasonId),
  };
}

function matchPlayers(match) {
  if (Array.isArray(match?.players)) return match.players;
  if (Array.isArray(match?.players?.all_players)) return match.players.all_players;
  return [];
}

function playerAgentName(player) {
  const raw = typeof player?.agent === 'string'
    ? player.agent
    : player?.agent?.name || player?.character || player?.character_name;
  return normalizeAgentName(raw);
}

function playerMatchesIdentity(player, identity) {
  if (identity?.puuid && player?.puuid === identity.puuid) return true;
  const expectedName = String(identity?.name || '').toLowerCase();
  const expectedTag = String(identity?.tag || '').toLowerCase();
  if (!expectedName) return false;
  return String(player?.name || '').toLowerCase() === expectedName
    && (!expectedTag || String(player?.tag || '').toLowerCase() === expectedTag);
}

function teamWon(match, teamId) {
  const team = (Array.isArray(match?.teams) ? match.teams : [])
    .find(candidate => candidate?.team_id === teamId || candidate?.teamId === teamId);
  return typeof team?.won === 'boolean' ? team.won : null;
}

export function aggregateCompetitiveMatches(matches, identity = {}) {
  const agents = new Map();
  let games = 0;
  let wins = 0;
  let losses = 0;
  let kills = 0;
  let deaths = 0;
  let assists = 0;
  let score = 0;
  let rounds = 0;
  let headshots = 0;
  let bodyshots = 0;
  let legshots = 0;

  for (const match of Array.isArray(matches) ? matches : []) {
    const player = matchPlayers(match).find(candidate => playerMatchesIdentity(candidate, identity));
    if (!player) continue;

    const stats = player.stats || {};
    const matchRounds = Array.isArray(match.rounds)
      ? match.rounds.length
      : Number(match?.metadata?.rounds_played || stats.rounds_played || 0);
    const won = teamWon(match, player.team_id || player.teamId);
    const agentName = playerAgentName(player);

    games += 1;
    if (won === true) wins += 1;
    if (won === false) losses += 1;
    kills += Number(stats.kills) || 0;
    deaths += Number(stats.deaths) || 0;
    assists += Number(stats.assists) || 0;
    score += Number(stats.score) || 0;
    rounds += Number(matchRounds) || 0;
    headshots += Number(stats.headshots) || 0;
    bodyshots += Number(stats.bodyshots) || 0;
    legshots += Number(stats.legshots) || 0;

    if (agentName) {
      const aggregate = agents.get(agentName) || { name: agentName, games: 0, wins: 0 };
      aggregate.games += 1;
      if (won === true) aggregate.wins += 1;
      agents.set(agentName, aggregate);
    }
  }

  const shots = headshots + bodyshots + legshots;
  const topAgentStats = [...agents.values()]
    .map(agent => ({
      ...agent,
      winRatePct: agent.games ? Math.round((agent.wins / agent.games) * 100) : null,
    }))
    .sort((left, right) => right.games - left.games || right.wins - left.wins || left.name.localeCompare(right.name))
    .slice(0, 3);

  return {
    games,
    wins,
    losses,
    kills,
    deaths,
    assists,
    kd: games ? (kills / Math.max(1, deaths)).toFixed(2) : null,
    kda: games ? ((kills + assists) / Math.max(1, deaths)).toFixed(2) : null,
    acs: rounds ? Math.round(score / rounds) : null,
    hsPercent: shots ? Math.round((headshots / shots) * 100) : null,
    winRatePct: wins + losses ? Math.round((wins / (wins + losses)) * 100) : null,
    topAgentStats,
    topAgents: topAgentStats.map(agent => agent.name),
  };
}

export function shouldStopMatchPagination(page, targetSeasonId, pageSize = DEFAULT_MATCH_PAGE_SIZE) {
  if (!Array.isArray(page) || page.length < pageSize) return true;
  if (!targetSeasonId) return false;
  return page.some(match => {
    const seasonId = matchSeasonId(match);
    return seasonId && seasonId !== targetSeasonId;
  });
}

export function rateLimitDelayMs(headers, fallbackMs = 35_000) {
  const retryAfter = headers?.get?.('retry-after');
  const retrySeconds = Number(retryAfter);
  if (Number.isFinite(retrySeconds) && retrySeconds > 0) {
    return Math.min(90_000, Math.max(1_000, Math.ceil(retrySeconds * 1000) + 750));
  }

  const rateLimit = headers?.get?.('ratelimit') || headers?.get?.('x-ratelimit-reset-after') || '';
  const resetMatch = String(rateLimit).match(/(?:^|[;,])\s*t=(\d+)/i);
  const resetSeconds = resetMatch ? Number(resetMatch[1]) : Number(rateLimit);
  if (Number.isFinite(resetSeconds) && resetSeconds > 0) {
    return Math.min(90_000, Math.max(1_000, Math.ceil(resetSeconds * 1000) + 750));
  }
  return fallbackMs;
}
