const IGDB_URL = 'https://api.igdb.com/v4/games';
const TWITCH_TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
const STEAM_DETAILS_URL = 'https://store.steampowered.com/api/appdetails';

let accessToken = '';
let accessTokenExpiresAt = 0;

const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
});

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const configured = String(env.SITE_ORIGIN || 'https://liam-thorel.github.io').replace(/\/$/, '');
  const allowed = origin === configured
    || /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin);
  return {
    'Access-Control-Allow-Origin': allowed ? origin : configured,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Accept, Content-Type',
    Vary: 'Origin',
  };
}

export function escapeIgdbSearch(value = '') {
  return String(value).replace(/["\\\r\n]/g, char => char === '"' ? '\\"' : char === '\\' ? '\\\\' : ' ');
}

function positive(values = []) {
  return values.map(Number).filter(value => Number.isFinite(value) && value > 0);
}

export function playerRangeFromIgdb(game = {}) {
  const modes = Array.isArray(game.multiplayer_modes) ? game.multiplayer_modes : [];
  const gameModes = (game.game_modes || []).map(mode => String(mode.name || '').toLowerCase());
  const coop = modes.some(mode => mode.onlinecoop || mode.offlinecoop) || gameModes.some(name => name.includes('co-op'));
  const multiplayer = coop || modes.length > 0 || gameModes.some(name => name.includes('multiplayer'));
  const maxima = positive(modes.flatMap(mode => [
    mode.onlinecoopmax,
    mode.offlinecoopmax,
    mode.onlinemax,
    mode.offlinemax,
  ]));
  return {
    minPlayers: multiplayer ? 2 : 1,
    maxPlayers: maxima.length ? Math.max(...maxima) : multiplayer ? 4 : 1,
    playMode: multiplayer ? 'multi' : 'solo',
  };
}

function steamExternal(game = {}) {
  return (game.external_games || []).find(item => Number(item.category) === 1
    || /store\.steampowered\.com\/app\//i.test(item.url || ''));
}

export function normalizeIgdbGame(game = {}, steamOverride = null) {
  const range = playerRangeFromIgdb(game);
  const steam = steamOverride || steamExternal(game);
  const steamAppId = String(steam?.uid || steam?.appid || '');
  const coverUrl = steamOverride?.header_image
    || (game.cover?.image_id ? `https://images.igdb.com/igdb/image/upload/t_cover_big/${game.cover.image_id}.jpg` : '')
    || (steamAppId ? `https://cdn.cloudflare.steamstatic.com/steam/apps/${steamAppId}/header.jpg` : '');
  const durationSeconds = Number(game.game_time_to_beats?.normally) || 0;
  return {
    id: `igdb:${game.id}`,
    igdbId: String(game.id || ''),
    steamAppId,
    source: steamAppId ? 'steam+igdb' : 'igdb',
    sourceUrl: steamAppId ? `https://store.steampowered.com/app/${steamAppId}/` : game.url || '',
    title: String(steamOverride?.name || game.name || '').trim(),
    coverUrl,
    genres: (game.genres || []).map(genre => genre.name).filter(Boolean).slice(0, 4),
    ...range,
    durationHours: durationSeconds ? Math.round(durationSeconds / 360) / 10 : 0,
    releaseDate: game.first_release_date ? new Date(game.first_release_date * 1000).toISOString().slice(0, 10) : '',
    summary: String(steamOverride?.short_description || game.summary || '').replace(/<[^>]+>/g, '').trim().slice(0, 500),
  };
}

async function twitchToken(env, fetchImpl) {
  if (accessToken && Date.now() < accessTokenExpiresAt) return accessToken;
  if (!env.TWITCH_CLIENT_ID || !env.TWITCH_CLIENT_SECRET) throw new Error('IGDB_NOT_CONFIGURED');
  const url = new URL(TWITCH_TOKEN_URL);
  url.searchParams.set('client_id', env.TWITCH_CLIENT_ID);
  url.searchParams.set('client_secret', env.TWITCH_CLIENT_SECRET);
  url.searchParams.set('grant_type', 'client_credentials');
  const response = await fetchImpl(url, { method: 'POST' });
  if (!response.ok) throw new Error(`TWITCH_HTTP_${response.status}`);
  const payload = await response.json();
  accessToken = payload.access_token;
  accessTokenExpiresAt = Date.now() + Math.max(60, Number(payload.expires_in) - 300) * 1000;
  return accessToken;
}

function rankIgdbResults(games = [], query = '') {
  const wanted = String(query).toLowerCase().trim();
  const tokens = wanted.split(/\s+/).filter(Boolean);
  return [...games].sort((left, right) => {
    const score = game => {
      const title = String(game.name || '').toLowerCase();
      if (title === wanted) return 10000;
      let value = title.startsWith(wanted) ? 5000 : title.includes(wanted) ? 3000 : 0;
      value += tokens.filter(token => title.includes(token)).length * 500;
      value -= Math.abs(title.length - wanted.length);
      return value;
    };
    return score(right) - score(left);
  });
}

async function fetchIgdbGames(query, env, fetchImpl, limit = 30) {
  const token = await twitchToken(env, fetchImpl);
  const body = `search "${escapeIgdbSearch(query)}"; fields id,name,slug,summary,url,cover.image_id,genres.name,game_modes.name,multiplayer_modes.onlinecoop,multiplayer_modes.offlinecoop,multiplayer_modes.onlinecoopmax,multiplayer_modes.offlinecoopmax,multiplayer_modes.onlinemax,multiplayer_modes.offlinemax,first_release_date,external_games.category,external_games.uid,external_games.url; where version_parent = null; limit ${limit};`;
  const response = await fetchImpl(IGDB_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Client-ID': env.TWITCH_CLIENT_ID,
      Authorization: `Bearer ${token}`,
    },
    body,
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    console.error('IGDB request rejected', response.status, detail);
    throw new Error(`IGDB_HTTP_${response.status}`);
  }
  return response.json();
}

async function igdbSearch(query, env, fetchImpl) {
  let games = await fetchIgdbGames(query, env, fetchImpl);
  const words = String(query).trim().split(/\s+/).filter(Boolean);
  if (!games.length && words.length > 1) {
    games = await fetchIgdbGames(words.slice(0, -1).join(' '), env, fetchImpl, 50);
  }
  return rankIgdbResults(games, query).slice(0, 12);
}

async function steamDetails(appId, fetchImpl) {
  const url = new URL(STEAM_DETAILS_URL);
  url.searchParams.set('appids', appId);
  url.searchParams.set('l', 'french');
  url.searchParams.set('cc', 'FR');
  const response = await fetchImpl(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`STEAM_HTTP_${response.status}`);
  const payload = await response.json();
  if (!payload?.[appId]?.success) throw new Error('STEAM_NOT_FOUND');
  return payload[appId].data;
}

async function searchBySteam(appId, env, fetchImpl) {
  const steam = await steamDetails(appId, fetchImpl);
  const candidates = await igdbSearch(steam.name, env, fetchImpl);
  const matched = candidates.find(game => String(steamExternal(game)?.uid || '') === String(appId)) || candidates[0];
  if (matched) return [normalizeIgdbGame(matched, { ...steam, uid: appId })];
  const multiplayer = (steam.categories || []).some(category => /multi|coop|co-op/i.test(category.description || ''));
  return [{
    id: `steam:${appId}`,
    igdbId: '',
    steamAppId: String(appId),
    source: 'steam',
    sourceUrl: `https://store.steampowered.com/app/${appId}/`,
    title: steam.name,
    coverUrl: steam.header_image || `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/header.jpg`,
    genres: (steam.genres || []).map(genre => genre.description).filter(Boolean).slice(0, 4),
    minPlayers: multiplayer ? 2 : 1,
    maxPlayers: multiplayer ? 4 : 1,
    playMode: multiplayer ? 'multi' : 'solo',
    durationHours: 0,
    releaseDate: '',
    summary: String(steam.short_description || '').replace(/<[^>]+>/g, '').trim().slice(0, 500),
  }];
}

export async function handleRequest(request, env, fetchImpl = fetch) {
  const cors = corsHeaders(request, env);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.pathname !== '/search') return json({ error: 'Not found' }, 404, cors);
  try {
    const steamAppId = String(url.searchParams.get('steamAppId') || '');
    const query = String(url.searchParams.get('q') || '').trim();
    if (steamAppId && /^\d{2,10}$/.test(steamAppId)) {
      return json({ results: await searchBySteam(steamAppId, env, fetchImpl) }, 200, cors);
    }
    if (query.length < 2 || query.length > 80) return json({ error: 'Recherche invalide' }, 400, cors);
    const games = await igdbSearch(query, env, fetchImpl);
    return json({ results: games.map(game => normalizeIgdbGame(game)) }, 200, cors);
  } catch (error) {
    console.error('Game catalog search failed', error);
    const message = error.message === 'IGDB_NOT_CONFIGURED'
      ? 'Le catalogue IGDB n’est pas configuré.'
      : 'La recherche de jeux est temporairement indisponible.';
    return json({ error: message }, 502, cors);
  }
}

export default {
  fetch(request, env) {
    return handleRequest(request, env);
  },
};
