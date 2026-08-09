import assert from 'node:assert/strict';
import {
  groupLiveSessions,
  mergeSelectedSessionData,
  stablePlayersForSession,
  stableServerForSession,
  stableSessionForRender,
} from '../js/live-sessions.mjs';

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
assert.equal(
  mergeSelectedSessionData(
    { ...sameMatchEmpty[1], server: '' },
    sameMatchEmpty[0],
    groupLiveSessions([sameMatchEmpty, ['server-writer', { ...sameMatchObserver[1], server: 'Paris' }]]),
  ).server,
  'Paris',
  'an observer missing the server inherits it only from the same match',
);

const serverCache = new Map();
assert.equal(stableServerForSession({ matchId: 'match-running', server: 'Paris' }, 'nico', serverCache), 'Paris');
assert.equal(
  stableServerForSession({ matchId: 'match-running', server: '' }, 'nico', serverCache),
  'Paris',
  'a transient empty server keeps the last server for the same match',
);
assert.equal(
  stableServerForSession({ matchId: 'match-new', server: '' }, 'nico', serverCache),
  '',
  'a new match never inherits the previous match server',
);

const rosterCache = new Map();
const runningSession = { active: true, matchId: 'match-running', mode: 'competitive', players: roster };
assert.equal(stablePlayersForSession(runningSession, rosterCache).length, 10, 'a valid roster is cached');
assert.equal(
  stablePlayersForSession({ ...runningSession, players: null }, rosterCache).length,
  10,
  'a transient null roster keeps the last valid roster for the same match',
);
assert.equal(
  stablePlayersForSession({ ...runningSession, matchId: 'match-new', players: null }, rosterCache).length,
  0,
  'a new match must not reuse the previous match roster',
);
assert.equal(
  stablePlayersForSession({
    ...runningSession,
    mode: 'agent-select',
    phase: 'pregame',
    players: null,
  }, rosterCache).length,
  0,
  'Agent Select must never reuse the previous in-game roster',
);

const richRoster = roster.map((player, index) => ({
  ...player,
  team: index < 5 ? 'ORDER' : 'CHAOS',
  rank: {
    tier: 18,
    peakTier: 21,
    peakHistorical: true,
    peakSource: 'season-history',
  },
}));
const legacyRoster = richRoster.map(player => ({
  ...player,
  rank: { tier: 18, rr: 42 },
}));
const mixedWriterCache = new Map();
stablePlayersForSession({
  active: true,
  playerName: 'RayBaz#OLY',
  matchId: 'match-running',
  mapClean: 'Breeze',
  mode: 'competitive',
  players: richRoster,
}, mixedWriterCache);
const stabilizedLegacyRoster = stablePlayersForSession({
  active: true,
  playerName: 'RayBaz#OLY',
  matchId: '',
  mapClean: 'Breeze',
  mode: 'competitive',
  players: legacyRoster,
}, mixedWriterCache);
assert.equal(
  stabilizedLegacyRoster[0].rank.peakTier,
  21,
  'an obsolete writer must not erase a known historical peak',
);
assert.equal(stabilizedLegacyRoster[0].rank.peakHistorical, true);

const pregameCache = new Map();
const pregameSession = {
  active: true,
  matchId: 'pregame-flicker',
  mapClean: 'Breeze',
  mode: 'agent-select',
  phase: 'pregame',
  players: [],
};
assert.equal(
  stableSessionForRender(pregameSession, 'rayhan', pregameCache, 1000).phase,
  'pregame',
);
assert.equal(
  stableSessionForRender({
    ...pregameSession,
    mode: 'competitive',
    phase: '',
    players: null,
  }, 'rayhan', pregameCache, 4000).phase,
  'pregame',
  'a brief empty in-game frame must not make Agent Select flash',
);
assert.equal(
  stableSessionForRender({
    ...pregameSession,
    mode: 'competitive',
    phase: '',
    players: roster,
  }, 'rayhan', pregameCache, 4500).mode,
  'competitive',
  'a real roster must switch immediately to the launched game',
);
assert.equal(
  stableSessionForRender({
    ...pregameSession,
    mode: 'competitive',
    phase: '',
    players: null,
  }, 'rayhan', pregameCache, 10000).mode,
  'competitive',
  'the visual grace must expire',
);

console.log('live-sessions: 3 matches and all swaps validated');
