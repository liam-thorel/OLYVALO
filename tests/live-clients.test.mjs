import assert from 'node:assert/strict';
import { chooseLiveSession, freshLiveClients, groupLiveClients, isVersionAtLeast, liveClientSummary, liveSessionSignal, normalizeLiveClientState, recoveringLiveClients, retainRecentLiveClients } from '../js/live-clients.mjs';

const now = 100000;
const clients = {
  nico: {online:true,ts:99000,state:'idle',version:'4.9.3',playerName:'Drew A Picasso#XOOO'},
  liam: {online:true,ts:98000,state:'in-game',version:'4.9.3'},
  stale: {online:true,ts:39000,state:'agent-select',version:'4.9.2'},
  stopped: {online:false,ts:99500,state:'stopped',version:'4.9.3'},
};
const sessions = {liam:{playerName:'Wong Chi Ming#2046'}};
const fresh = freshLiveClients(clients, sessions, now);

assert.deepEqual(fresh.map(client => client.puuid), ['liam','nico']);
assert.equal(fresh[0].playerName, 'Wong Chi Ming#2046');
const laterHeartbeat = freshLiveClients({
  ...clients,
  nico: {...clients.nico, ts: 98100},
  liam: {...clients.liam, ts: 99900},
}, sessions, now);
assert.deepEqual(
  laterHeartbeat.map(client => client.puuid),
  ['liam','nico'],
  'heartbeat timing must never reorder the script chips',
);
assert.deepEqual(liveClientSummary(fresh), {total:2,inGame:1,agentSelect:0,ready:1,issues:0});
assert.equal(
  freshLiveClients({ slow:{online:true,ts:55000,state:'in-game'} }, {}, now).length,
  1,
  'a temporarily slow Riot poll must not remove a live client after 45 seconds',
);
assert.equal(recoveringLiveClients({ slow:{online:true,ts:39000,state:'in-game'} }, {}, now).length, 1);
assert.equal(recoveringLiveClients({ gone:{online:true,ts:-100000,state:'in-game'} }, {}, now).length, 0);
assert.equal(liveSessionSignal({ active:true, mapClean:'Ascent', ts:now-59_000 }, now), 'live');
assert.equal(liveSessionSignal({ active:true, mapClean:'Ascent', ts:now-61_000 }, now), 'recovering');
assert.equal(liveSessionSignal({ active:true, mapClean:'Ascent', ts:now-181_000 }, now), 'expired');
assert.equal(liveSessionSignal({ active:true, mapClean:'Ascent', ts:now-181_000, heartbeatAt:now-1000 }, now), 'live');
assert.equal(liveSessionSignal({ active:false, mapClean:'Ascent', ts:now }, now), 'ended');
const trackedGame = { active:true, mapClean:'Ascent', matchId:'game-1', ts:now-1000 };
const otherGame = { active:true, mapClean:'Split', matchId:'game-2', ts:now-2000 };
const confirmedGame = { key:'friend', data:trackedGame, confirmedAt:now-1000 };
assert.equal(chooseLiveSession({ friend:trackedGame, other:otherGame }, 'friend', confirmedGame, now).selectedSession, 'friend');
const interrupted = chooseLiveSession({ other:otherGame }, 'friend', confirmedGame, now);
assert.equal(interrupted.selectedSession, 'friend', 'a temporary missing snapshot must not switch to another match');
assert.equal(interrupted.recoveredFromCache, true);
assert.equal(interrupted.data.matchId, 'game-1');
const finished = chooseLiveSession({ friend:{ ...trackedGame, active:false }, other:otherGame }, 'friend', confirmedGame, now);
assert.equal(finished.selectedSession, 'other', 'an explicit end can switch to the other match');
assert.equal(finished.recoveredFromCache, false);
assert.equal(chooseLiveSession({ friend:{ ...trackedGame, active:false } }, 'friend', confirmedGame, now).data, null);
assert.equal(chooseLiveSession({ friend:{ ...trackedGame, ts:now-70_000 } }, 'friend', confirmedGame, now).selectedSession, 'friend');
const expired = chooseLiveSession({}, 'friend', confirmedGame, now + 181_000);
assert.equal(expired.data, null, 'a lost script does not leave a permanent ghost game');
assert.equal(retainRecentLiveClients({ friend:{ online:true, ts:now-1000 } }, {}, now).friend.online, true);
assert.deepEqual(retainRecentLiveClients({ friend:{ online:true, ts:now-1000 } }, { friend:{ online:false, ts:now } }, now), { friend:{ online:false, ts:now } });
assert.deepEqual(retainRecentLiveClients({ friend:{ online:true, ts:now-181_000 } }, {}, now), {});
assert.equal(isVersionAtLeast('4.13.0', '4.12.0'), true);
assert.equal(isVersionAtLeast('v4.12.0', '4.12.0'), true);
assert.equal(isVersionAtLeast('4.11.9', '4.12.0'), false);
assert.equal(isVersionAtLeast('', '4.12.0'), false);

const grouped = groupLiveClients([
  { puuid:'rayhan', state:'agent-select', matchId:'pregame-42' },
  { puuid:'nico', state:'idle', matchId:'' },
  { puuid:'mathis', state:'agent-select', matchId:'pregame-42' },
]);
assert.deepEqual(grouped.map(group => group.clients.map(client => client.puuid)), [
  ['rayhan', 'mathis'],
  ['nico'],
]);

console.log('live-clients: freshness, names and state summary validated');

assert.deepEqual(
  normalizeLiveClientState({ state:'error', error:'Presence: HTTP 404', riotClient:true }),
  { state:'idle', error:'', riotClient:true, standby:true },
  'a background Riot client without the chat endpoint is shown as standby',
);
assert.equal(
  normalizeLiveClientState({ state:'error', error:'Presence: HTTP 500', riotClient:true }).state,
  'error',
  'unexpected Riot errors remain visible',
);
