import assert from 'node:assert/strict';
import { groupLiveSessions, mergeSelectedSessionData } from '../js/live-sessions.mjs';

const roster = Array.from({ length: 10 }, (_, index) => ({
  puuid: `player-${index}`,
  name: `Player ${index}`,
}));

const active = [
  ['friend-game', { matchId: 'match-running', mapClean: 'Ascent', mode: 'competitive', players: roster }],
  ['me-select', { matchId: 'match-select-me', mapClean: 'Split', mode: 'agent-select', phase: 'pregame', players: [] }],
  ['friend-select', { matchId: 'match-select-friend', mapClean: 'Bind', mode: 'agent-select', phase: 'pregame', players: [] }],
];

const groups = groupLiveSessions(active);
assert.equal(Object.keys(groups).length, 3, 'three different matches must create three choices');

const running = mergeSelectedSessionData(active[0][1], active[0][0], groups);
assert.equal(running.players.length, 10, 'the running game keeps its roster');

const mySelect = mergeSelectedSessionData(active[1][1], active[1][0], groups);
assert.equal(mySelect.mapClean, 'Split');
assert.equal(mySelect.phase, 'pregame');
assert.equal(mySelect.players.length, 0, 'an Agent Select must not borrow another match roster');

const friendSelect = mergeSelectedSessionData(active[2][1], active[2][0], groups);
assert.equal(friendSelect.mapClean, 'Bind');
assert.equal(friendSelect.phase, 'pregame');
assert.equal(friendSelect.players.length, 0, 'another Agent Select remains independent');

const sameMatchObserver = ['friend-game-2', {
  matchId: 'match-running', mapClean: 'Ascent', mode: 'competitive', players: roster,
}];
const sameMatchEmpty = ['friend-game-loading', {
  matchId: 'match-running', mapClean: 'Ascent', mode: 'competitive', players: [],
}];
const groupedObservers = groupLiveSessions([...active.slice(1), sameMatchObserver, sameMatchEmpty]);
assert.equal(Object.keys(groupedObservers).length, 3, 'two clients in the same match create one choice');
const mergedObserver = mergeSelectedSessionData(sameMatchEmpty[1], sameMatchEmpty[0], groupedObservers);
assert.equal(mergedObserver.players.length, 10, 'roster sharing is allowed inside the same match');

console.log('live-sessions: 3 matches and all swaps validated');
