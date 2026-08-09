const assert = require('node:assert/strict');
const test = require('node:test');
const { newestBoundValorantAccount, resolveRiotIdentity } = require('../live/riot-identity.js');

const PUUID_CHAT = '11111111-1111-5111-8111-111111111111';
const PUUID_ADMIN = '22222222-2222-5222-8222-222222222222';

test('the chat identity remains authoritative when Riot exposes it', async () => {
  const calls = [];
  const result = await resolveRiotIdentity({
    lock:{ port:1234, password:'secret' }, identity:{ memberId:'nico', lastPuuid:PUUID_ADMIN },
    request:async (_port, _password, endpoint) => {
      calls.push(endpoint);
      return { ok:true, data:{ puuid:PUUID_CHAT } };
    },
  });
  assert.equal(result.puuid, PUUID_CHAT);
  assert.equal(result.source, 'chat');
  assert.deepEqual(calls, ['/chat/v1/session']);
});

test('404 Riot endpoints fall back to the newest Valorant account linked in Admin', async () => {
  const result = await resolveRiotIdentity({
    lock:{ port:1234, password:'secret' }, identity:{ memberId:'nico' },
    request:async () => ({ ok:false, status:404, data:{} }),
    getFB:async path => {
      assert.equal(path, 'rosterOverlay/accounts/nico');
      return {
        lol:{ puuid:'33333333-3333-5333-8333-333333333333', games:['lol'], updatedAt:30 },
        old:{ puuid:PUUID_CHAT, games:['valorant'], updatedAt:10 },
        current:{ puuid:PUUID_ADMIN, playerName:'phileas fogg#OLY', games:['valorant'], updatedAt:20 },
      };
    },
  });
  assert.deepEqual(result, { puuid:PUUID_ADMIN, playerName:'phileas fogg#OLY', source:'admin' });
});

test('a locally remembered PUUID avoids a Firebase dependency after first recovery', async () => {
  let firebaseReads = 0;
  const result = await resolveRiotIdentity({
    lock:{ port:1234, password:'secret' },
    identity:{ memberId:'nico', lastPuuid:PUUID_ADMIN, lastPlayerName:'Nico#OLY' },
    request:async () => ({ ok:false, status:404, data:{} }),
    getFB:async () => { firebaseReads += 1; return null; },
  });
  assert.equal(result.source, 'local');
  assert.equal(result.puuid, PUUID_ADMIN);
  assert.equal(firebaseReads, 0);
});

test('Admin selection ignores LoL accounts and keeps the newest Valorant binding', () => {
  assert.equal(newestBoundValorantAccount({ lol:{ puuid:PUUID_CHAT, games:['lol'] } }), null);
});
