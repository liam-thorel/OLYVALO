import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractSteamAppId,
  filterCoopGames,
  nextCoopStatus,
  normalizeCoopGame,
  profileKey,
} from '../js/coop-games-utils.mjs';

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
