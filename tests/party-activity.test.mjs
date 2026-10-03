import {test} from 'node:test';
import assert from 'node:assert/strict';
import {groupLiveClients,liveActivityLabel} from '../js/live-clients.mjs';
test('same party is not the same match',()=>{
  const groups=groupLiveClients([
    {puuid:'a',state:'idle',activity:'queue',partyId:'p'},
    {puuid:'b',state:'idle',activity:'menu',partyId:'p'},
    {puuid:'c',state:'in-game',matchId:'m',partyId:'p'},
  ]);
  assert.equal(groups.length,2);
  assert.equal(groups.find(g=>g.key==='party:p').matchId,'');
  assert.equal(groups.find(g=>g.key==='party:p').clients.length,2);
});
test('activity cannot override a confirmed match or error',()=>{
  assert.equal(liveActivityLabel({state:'idle',activity:'queue'}),'En recherche de partie');
  assert.equal(liveActivityLabel({state:'in-game',activity:'menu'}),'');
  assert.equal(liveActivityLabel({state:'error',activity:'queue'}),'');
});
