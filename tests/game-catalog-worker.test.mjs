import assert from 'node:assert/strict';
import test from 'node:test';
import {
  escapeIgdbSearch,
  handleRequest,
  igdbSearchScore,
  normalizeIgdbGame,
  normalizeSteamReviewSummary,
  playerRangeFromIgdb,
} from '../workers/game-catalog/worker.mjs';

test('a famous prefix match outranks an obscure exact title', () => {
  const obscure = { name:'Mine', total_rating_count:1, follows:0, hypes:0, first_release_date:1_500_000_000 };
  const minecraft = { name:'Minecraft', total_rating_count:25_000, follows:80_000, hypes:0, first_release_date:1_247_875_200 };
  assert.ok(igdbSearchScore(minecraft, 'mine') > igdbSearchScore(obscure, 'mine'));
});

test('recent attention helps current games with the same title relevance', () => {
  const now = Date.UTC(2026, 7, 23);
  const oldGame = { name:'Party Classic', total_rating_count:40, follows:20, first_release_date:1_400_000_000 };
  const currentGame = { name:'Party Crashers', total_rating_count:40, follows:20, hypes:80, first_release_date:Math.floor(Date.UTC(2026, 4, 1) / 1000) };
  assert.ok(igdbSearchScore(currentGame, 'party', now) > igdbSearchScore(oldGame, 'party', now));
});

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

test('Steam review totals become a stable positive percentage', () => {
  assert.deepEqual(normalizeSteamReviewSummary('1966720', {
    query_summary: {
      review_score:9,
      review_score_desc:'Overwhelmingly Positive',
      total_positive:970,
      total_negative:30,
      total_reviews:1000,
    },
  }), {
    steamAppId:'1966720',
    available:true,
    reviewScore:9,
    reviewScoreDescription:'Overwhelmingly Positive',
    totalPositive:970,
    totalNegative:30,
    totalReviews:1000,
    positivePercent:97,
  });
});

test('the Worker batches Steam review summaries without failing the whole list', async () => {
  const calls = [];
  const response = await handleRequest(
    new Request('https://catalog.example/reviews?ids=1966720,1245620,invalid'),
    {},
    async url => {
      calls.push(String(url));
      if (String(url).includes('/1245620?')) return new Response('', { status:503 });
      return new Response(JSON.stringify({ query_summary:{ total_positive:90, total_negative:10, total_reviews:100 } }));
    },
  );
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'public, max-age=1800');
  assert.equal(calls.length, 2);
  assert.equal(payload.reviews[0].positivePercent, 90);
  assert.equal(payload.reviews[0].available, true);
  assert.equal(payload.reviews[1].available, false);
  assert.equal(payload.reviews[1].totalReviews, 0);
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
