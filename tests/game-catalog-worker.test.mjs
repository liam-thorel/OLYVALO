import assert from 'node:assert/strict';
import test from 'node:test';
import {
  escapeIgdbSearch,
  handleRequest,
  normalizeIgdbGame,
  playerRangeFromIgdb,
} from '../workers/game-catalog/worker.mjs';

test('IGDB search text cannot inject another query statement', () => {
  assert.equal(escapeIgdbSearch('Test"; limit 500;\n'), 'Test\\"; limit 500; ');
});

test('multiplayer metadata becomes a useful editable player range', () => {
  assert.deepEqual(playerRangeFromIgdb({
    game_modes: [{ name: 'Co-operative' }],
    multiplayer_modes: [{ onlinecoop: true, onlinecoopmax: 6 }],
  }), { minPlayers: 2, maxPlayers: 6, playMode: 'multi' });
});

test('IGDB games keep their Steam identity and artwork', () => {
  const game = normalizeIgdbGame({
    id: 42,
    name: 'Example Game',
    cover: { image_id: 'co123' },
    genres: [{ name: 'Adventure' }],
    game_modes: [{ name: 'Multiplayer' }],
    multiplayer_modes: [{ onlinemax: 4 }],
    external_games: [{ category: 1, uid: '12345', url: 'https://store.steampowered.com/app/12345/' }],
  });
  assert.equal(game.steamAppId, '12345');
  assert.equal(game.coverUrl, 'https://images.igdb.com/igdb/image/upload/t_cover_big/co123.jpg');
  assert.equal(game.maxPlayers, 4);
});

test('the Worker exposes a CORS-safe normalized search endpoint', async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).startsWith('https://id.twitch.tv/')) {
      return new Response(JSON.stringify({ access_token: 'token', expires_in: 3600 }));
    }
    if (String(url).includes('/GameDB/buckets/')) return new Response('{}');
    return new Response(JSON.stringify([{ id: 7, name: 'Portal 2', game_modes: [{ name: 'Co-operative' }] }]));
  };
  const response = await handleRequest(
    new Request('https://catalog.example/search?q=Portal%202', { headers: { Origin: 'http://127.0.0.1:43173' } }),
    { TWITCH_CLIENT_ID: 'client', TWITCH_CLIENT_SECRET: 'secret' },
    fetchImpl,
  );
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'http://127.0.0.1:43173');
  assert.equal(payload.results[0].title, 'Portal 2');
  assert.equal(calls[2].options.headers.Authorization, 'Bearer token');
});

test('a short prefix uses the game index before IGDB enrichment', async () => {
  const bodies = [];
  const fetchImpl = async (url, options = {}) => {
    if (String(url).includes('/GameDB/buckets/le.json')) {
      return new Response(JSON.stringify({
        10: { name: 'Lethe' },
        212089: { name: 'Lethal Company' },
      }));
    }
    if (String(url).startsWith('https://id.twitch.tv/')) {
      return new Response(JSON.stringify({ access_token: 'token', expires_in: 3600 }));
    }
    bodies.push(options.body || '');
    return new Response(JSON.stringify([
      { id: 10, name: 'Lethe', total_rating_count: 1 },
      { id: 212089, name: 'Lethal Company', total_rating_count: 500 },
    ]));
  };
  const response = await handleRequest(
    new Request('https://catalog.example/search?q=leth'),
    { TWITCH_CLIENT_ID: 'client', TWITCH_CLIENT_SECRET: 'secret' },
    fetchImpl,
  );
  const payload = await response.json();
  assert.match(bodies[0], /where id = \(10,212089\)/);
  assert.equal(payload.results[0].title, 'Lethal Company');
});

test('a partial final word falls back to broader IGDB results', async () => {
  const bodies = [];
  const fetchImpl = async (_url, options = {}) => {
    if (String(_url).includes('/GameDB/buckets/')) return new Response('{}');
    bodies.push(options.body || '');
    if (String(options.body).includes('search "Lethal c"')) return new Response('[]');
    return new Response(JSON.stringify([
      { id: 1, name: 'Lethal Love' },
      { id: 2, name: 'Lethal Company' },
    ]));
  };
  const response = await handleRequest(
    new Request('https://catalog.example/search?q=Lethal%20c'),
    { TWITCH_CLIENT_ID: 'client', TWITCH_CLIENT_SECRET: 'secret' },
    fetchImpl,
  );
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(bodies.length, 2);
  assert.equal(payload.results[0].title, 'Lethal Company');
});
