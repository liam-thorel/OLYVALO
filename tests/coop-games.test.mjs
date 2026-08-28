import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  canDeleteCoopGame,
  catalogFields,
  coopSelectedProfile,
  coopSearchScore,
  extractSteamAppId,
  filterCoopGames,
  normalizeCoopGame,
  profileKey,
  rankCatalogResults,
} from '../js/coop-games-utils.mjs';
import { firebaseRequest } from '../js/coop-games-page.mjs';
import { fetchSteamReviewSummaries, searchGameCatalog } from '../js/coop-game-catalog.mjs';

test('Steam links and raw app ids resolve to one stable id', () => {
  assert.equal(extractSteamAppId('https://store.steampowered.com/app/1245620/ELDEN_RING/'), '1245620');
  assert.equal(extractSteamAppId('1245620'), '1245620');
  assert.equal(extractSteamAppId('https://example.com/app/1245620'), '');
});

test('the selected OLYCITY profile becomes a Firebase-safe vote key', () => {
  assert.equal(profileKey('Noé'), 'noe');
  assert.equal(profileKey('M A I R'), 'm-a-i-r');
});

test('games filter by status, exact group compatibility and popularity', () => {
  const games = [
    normalizeCoopGame('a', { title: 'Short coop', minPlayers: 2, maxPlayers: 4, interests: { nico: {}, liam: {} }, submittedAt: 1 }),
    normalizeCoopGame('b', { title: 'Big party', minPlayers: 5, maxPlayers: 8, interests: { nico: {} }, submittedAt: 2 }),
    normalizeCoopGame('c', { title: 'Played coop', minPlayers: 2, maxPlayers: 4, status: 'played', interests: { nico: {}, liam: {}, noe: {} } }),
  ];
  assert.deepEqual(filterCoopGames(games, { players: 3, status: 'open' }).map(game => game.id), ['a']);
  assert.deepEqual(filterCoopGames(games, { status: 'all' }).map(game => game.id), ['c', 'a', 'b']);
});

test('search tolerates accents, partial words and ranks title matches first', () => {
  const games = [
    normalizeCoopGame('a', { title:'Évasion coop', tags:['Aventure'], interests:{ nico:{} } }),
    normalizeCoopGame('b', { title:'Le grand jeu', note:'Une évasion entre amis', interests:{} }),
    normalizeCoopGame('c', { title:'Simulation', tags:['Gestion'] }),
  ];
  assert.ok(coopSearchScore(games[0], 'evas') > coopSearchScore(games[1], 'evas'));
  assert.deepEqual(filterCoopGames(games, { search:'évas', status:'all' }).map(game => game.id), ['a', 'b']);
});

test('Logan remains a valid Coop voter from the static member list', () => {
  const profile = coopSelectedProfile([
    { id:'logan', name:'Logan', avatar:'https://example.com/logan.png' },
  ], 'Logan');
  assert.deepEqual(profile, { id:'logan', name:'Logan', avatar:'https://example.com/logan.png' });
  assert.equal(profileKey(profile.name), 'logan');
});

test('only Nico and Liam profiles can expose destructive game controls', () => {
  assert.equal(canDeleteCoopGame({ id:'nico', name:'Nico' }), true);
  assert.equal(canDeleteCoopGame({ id:'liam', name:'Liam' }), true);
  assert.equal(canDeleteCoopGame({ id:'rayhan', name:'Rayhan' }), false);
  assert.equal(canDeleteCoopGame({ name:'Nico' }), false);
  assert.equal(canDeleteCoopGame(null), false);
});

test('genre and alphabetical sorting use existing metadata without rewriting games', () => {
  const games = [
    normalizeCoopGame('z', { title:'Zulu', tags:['Horreur'] }),
    normalizeCoopGame('a', { title:'Alpha', tags:['Aventure'] }),
    normalizeCoopGame('b', { title:'Beta', tags:['Horreur'] }),
  ];
  assert.deepEqual(filterCoopGames(games, { genre:'horreur', status:'all', sort:'alpha' }).map(game => game.id), ['b', 'z']);
});

