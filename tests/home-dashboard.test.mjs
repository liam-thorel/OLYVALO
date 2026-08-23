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

test('home dashboard falls back from League live to online members then coop', () => {
  const league = homeDashboardState({ lolSessions:{ liam:{ active:true, memberId:'liam', matchId:'EUW1', ts:now - 2_000 } } }, now);
  assert.equal(league.state, 'lol');
  assert.equal(league.page, 'live');

  const online = homeDashboardState({ lolClients:{ liam:{ connected:true, memberId:'liam', lastSeen:now - 2_000 } } }, now);
  assert.equal(online.title, '1 membre connecté');

  const empty = homeDashboardState({}, now);
  assert.equal(empty.title, 'On joue à quoi ?');
  assert.equal(empty.page, 'games');
});
