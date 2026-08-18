export function profileKey(name = '') {
  return String(name)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-+|-+$)/g, '');
}

export function extractSteamAppId(value = '') {
  const text = String(value).trim();
  if (/^\d{2,10}$/.test(text)) return text;
  const match = text.match(/store\.steampowered\.com\/app\/(\d{2,10})(?:[/?#]|$)/i);
  return match?.[1] || '';
}

export function steamCover(appId = '') {
  return /^\d+$/.test(String(appId))
    ? `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/header.jpg`
    : '';
}

export function normalizeCoopGame(id, value = {}) {
  const minPlayers = Math.max(1, Number(value.minPlayers) || 1);
  const maxPlayers = Math.max(minPlayers, Number(value.maxPlayers) || minPlayers);
  const interests = value.interests && typeof value.interests === 'object' ? value.interests : {};
  return {
    id,
    title: String(value.title || 'Jeu sans titre').trim(),
    steamAppId: String(value.steamAppId || ''),
    steamUrl: String(value.steamUrl || ''),
    coverUrl: String(value.coverUrl || steamCover(value.steamAppId)),
    minPlayers,
    maxPlayers,
    session: ['short', 'medium', 'long'].includes(value.session) ? value.session : 'medium',
    tags: Array.isArray(value.tags) ? value.tags.map(String).filter(Boolean).slice(0, 4) : [],
    note: String(value.note || '').trim(),
    submittedBy: String(value.submittedBy || 'OLYCITY'),
    submittedAt: Number(value.submittedAt) || 0,
    status: ['open', 'planned', 'played', 'replay'].includes(value.status) ? value.status : 'open',
    replayNote: String(value.replayNote || '').trim(),
    statusBy: String(value.statusBy || '').trim(),
    statusAt: Number(value.statusAt) || 0,
    interests,
    interestCount: Object.keys(interests).length,
  };
}

export function filterCoopGames(games = [], filters = {}) {
  const search = String(filters.search || '').trim().toLocaleLowerCase('fr');
  const players = Math.max(0, Number(filters.players) || 0);
  const status = filters.status || 'open';
  const result = games.filter(game => {
    if (status !== 'all' && game.status !== status) return false;
    if (players && !(game.minPlayers <= players && game.maxPlayers >= players)) return false;
    if (!search) return true;
    return [game.title, game.note, ...(game.tags || [])]
      .join(' ')
      .toLocaleLowerCase('fr')
      .includes(search);
  });
  return result.sort((a, b) => filters.sort === 'recent'
    ? b.submittedAt - a.submittedAt
    : b.interestCount - a.interestCount || b.submittedAt - a.submittedAt);
}

export function nextCoopStatus(status = 'open') {
  return status === 'open' || status === 'replay' ? 'planned' : status === 'planned' ? 'played' : 'open';
}