test('catalog results trust server popularity and collapse duplicate titles', () => {
  const results = rankCatalogResults([
    { title:'Mine', catalogScore:5_500 },
    { title:'Minecraft', catalogScore:9_500 },
    { title:'Mine', catalogScore:5_000 },
    { title:'Minerva', catalogScore:4_500 },
  ], 'mine');
  assert.deepEqual(results.map(result => result.title), ['Minecraft', 'Mine', 'Minerva']);
});

test('catalog metadata fills the suggestion form with editable defaults', () => {
  assert.deepEqual(catalogFields({
    title: 'Lethal Company',
    steamAppId: 1966720,
    igdbId: 212721,
    source: 'steam+igdb',
    coverUrl: 'https://example.com/cover.jpg',
    genres: ['Indépendant', 'Horreur', 'Survie', 'Coop', 'Extra'],
    minPlayers: 2,
    maxPlayers: 4,
    durationHours: 3,
    releaseDate: '2023-10-23',
  }), {
    title: 'Lethal Company',
    steamAppId: '1966720',
    steamUrl: 'https://store.steampowered.com/app/1966720/',
    igdbId: '212721',
    sourceUrl: '',
    catalogSource: 'steam+igdb',
    coverUrl: 'https://example.com/cover.jpg',
    minPlayers: 2,
    maxPlayers: 4,
    session: 'short',
    tags: ['Indépendant', 'Horreur', 'Survie', 'Coop'],
    releaseDate: '2023-10-23',
  });
});

test('catalog search accepts a Steam link and uses the configured proxy', async () => {
  let requested = '';
  const controller = new AbortController();
  const results = await searchGameCatalog('https://store.steampowered.com/app/1966720/Lethal_Company/', {
    endpoint: 'https://catalog.example.test/',
    signal: controller.signal,
    fetchImpl: async (url, options) => {
      requested = String(url);
      assert.equal(options.signal, controller.signal);
      return new Response(JSON.stringify({ results: [{ title: 'Lethal Company' }] }), {
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });
  assert.equal(new URL(requested).searchParams.get('steamAppId'), '1966720');
  assert.equal(results[0].title, 'Lethal Company');
});

test('Steam review summaries are fetched once for unique valid app ids', async () => {
  let requested = '';
  const reviews = await fetchSteamReviewSummaries(['1966720', '1966720', 'invalid', '1245620'], {
    endpoint:'https://catalog.example.test',
    fetchImpl:async url => {
      requested = String(url);
      return new Response(JSON.stringify({ reviews:[{ steamAppId:'1966720', positivePercent:97 }] }));
    },
  });
  assert.equal(new URL(requested).pathname, '/reviews');
  assert.equal(new URL(requested).searchParams.get('ids'), '1966720,1245620');
  assert.equal(reviews[0].positivePercent, 97);
});

test('the async submit keeps its form reference after Firebase resolves', () => {
  const source = readFileSync(new URL('../js/coop-games-page.mjs', import.meta.url), 'utf8');
  assert.match(source, /const form = event\.currentTarget;/);
  assert.match(source, /resetGameForm\(form\);/);
  assert.doesNotMatch(source, /resetGameForm\(event\.currentTarget\);/);
  assert.doesNotMatch(source, /nextCoopStatus|coop-status-cycle/);
  assert.match(source, /data-action="set-status"/);
  assert.match(source, /data-action="delete"/);
  assert.match(source, /method: 'DELETE'/);
  assert.match(source, /sort: 'recent'/);
  assert.match(source, /fetchSteamReviewSummaries/);
});

test('an idempotent Coop vote retries one aborted Firebase connection', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) throw new DOMException('aborted', 'AbortError');
    return new Response(JSON.stringify({ ok:true }), { status:200, headers:{ 'Content-Type':'application/json' } });
  };
  try {
    const result = await firebaseRequest('coopGames/test/interests/logan', {
      method:'PUT', body:JSON.stringify({ name:'Logan' }), timeoutMs:200,
    });
    assert.deepEqual(result, { ok:true });
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
