import test from 'node:test';
import assert from 'node:assert/strict';
import { homeDashboardState } from '../js/home-dashboard.mjs';

const now = 2_000_000_000_000;

test('home dashboard gives one clear priority to an active Valorant match', () => {
  const model = homeDashboardState({
    valorantSessions:{ nico:{ active:true, memberId:'nico', mapClean:'Haven', ts:now - 2_000 } },
    valorantClients:{ nico:{ online:true, memberId:'nico', ts:now - 2_000 } },
  }, now);
  assert.equal(model.state, 'valorant');
  assert.equal(model.title, 'Haven');
  assert.equal(model.page, 'live');
});

test('home dashboard follows the selected game, including idle League', () => {
  const league = homeDashboardState({ lolSessions:{ liam:{ active:true, memberId:'liam', matchId:'EUW1', ts:now - 2_000 } } }, now, { game:'lol' });
  assert.equal(league.state, 'lol');
  assert.equal(league.page, 'live');

  const online = homeDashboardState({ lolClients:{ liam:{ connected:true, memberId:'liam', lastSeen:now - 2_000 } } }, now, { game:'lol' });
  assert.equal(online.title, '1 membre connecté');

  const empty = homeDashboardState({}, now);
  assert.equal(empty.title, 'Pas de partie en cours');
  assert.equal(empty.page, 'maps');
});

test('switching League to Valorant cannot keep a League match or yellow state', () => {
  const snapshot = { lolSessions:{ liam:{ active:true, matchId:'EUW1', ts:now } } };
  assert.equal(homeDashboardState(snapshot, now, {game:'lol'}).state, 'lol');
  const valorant = homeDashboardState(snapshot, now, {game:'valorant'});
  assert.equal(valorant.state, 'valorant');
  assert.equal(valorant.title, 'Pas de partie en cours');
  assert.equal(valorant.page, 'maps');
});

test('concurrent games do not override the selected universe or claim ARAM is on the Rift', () => {
  const snapshot = {
    valorantSessions:{nico:{active:true,mapClean:'Haven',ts:now}},
    lolSessions:{liam:{active:true,matchId:'1',mode:'ARAM',queueDescription:'ARAM',ts:now}},
  };
  assert.equal(homeDashboardState(snapshot,now).title,'Haven');
  assert.match(homeDashboardState(snapshot,now,{game:'lol'}).detail,/ARAM/);
  assert.doesNotMatch(homeDashboardState(snapshot,now,{game:'lol'}).detail,/Faille/);
});
