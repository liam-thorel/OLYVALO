import test from 'node:test';
import assert from 'node:assert/strict';
import { liveClientStatus, liveClientSummaryText, liveWaitingState, normalizeLolClientState } from '../js/live-status.mjs';
import { liveClientSummary } from '../js/live-clients.mjs';
import { homeDashboardState } from '../js/home-dashboard.mjs';
import { buildScriptHealth } from '../js/admin-health-utils.mjs';

test('idle, client presence and menu are different observations, never readiness', () => {
  assert.equal(liveClientStatus({state:'idle'}).label, 'Script connecté');
  assert.equal(liveClientStatus({state:'idle',riotClient:true,standby:true}).label, 'Client Riot ouvert');
  assert.equal(liveClientStatus({state:'idle',riotClient:false}).label, 'Client Riot non détecté');
  assert.equal(liveClientStatus({state:'idle',activity:'menu',riotClient:true}).label, 'Dans le menu');
  assert.equal(liveClientStatus({state:'idle',activity:'queue'}).label, 'En recherche de partie');
  assert.equal(liveClientStatus({state:'idle',activity:'away'}).label, 'Absent');
  assert.equal(liveClientStatus({state:'idle',activity:'loading'}).key, 'loading');
});
test('confirmed match states outrank standby and old incidental activity', () => {
  assert.equal(liveClientStatus({state:'in-game',standby:true,activity:'menu'}).key, 'inGame');
  assert.equal(liveClientStatus({state:'agent-select',standby:true,activity:'queue'}).key, 'agentSelect');
  assert.equal(liveClientStatus({state:'error',activity:'queue'}).key, 'issues');
  assert.equal(liveClientStatus({state:'in-game'}, {recovering:true}).key, 'recovering');
  assert.equal(liveClientStatus({state:'stopped',online:false}, {recovering:true}).key, 'offline');
  assert.equal(liveClientStatus({state:'error',riotClient:true,error:'Presence: HTTP 404'}).key, 'clientOpen');
});

test('party counts are shown only for valid lobby and queue observations', () => {
  const party={state:'idle',partySize:1,partyCapacity:5};
  assert.equal(liveClientStatus({...party,activity:'menu'}).label,'Dans le lobby · 1/5');
  assert.equal(liveClientStatus({...party,activity:'queue',partySize:3}).label,'En recherche · 3/5');
  for (const counts of [{partySize:0},{partySize:6},{partySize:1.5},{partySize:true},{partyCapacity:[5]},{partyCapacity:0},{partyCapacity:null},{partyCapacity:Infinity},{partySize:'<script>'}]) {
    assert.equal(liveClientStatus({...party,...counts,activity:'menu'}).label,'Dans le menu');
  }
  assert.equal(liveClientStatus({...party,state:'agent-select'}).label,'Sélection en cours');
  assert.equal(liveClientStatus({...party,state:'in-game'}).label,'Partie en cours');
  assert.equal(liveClientStatus({...party,activity:'unknown'}).label,'Script connecté');
  assert.equal(liveClientStatus({...party,activity:'away'}).tone,'away');
});
test('each individual contributes to the same truthful summary', () => {
  const clients=[{state:'idle',standby:true,riotClient:true},{state:'idle'},{state:'riot-offline'},{state:'idle',activity:'queue'},{state:'agent-select'}];
  const summary=liveClientSummary(clients);
  assert.equal(summary.total,5);
  assert.equal(summary.ready,0);
  assert.equal(summary.clientOpen,1);
  assert.equal(summary.clientClosed,1);
  assert.equal(summary.scriptOnly,1);
  assert.equal(summary.queue,1);
  assert.equal(summary.agentSelect,1);
  assert.doesNotMatch(liveClientSummaryText(summary), /prêt/);
  assert.equal(liveWaitingState(summary).title,'Sélection en cours');
  assert.equal(liveWaitingState(liveClientSummary([{state:'in-game'}])).title,'Partie détectée');
  assert.equal(liveWaitingState(liveClientSummary([{state:'idle',activity:'queue'}])).title,'Recherche de partie en cours');
});
test('League phases are explicit and disconnected clients cannot claim an active game', () => {
  for (const [phase,key] of [['Lobby','menu'],['Matchmaking','queue'],['ReadyCheck','loading'],['ChampSelect','agentSelect'],['GameStart','loading'],['InProgress','inGame'],['Reconnect','inGame'],['EndOfGame','ended'],['None','clientOpen']]) {
    assert.equal(liveClientStatus(normalizeLolClientState({connected:true,phase})).key,key,phase);
  }
  assert.equal(liveClientStatus(normalizeLolClientState({connected:false,phase:'InProgress'})).key,'offline');
});
test('home distinguishes agent select from game and aligns its one-minute freshness with Live', () => {
  const now=2_000_000_000_000;
  const snapshot={valorantSessions:{nico:{active:true,memberId:'nico',mapClean:'Lotus',phase:'pregame',ts:now-45_000}}};
  const home=homeDashboardState(snapshot,now);
  assert.equal(home.title,'Lotus');
  assert.match(home.kicker,/Sélection/);
  assert.doesNotMatch(home.detail,/en partie/);
  const waiting=homeDashboardState({valorantClients:{nico:{online:true,memberId:'nico',state:'idle',riotClient:true,ts:now}}},now);
  assert.match(waiting.detail,/client Riot ouvert/);
  assert.doesNotMatch(waiting.detail,/prépare|prêt/);
  const both=homeDashboardState({valorantClients:{nico:{online:true,memberId:'nico',state:'idle',riotClient:true,ts:now}},lolClients:{nico:{connected:true,memberId:'nico',phase:'Lobby',ts:now}}},now);
  assert.equal(both.onlineIds.size,1);
  assert.match(both.detail,/1 client Riot ouvert/);
  assert.doesNotMatch(both.detail,/LoL :/);
});
test('Admin does not resurrect an old game or confuse a fresh selection with an in-game session', () => {
  const now=2_000_000_000_000;
  const stale=buildScriptHealth({valorantClients:{nico:{online:true,state:'in-game',ts:now-180_000}},now});
  assert.equal(stale[0].state,'offline');
  const select=buildScriptHealth({valorantClients:{nico:{online:true,state:'agent-select',ts:now}},valorantSessions:{nico:{active:true,phase:'pregame',mapClean:'Haven',ts:now}},now});
  assert.equal(select[0].state,'agent-select');
  const idle=buildScriptHealth({valorantClients:{nico:{online:true,state:'idle',riotClient:true,ts:now}},now});
  assert.equal(idle[0].stateLabel,'Client Riot ouvert');
});
