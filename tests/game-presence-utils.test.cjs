const assert = require('node:assert/strict');
const { DEFAULT_GAME_END_GRACE_MS, gameAbsenceTransition } = require('../live/game-presence-utils.js');

assert.deepEqual(
  gameAbsenceTransition({ wasInGame:false, now:50_000 }),
  { action:'idle', remainingMs:0 },
);
assert.deepEqual(
  gameAbsenceTransition({ wasInGame:true, lastConfirmedAt:40_000, now:50_000 }),
  { action:'keep-game', remainingMs:DEFAULT_GAME_END_GRACE_MS - 10_000 },
);
assert.deepEqual(
  gameAbsenceTransition({ wasInGame:true, lastConfirmedAt:30_000, now:50_000 }),
  { action:'end-game', remainingMs:0 },
);

console.log('game-presence-utils: transient Riot misses keep the current game during the grace period');
