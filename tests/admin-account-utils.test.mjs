import test from 'node:test';
import assert from 'node:assert/strict';
import { accountLiveState, discoveryRows, normalizeGames, sameRiotAccount } from '../js/admin-account-utils.mjs';

test('legacy accounts stay Valorant-only unless explicitly scoped', () => {
  assert.deepEqual(normalizeGames({ name:'Old' }), ['valorant']);
  assert.deepEqual(normalizeGames({ games:['lol','valorant','lol'] }), ['lol','valorant']);
});

test('accounts match by PUUID or case-insensitive Riot ID', () => {
  assert.equal(sameRiotAccount({ puuid:'abc' }, { puuid:'abc' }), true);
  assert.equal(sameRiotAccount({ name:'Phileas Fogg', tag:'OLY' }, { playerName:'phileas fogg#oly' }), true);
});

test('assigned and ignored LoL clients disappear from discovery', () => {
  const clients = {
    nico:{ playerName:'phileas fogg#OLY', puuid:'p1', lastSeen:30 },
    liam:{ playerName:'Wong#2046', puuid:'p2', lastSeen:20 },
    ignored:{ playerName:'Ignored#EUW', puuid:'p3', lastSeen:10 },
  };
  const accounts = { nico:{ key:{ name:'phileas fogg', tag:'OLY', puuid:'p1' } } };
  const rows = discoveryRows({}, clients, accounts, { ignored:true });
  assert.deepEqual(rows.map(row => row.playerName), ['Wong#2046']);
});

test('live state distinguishes game, client and stale account', () => {
  const now = 1_000_000;
  assert.equal(accountLiveState({ puuid:'p1', games:['lol'] }, { lolSessions:{ a:{ puuid:'p1', active:true, ts:now } } }, now).state, 'ingame');
  assert.equal(accountLiveState({ name:'A', tag:'B', games:['lol'] }, { lolClients:{ a:{ playerName:'A#B', phase:'Lobby', lastSeen:now } } }, now).state, 'online');
  assert.equal(accountLiveState({ name:'A', tag:'B' }, { valorantClients:{ a:{ playerName:'A#B', ts:now-100_000 } } }, now).state, 'offline');
});
