const test = require('node:test');
const assert = require('node:assert/strict');
const { syncRosterProfiles } = require('../live/lol-watcher');

test('full roster sync publishes all six profiles and season role estimates', async () => {
  const writes = [];
  const result = await syncRosterProfiles({
    scriptVersion: 'test',
    fetchProfile: async riotId => ({ playerName:riotId, soloQueue:{ games:10 }, topChampions:[] }),
    putFB: async (path, value) => { writes.push({ path, value }); return true; },
  });
  assert.equal(result.updated, 6);
  assert.deepEqual(result.failures, []);
  assert.equal(writes.length, 6);
  assert.equal(writes.find(write => write.value.playerName === 'NoWaY#alone').value.soloQueue.mainRole, 'adc');
  assert.equal(writes.find(write => write.value.playerName === 'RayBaz#OLY').value.soloQueue.mainRole, 'top');
  assert.equal(writes.find(write => write.value.playerName === 'M A I R#LGND').value.soloQueue.mainRole, 'mid');
});

test('one unavailable profile does not block the remaining roster', async () => {
  const writes = [];
  const result = await syncRosterProfiles({
    scriptVersion: 'test',
    fetchProfile: async riotId => {
      if (riotId === 'RayBaz#OLY') throw new Error('unavailable');
      return { playerName:riotId, soloQueue:{}, topChampions:[] };
    },
    putFB: async (path, value) => { writes.push({ path, value }); return true; },
  });
  assert.equal(result.updated, 5);
  assert.deepEqual(result.failures, ['RayBaz#OLY']);
  assert.equal(writes.length, 5);
});
