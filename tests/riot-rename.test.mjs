import test from 'node:test';
import assert from 'node:assert/strict';
import { rosterAccounts,currentRiotId } from '../js/roster-card-utils.mjs';
import { createRosterIdentitySync } from '../js/roster-identity-sync.mjs';
import { buildLiveIdentityIndex,resolveLiveIdentity } from '../js/live-identities.mjs';

test('Mathis uses the shared smurf only alongside Nico in the same match; ownership stays unchanged',()=>{
  const roster=[{...player,smurfs:[{name:'OG ANUNOBY',tag:'OLY',puuid:'shared-P'}]},{name:'Mathis',riot:{name:'Main',tag:'LGND',puuid:'mathis-P'}}];
  const index=buildLiveIdentityIndex(roster);
  const shared={puuid:'shared-P',playerName:'OG ANUNOBY#OLY'};
  const both=[{puuid:'valo-P',name:'Hal Jordan#OLY'},shared];
  assert.equal(resolveLiveIdentity(shared,index,{participants:both}).member,'Mathis');
  assert.equal(resolveLiveIdentity({...shared,playerName:'Renamed Smurf#OLY'},index,{participants:both}).member,'Mathis');
  assert.equal(resolveLiveIdentity(shared,index,{participants:[shared]}).member,'Nico');
  assert.equal(resolveLiveIdentity(shared,index,{participants:[{puuid:'valo-P'}]}).member,'Nico');
  assert.equal(index.byPuuid.get('shared-P').member,'Nico');
});

const player = {name:'Nico',riot:{name:'Drew A Picasso',tag:'XOOO',puuid:'valo-P'},smurfs:[{name:'phileas fogg',tag:'OLY',puuid:'lol-P'}]};
test('latest Valorant binding wins regardless of Firebase key order; LoL account stays unchanged',()=>{
  const overlay={accounts:{nico:{new:{name:'Hal Jordan',tag:'OLY',puuid:'valo-P',updatedAt:300},old:{name:'Drew A Picasso',tag:'XOOO',puuid:'valo-P',updatedAt:100}}}};
  const accounts=rosterAccounts(player,overlay);
  assert.equal(accounts.length,2);
  assert.equal(accounts[0].riotId,'Hal Jordan#OLY');
  assert.equal(accounts[0].isMain,true);
  assert.equal(accounts[1].riotId,'phileas fogg#OLY');
  assert.equal(currentRiotId(accounts[0],{riotId:'Drew A Picasso#XOOO',puuid:'valo-P',syncedAt:200}),'Hal Jordan#OLY');
  assert.equal(currentRiotId(accounts[0],{riotId:'Next Rename#OLY',puuid:'valo-P',syncedAt:400}),'Next Rename#OLY');
  assert.equal(currentRiotId(accounts[0],{riotId:'Unrelated#OLY',puuid:'other-P',syncedAt:500}),'Hal Jordan#OLY');
});
test('identity refresh coalesces requests, redraws only changed accounts and preserves data on failure',async()=>{
  let calls=0;let data={nico:{name:'Old'}};const changes=[];
  const sync=createRosterIdentitySync({initial:data,fetchAccounts:async()=>{calls++;return data;},onChange:value=>changes.push(value)});
  await Promise.all([sync.refresh(),sync.refresh()]);
  assert.equal(calls,1);assert.equal(changes.length,0);
  data={nico:{name:'Hal Jordan'}};
  await sync.refresh();assert.equal(changes.length,1);
  data=null;
  await sync.refresh();assert.equal(changes.length,1);
});
test('a frozen old request cannot revert a rename after returning from the hub',async()=>{
  let resolveOld;let signal;const changes=[];
  let count=0;
  const sync=createRosterIdentitySync({fetchAccounts:async incoming=>{
    count++;
    if(count===1){signal=incoming;return new Promise(resolve=>{resolveOld=resolve;});}
    return {nico:{name:'Hal Jordan'}};
  },onChange:value=>changes.push(value)});
  const old=sync.refresh();await Promise.resolve();
  sync.pause();assert.equal(signal.aborted,true);
  await sync.refresh();resolveOld({nico:{name:'Old'}});await old;
  assert.equal(changes.length,1);assert.equal(changes[0].nico.name,'Hal Jordan');
});
