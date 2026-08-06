const SOLO_QUEUE_ID = 420;

function historyGames(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.games?.games)) return payload.games.games;
  if (Array.isArray(payload?.games)) return payload.games;
  if (Array.isArray(payload?.matches)) return payload.matches;
  return [];
}

function soloRankFromStats(payload) {
  const queues = Array.isArray(payload?.queues) ? payload.queues : [];
  const entry = queues.find(queue => queue.queueType === 'RANKED_SOLO_5x5');
  if (!entry) return null;
  const wins = Number(entry.wins ?? entry.winCount ?? 0);
  const losses = Number(entry.losses ?? entry.lossCount ?? 0);
  const games = wins + losses;
  return {
    tier: entry.tier || '',
    division: entry.division || '',
    lp: entry.leaguePoints ?? null,
    wins,
    losses,
    games,
    winRate: games ? Math.round((wins / games) * 100) : 0,
  };
}

function participantFor(game, identity = {}) {
  const participants = Array.isArray(game?.participants) ? game.participants : [];
  const ids = new Set([identity.puuid, identity.summonerId, identity.accountId].filter(Boolean).map(String));
  const direct = participants.find(participant =>
    participant?.isLocalPlayer || [participant?.puuid, participant?.summonerId, participant?.accountId]
      .filter(Boolean).some(value => ids.has(String(value)))
  );
  if (direct) return direct;

  const identities = Array.isArray(game?.participantIdentities) ? game.participantIdentities : [];
  const ownIdentity = identities.find(item => {
    const player = item?.player || {};
    return [player.puuid, player.summonerId, player.accountId]
      .filter(Boolean).some(value => ids.has(String(value)));
  });
  if (ownIdentity) return participants.find(participant => participant.participantId === ownIdentity.participantId) || null;
  return participants.length === 1 ? participants[0] : null;
}

function roleKey(participant = {}) {
  const timeline = participant.timeline || {};
  const stats = participant.stats || {};
  const role = String(participant.teamPosition || participant.individualPosition || participant.assignedPosition || stats.teamPosition || timeline.role || '').toUpperCase();
  const lane = String(participant.lane || stats.lane || timeline.lane || '').toUpperCase();
  const raw = role || lane;
  if (raw.includes('UTILITY') || raw.includes('SUPPORT')) return 'support';
  if (raw.includes('JUNGLE')) return 'jungle';
  if (raw.includes('MIDDLE') || raw === 'MID') return 'mid';
  if (raw.includes('BOTTOM') || raw.includes('BOT') || raw.includes('CARRY')) return 'adc';
  if (raw.includes('TOP')) return 'top';
  if (lane === 'BOTTOM' && role.includes('SUPPORT')) return 'support';
  return '';
}

function numeric(source, ...keys) {
  for (const key of keys) {
    const value = source?.[key];
    if (typeof value === 'number') return value;
  }
  return 0;
}

function summarizeSoloQueue(payload, identity = {}, championById = {}, seasonStart = 0) {
  const champions = new Map();
  const roles = { top: 0, jungle: 0, mid: 0, adc: 0, support: 0 };
  let games = 0;
  let wins = 0;

  historyGames(payload).forEach(game => {
    const queueId = Number(game?.queueId ?? game?.queue?.id ?? 0);
    const queueType = String(game?.queueType || game?.queue?.type || '');
    if (queueId !== SOLO_QUEUE_ID && queueType !== 'RANKED_SOLO_5x5') return;
    const createdAt = Number(game?.gameCreation ?? game?.gameCreationDate ?? game?.gameStartTimestamp ?? 0);
    if (seasonStart && createdAt && createdAt < seasonStart) return;
    const participant = participantFor(game, identity);
    if (!participant) return;
    const stats = participant.stats || participant;
    const championId = Number(participant.championId ?? stats.championId ?? 0);
    if (!championId) return;
    const won = stats.win === true || String(stats.win).toLowerCase() === 'true' || stats.WIN === 1;
    const kills = numeric(stats, 'kills', 'CHAMPIONS_KILLED');
    const deaths = numeric(stats, 'deaths', 'NUM_DEATHS');
    const assists = numeric(stats, 'assists', 'ASSISTS');
    const info = championById[championId] || {};
    const current = champions.get(championId) || { championId, name: info.name || `Champion ${championId}`, image: info.image || '', games: 0, wins: 0, kills: 0, deaths: 0, assists: 0 };
    current.games += 1;
    current.wins += won ? 1 : 0;
    current.kills += kills;
    current.deaths += deaths;
    current.assists += assists;
    champions.set(championId, current);
    const role = roleKey(participant);
    if (role) roles[role] += 1;
    games += 1;
    wins += won ? 1 : 0;
  });

  const topChampions = [...champions.values()]
    .sort((a, b) => b.games - a.games || b.wins - a.wins || a.name.localeCompare(b.name))
    .slice(0, 3)
    .map(champion => ({
      ...champion,
      losses: champion.games - champion.wins,
      winRate: champion.games ? Math.round((champion.wins / champion.games) * 100) : 0,
      kda: Number(((champion.kills + champion.assists) / Math.max(1, champion.deaths)).toFixed(2)),
    }));
  const mainRole = Object.entries(roles).sort((left, right) => right[1] - left[1])[0];
  return {
    games,
    wins,
    losses: games - wins,
    winRate: games ? Math.round((wins / games) * 100) : 0,
    roles,
    mainRole: mainRole?.[1] ? mainRole[0] : '',
    topChampions,
  };
}

module.exports = { SOLO_QUEUE_ID, historyGames, participantFor, roleKey, soloRankFromStats, summarizeSoloQueue };
