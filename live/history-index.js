function valorantHistorySummary(record = {}) {
  const players = Array.isArray(record.players) ? record.players : [];
  const self = players.find(player => record.playerPuuid && player?.puuid === record.playerPuuid)
    || players.find(player => record.player && player?.name === record.player)
    || null;
  return {
    ts: Number(record.endTs || record.ts || Date.now()),
    endTs: Number(record.endTs || 0),
    map: record.map || '',
    mode: record.mode || '',
    result: record.result || 'unknown',
    score: record.score || null,
    durationMs: Number(record.durationMs || 0),
    player: record.player || record.playerName || '',
    playerPuuid: record.playerPuuid || record.puuid || '',
    memberId: record.memberId || '',
    member: record.member || '',
    selfTeam: record.selfTeam || null,
    rr: record.rr || null,
    players: self ? [self] : [],
  };
}

function lolHistorySummary(record = {}) {
  return {
    ts: Number(record.ts || Date.now()),
    playerName: record.playerName || '',
    memberId: record.memberId || '',
    member: record.member || '',
    win: Boolean(record.win),
    champion: record.champion || null,
    queueDescription: record.queueDescription || record.queue || '',
    kills: Number(record.kills || 0),
    deaths: Number(record.deaths || 0),
    assists: Number(record.assists || 0),
    cs: Number(record.cs || 0),
    durationLabel: record.durationLabel || '',
    killParticipation: Number(record.killParticipation || 0),
    level: Number(record.level || 0),
  };
}

module.exports = { lolHistorySummary, valorantHistorySummary };
