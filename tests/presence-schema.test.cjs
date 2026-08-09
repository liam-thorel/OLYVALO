const assert = require('node:assert/strict');
const {
  PRESENCE_SCHEMA_VERSION,
  presenceRecordForPath,
  presenceTimestamp,
} = require('../live/presence-schema.js');

const now = 1_700_000_000_000;
const client = presenceRecordForPath('live/clients/p1', { online:true, state:'idle', ts:now }, now);
assert.equal(client.schemaVersion, PRESENCE_SCHEMA_VERSION);
assert.equal(client.game, 'valorant');
assert.equal(client.kind, 'client');
assert.equal(client.lifecycle, 'online');
assert.equal(client.heartbeatAt, now);

const ended = presenceRecordForPath('live/lolSessions/player', { active:false, lastSeen:now-10 }, now);
assert.equal(ended.game, 'lol');
assert.equal(ended.kind, 'session');
assert.equal(ended.lifecycle, 'ended');
assert.equal(ended.endedAt, now-10);

const nested = { blue:4, red:3 };
assert.equal(presenceRecordForPath('live/sessions/p1/score', nested, now), nested);
assert.equal(presenceRecordForPath('live/clients/p1', null, now), null);
assert.equal(presenceTimestamp({ lastSeen:1_700_000_000 }, now), now);

console.log('presence-schema: shared client/session envelope validated');
