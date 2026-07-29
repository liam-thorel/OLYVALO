const assert = require('node:assert/strict');
const { pregameTransition } = require('../live/pregame-utils.js');

const pregame = { matchId: 'pregame-match', map: 'Foxtrot' };

assert.deepEqual(pregameTransition(null, '', 3), { action: 'none', missedPolls: 0 });
assert.deepEqual(
  pregameTransition(pregame, 'core-match', 2),
  { action: 'game-started', missedPolls: 0 },
  'core-game must switch immediately to the normal in-game view',
);
assert.deepEqual(
  pregameTransition(pregame, '', 0, 2),
  { action: 'keep-pregame', missedPolls: 1 },
  'one transient Riot miss must keep Agent Select visible',
);
assert.deepEqual(
  pregameTransition(pregame, '', 1, 2),
  { action: 'keep-pregame', missedPolls: 2 },
);
assert.deepEqual(
  pregameTransition(pregame, '', 2, 2),
  { action: 'clear-pregame', missedPolls: 0 },
  'the cached pregame must eventually expire',
);

console.log('pregame-utils: transient misses and immediate game transition validated');
