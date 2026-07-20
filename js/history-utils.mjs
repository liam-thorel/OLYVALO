export function historyMode(game) {
  const mode = String(game?.mode || '').toLowerCase();
  if (mode.includes('deathmatch')) return 'deathmatch';
  if (mode.includes('competitive') || mode === 'comp') return 'competitive';
  return 'other';
}

export function isOpaquePlayerName(name) {
  const value = String(name || '').trim();
  return /^[0-9a-f]{8}$/i.test(value)
    || /^[0-9a-f]{8}-[0-9a-f-]{20,}$/i.test(value)
    || /^player[-_ ]?[0-9a-f]{6,}$/i.test(value);
}

export function isHistorySelf(game, player) {
  if (!game || !player) return false;
  if (game.playerPuuid && player.puuid) return game.playerPuuid === player.puuid;
  return Boolean(game.player && player.name && game.player === player.name);
}

export function historyPlayerName(game, player, index = 0) {
  const raw = String(player?.name || '').trim();
  if (isHistorySelf(game, player)) {
    const owner = String(game?.player || '').trim();
    if (owner && !isOpaquePlayerName(owner)) return owner.split('#')[0];
    if (!isOpaquePlayerName(raw)) return raw.split('#')[0];
    return 'Vous';
  }
  if (!raw || isOpaquePlayerName(raw)) return `Joueur ${index + 1}`;
  return raw.split('#')[0];
}

export function historyOwnerKey(game) {
  return String(game?.player || 'Inconnu').split('#')[0].trim().toLowerCase();
}

export function historyOwnerLabel(game, roster = []) {
  const account = historyOwnerKey(game);
  const member = roster.find(player => [player.riot, ...(player.smurfs || [])]
    .some(riot => String(riot?.name || '').trim().toLowerCase() === account));
  return member?.name || String(game?.player || 'Inconnu').split('#')[0];
}

export function filterHistoryGames(games, filters, now = Date.now()) {
  const dayKey = timestamp => {
    const date = new Date(timestamp || 0);
    return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
  };
  return games.filter(game => {
    if (filters.owner !== 'all' && historyOwnerKey(game) !== filters.owner) return false;
    if (filters.period === 'today' && dayKey(game.ts) !== dayKey(now)) return false;
    if (filters.period === '7d' && (game.ts || 0) < now - 7 * 86400000) return false;
    if (filters.view === 'matches' && filters.mode !== 'all' && historyMode(game) !== filters.mode) return false;
    return true;
  });
}

export function historyRankedPlayers(game) {
  const players = (game?.players || []).filter(player => player?.stats);
  const deathmatch = historyMode(game) === 'deathmatch';
  return [...players].sort((a, b) => {
    if (deathmatch) {
      const killDiff = (b.stats?.kills || 0) - (a.stats?.kills || 0);
      if (killDiff) return killDiff;
    }
    return (b.stats?.score || 0) - (a.stats?.score || 0);
  });
}

export function historyPlayerPerformance(game) {
  const rankedPlayers = historyRankedPlayers(game);
  const self = rankedPlayers.find(player => isHistorySelf(game, player)) || null;
  const deaths = self?.stats?.deaths || 0;
  return {
    self,
    mvp: rankedPlayers[0] || null,
    placement: self ? rankedPlayers.indexOf(self) + 1 : null,
    playerCount: rankedPlayers.length,
    kd: self ? (self.stats?.kills || 0) / Math.max(1, deaths) : null,
  };
}
