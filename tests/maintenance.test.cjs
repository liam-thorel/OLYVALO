const assert = require('node:assert/strict');
const {
  cleanupStalePresence,
  ENDED_PRESENCE_MS,
  stalePresenceKeys,
  stalePresenceKeysForPath,
  STALE_PRESENCE_MS,
} = require('../live/maintenance.js');

const now = 2 * STALE_PRESENCE_MS;
assert.deepEqual(stalePresenceKeys({
  fresh: { ts: now - 1000 },
  stale: { ts: now - STALE_PRESENCE_MS - 1 },
  missing: { online: false },
}, now), ['stale']);
assert.deepEqual(stalePresenceKeys({ lol:{ lastSeen:now-STALE_PRESENCE_MS-1 } }, now), ['lol']);
assert.deepEqual(stalePresenceKeysForPath('live/clients', {
  ended:{ online:false, heartbeatAt:now-ENDED_PRESENCE_MS-1 },
  recent:{ online:false, heartbeatAt:now-ENDED_PRESENCE_MS+1 },
}, now), ['ended']);

const deleted = [];
cleanupStalePresence({
  now,
  paths: ['live/clients', 'live/sessions'],
  getFB: async path => ({
    'live/clients': { oldClient: { ts: 1 }, currentClient: { ts: now } },
    'live/sessions': { oldSession: { ts: 1 } },
    'live/clients/oldClient': { ts: 1 },
    'live/sessions/oldSession': { ts: 1 },
  }[path] || null),
  putFB: async (path, value) => {
    assert.equal(value, null);
    deleted.push(path);
    return true;
  },
}).then(count => {
  assert.equal(count, 2);
  assert.deepEqual(deleted.sort(), ['live/clients/oldClient', 'live/sessions/oldSession']);
  console.log('maintenance: stale presence cleanup validated');
});
