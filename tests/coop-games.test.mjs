import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  catalogFields,
  coopSearchScore,
  extractSteamAppId,
  filterCoopGames,
  normalizeCoopGame,
  profileKey,
  rankCatalogResults,
} from '../js/coop-games-utils.mjs';
import { searchGameCatalog } from '../js/coop-game-catalog.mjs';

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

test('the async submit keeps its form reference after Firebase resolves', () => {
  const source = readFileSync(new URL('../js/coop-games-page.mjs', import.meta.url), 'utf8');
  assert.match(source, /const form = event\.currentTarget;/);
  assert.match(source, /resetGameForm\(form\);/);
  assert.doesNotMatch(source, /resetGameForm\(event\.currentTarget\);/);
  assert.doesNotMatch(source, /nextCoopStatus|coop-status-cycle/);
  assert.match(source, /data-action="set-status"/);
});
