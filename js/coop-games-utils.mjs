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

export function catalogFields(result = {}) {
  const steamAppId = String(result.steamAppId || '');
  const genres = Array.isArray(result.genres) ? result.genres.map(String).filter(Boolean).slice(0, 4) : [];
  const minPlayers = Math.max(1, Number(result.minPlayers) || 1);
  const maxPlayers = Math.max(minPlayers, Number(result.maxPlayers) || minPlayers);
  const durationHours = Math.max(0, Number(result.durationHours) || 0);
  return {
    title: String(result.title || '').trim().slice(0, 80),
    steamAppId,
    steamUrl: steamAppId ? `https://store.steampowered.com/app/${steamAppId}/` : '',
    igdbId: String(result.igdbId || ''),
    sourceUrl: String(result.sourceUrl || ''),
    catalogSource: String(result.source || ''),
    coverUrl: String(result.coverUrl || steamCover(steamAppId)),
    minPlayers,
    maxPlayers,
    session: durationHours && durationHours <= 4 ? 'short' : durationHours > 15 ? 'long' : 'medium',
    tags: genres,
    releaseDate: String(result.releaseDate || ''),
  };
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
    igdbId: String(value.igdbId || ''),
    sourceUrl: String(value.sourceUrl || ''),
    catalogSource: String(value.catalogSource || ''),
    coverUrl: String(value.coverUrl || steamCover(value.steamAppId)),
    minPlayers,
    maxPlayers,
    session: ['short', 'medium', 'long'].includes(value.session) ? value.session : 'medium',
    tags: Array.isArray(value.tags) ? value.tags.map(String).filter(Boolean).slice(0, 4) : [],
    releaseDate: String(value.releaseDate || ''),
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

export function normalizeCoopSearch(value = '') {
  return String(value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('fr')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function coopSearchScore(game = {}, query = '') {
  const wanted = normalizeCoopSearch(query);
  if (!wanted) return 1;
  const title = normalizeCoopSearch(game.title);
  const tags = (game.tags || []).map(normalizeCoopSearch);
  const details = normalizeCoopSearch([game.note, game.submittedBy].join(' '));
  const haystack = [title, ...tags, details].filter(Boolean).join(' ');
  const words = haystack.split(' ').filter(Boolean);
  const compactWanted = wanted.replaceAll(' ', '');
  const compactHaystack = haystack.replaceAll(' ', '');
  const tokens = wanted.split(' ').filter(Boolean);
  if (!tokens.every(token => words.some(word => word.startsWith(token)) || compactHaystack.includes(token))) return 0;

  let score = title === wanted ? 10_000 : title.startsWith(wanted) ? 7_000 : title.includes(wanted) ? 5_000 : 0;
  if (compactHaystack.includes(compactWanted)) score += 1_000;
  tokens.forEach(token => {
    if (title.split(' ').some(word => word.startsWith(token))) score += 500;
    if (tags.some(tag => tag === token || tag.split(' ').some(word => word.startsWith(token)))) score += 180;
    if (details.split(' ').some(word => word.startsWith(token))) score += 40;
  });
  return score || 1;
}

export function rankCatalogResults(results = [], query = '') {
  const wanted = normalizeCoopSearch(query);
  const tokens = wanted.split(/\s+/).filter(Boolean);
  const ordered = [...results].sort((left, right) => {
    const score = result => {
      if (Number.isFinite(Number(result.catalogScore))) return Number(result.catalogScore);
      const title = normalizeCoopSearch(result.title);
      if (title === wanted) return 10_000;
      let value = title.startsWith(wanted) ? 5_000 : title.includes(wanted) ? 3_000 : 0;
      value += tokens.filter(token => title.includes(token)).length * 500;
      value -= Math.abs(title.length - wanted.length);
      return value;
    };
    return score(right) - score(left);
  });
  const seenTitles = new Set();
  return ordered.filter(result => {
    const key = normalizeCoopSearch(result.title).replaceAll(' ', '');
    if (!key || seenTitles.has(key)) return false;
    seenTitles.add(key);
    return true;
  }).slice(0, 8);
}

export function filterCoopGames(games = [], filters = {}) {
  const search = String(filters.search || '').trim();
  const players = Math.max(0, Number(filters.players) || 0);
  const status = filters.status || 'open';
  const genre = normalizeCoopSearch(filters.genre || 'all');
  const scored = games.map(game => ({ game, searchScore:coopSearchScore(game, search) })).filter(({ game, searchScore }) => {
    if (status !== 'all' && game.status !== status) return false;
    if (players && !(game.minPlayers <= players && game.maxPlayers >= players)) return false;
    if (genre !== 'all' && !(game.tags || []).some(tag => normalizeCoopSearch(tag) === genre)) return false;
    return searchScore > 0;
  });
  return scored.sort((left, right) => {
    if (search && right.searchScore !== left.searchScore) return right.searchScore - left.searchScore;
    if (filters.sort === 'recent') return right.game.submittedAt - left.game.submittedAt;
    if (filters.sort === 'alpha') return left.game.title.localeCompare(right.game.title, 'fr', { sensitivity:'base' });
    return right.game.interestCount - left.game.interestCount || right.game.submittedAt - left.game.submittedAt;
  }).map(entry => entry.game);
}
