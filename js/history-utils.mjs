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

