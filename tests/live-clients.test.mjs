import assert from 'node:assert/strict';
import { freshLiveClients, isVersionAtLeast, liveClientSummary } from '../js/live-clients.mjs';

const now = 100000;
const clients = {
  nico: {online:true,ts:99000,state:'idle',version:'4.9.3',playerName:'Drew A Picasso#XOOO'},
  liam: {online:true,ts:98000,state:'in-game',version:'4.9.3'},
  stale: {online:true,ts:60000,state:'agent-select',version:'4.9.2'},
  stopped: {online:false,ts:99500,state:'stopped',version:'4.9.3'},
};
const sessions = {liam:{playerName:'Wong Chi Ming#2046'}};
const fresh = freshLiveClients(clients, sessions, now);

assert.deepEqual(fresh.map(client => client.puuid), ['nico','liam']);
assert.equal(fresh[1].playerName, 'Wong Chi Ming#2046');
assert.deepEqual(liveClientSummary(fresh), {total:2,inGame:1,agentSelect:0,ready:1,issues:0});
assert.equal(isVersionAtLeast('4.13.0', '4.12.0'), true);
assert.equal(isVersionAtLeast('v4.12.0', '4.12.0'), true);
assert.equal(isVersionAtLeast('4.11.9', '4.12.0'), false);
assert.equal(isVersionAtLeast('', '4.12.0'), false);

console.log('live-clients: freshness, names and state summary validated');
