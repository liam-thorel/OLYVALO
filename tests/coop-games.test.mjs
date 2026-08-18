import test from 'node:test';
import assert from 'node:assert/strict';
import {
  catalogFields,
  extractSteamAppId,
  filterCoopGames,
  nextCoopStatus,
  normalizeCoopGame,
  profileKey,
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

test('game status cycles through the three useful group states', () => {
  assert.equal(nextCoopStatus('open'), 'planned');
  assert.equal(nextCoopStatus('planned'), 'played');
  assert.equal(nextCoopStatus('played'), 'open');
  assert.equal(nextCoopStatus('replay'), 'planned');
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
  const results = await searchGameCatalog('https://store.steampowered.com/app/1966720/Lethal_Company/', {
    endpoint: 'https://catalog.example.test/',
    fetchImpl: async url => {
      requested = String(url);
      return new Response(JSON.stringify({ results: [{ title: 'Lethal Company' }] }), {
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });
  assert.equal(new URL(requested).searchParams.get('steamAppId'), '1966720');
  assert.equal(results[0].title, 'Lethal Company');
});
