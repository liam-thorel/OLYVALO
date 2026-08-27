import assert from 'node:assert/strict';
import { freshLiveClients, groupLiveClients, isVersionAtLeast, liveClientSummary, normalizeLiveClientState } from '../js/live-clients.mjs';

const now = 100000;
const clients = {
  nico: {online:true,ts:99000,state:'idle',version:'4.9.3',playerName:'Drew A Picasso#XOOO'},
  liam: {online:true,ts:98000,state:'in-game',version:'4.9.3'},
  stale: {online:true,ts:60000,state:'agent-select',version:'4.9.2'},
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
