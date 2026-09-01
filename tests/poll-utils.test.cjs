const assert = require('node:assert/strict');
const { createExclusivePoller } = require('../live/poll-utils.js');

let release;
let calls = 0;
const firstTask = new Promise(resolve => { release = resolve; });
const poll = createExclusivePoller(async () => {
  calls += 1;
  await firstTask;
});

(async () => {
  const first = poll();
  assert.equal(await poll(), false, 'a second poll must be skipped while the first is running');
  assert.equal(calls, 1);
  release();
  assert.equal(await first, true);

  const errors = [];
  const failingPoll = createExclusivePoller(async () => { throw new Error('temporary'); }, error => errors.push(error.message));
  assert.equal(await failingPoll(), false);
  assert.deepEqual(errors, ['temporary']);
  assert.equal(await failingPoll(), false, 'the lock must be released after an error');
  assert.equal(errors.length, 2);

  console.log('poll-utils: overlapping polls are skipped and the lock is always released');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
