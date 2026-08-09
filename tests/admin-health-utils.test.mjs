import test from 'node:test';
import assert from 'node:assert/strict';
import { buildScriptHealth, compareVersions, scriptDiagnosticText, scriptHealthSummary } from '../js/admin-health-utils.mjs';

test('versions are compared numerically', () => {
  assert.equal(compareVersions('4.16.3', '4.16.3'), 0);
  assert.equal(compareVersions('4.16.10', '4.16.3'), 1);
  assert.equal(compareVersions('4.15.16', '4.16.0'), -1);
});

test('health center distinguishes ready, game, outdated and missing scripts', () => {
  const now = 1_000_000;
  const rows = buildScriptHealth({
    members: [
      { id:'nico', name:'Nico' },
      { id:'mathis', name:'Mathis' },
      { id:'liam', name:'Liam' },
    ],
    valorantClients: {
      nico:{ memberId:'nico', member:'Nico', playerName:'Drew#OLY', online:true, state:'idle', riotClient:true, version:'4.16.3', ts:now-5_000 },
      mathis:{ memberId:'mathis', member:'Mathis', playerName:'M A I R#LGND', online:true, state:'in-game', riotClient:true, version:'4.15.0', ts:now-4_000 },
    },
    valorantSessions: {
      mathis:{ memberId:'mathis', playerName:'M A I R#LGND', active:true, mapClean:'Split', mode:'competitive', server:'Paris', ts:now-3_000 },
    },
    lolClients: {
      nico:{ memberId:'nico', member:'Nico', playerName:'Drew#OLY', connected:true, phase:'Lobby', scriptVersion:'4.16.3', lastSeen:now-2_000 },
    },
    latestVersion:'4.16.3',
    now,
  });

  assert.equal(rows.length, 3, 'LoL and Valorant heartbeats for one member are grouped');
  const nico = rows.find(row => row.memberId === 'nico');
  const mathis = rows.find(row => row.memberId === 'mathis');
  const liam = rows.find(row => row.memberId === 'liam');
  assert.equal(nico.state, 'ready');
  assert.equal(nico.autoStart, 'managed');
  assert.equal(mathis.state, 'in-game');
  assert.equal(mathis.map, 'Split');
  assert.equal(mathis.outdated, true);
  assert.match(mathis.issues.join(' '), /4\.16\.3/);
  assert.equal(liam.state, 'offline');
  assert.deepEqual(scriptHealthSummary(rows), { total:3, connected:2, playing:1, issues:1, offline:1 });
  assert.match(scriptDiagnosticText(mathis, now), /Split · competitive · Paris/);
});

test('multiple fresh installations for the same member are reported', () => {
  const now = 2_000_000;
  const rows = buildScriptHealth({
    members:[{ id:'nico', name:'Nico' }],
    valorantClients:{
      first:{ memberId:'nico', playerName:'First#EU', online:true, state:'idle', version:'4.16.3', ts:now },
      second:{ memberId:'nico', playerName:'Second#EU', online:true, state:'idle', version:'4.16.3', ts:now },
    },
    latestVersion:'4.16.3', now,
  });
  assert.equal(rows.length, 2);
  assert.ok(rows.every(row => row.duplicateCount === 2));
  assert.ok(rows.every(row => row.issues.some(issue => issue.includes('2 scripts'))));
});

test('legacy LoL presence is linked through an account assigned in admin', () => {
  const now = 3_000_000;
  const rows = buildScriptHealth({
    members:[{ id:'liam', name:'Liam' }],
    accountLinks:[{ memberId:'liam', playerName:'FakePlasticTrees#1706', puuid:'p-liam' }],
    lolClients:{ old:{ playerName:'fakeplastictrees#1706', connected:false, scriptVersion:'4.15.15', lastSeen:now-200_000 } },
    latestVersion:'4.16.3', now,
  });
  assert.equal(rows.length, 1, 'the linked account replaces the empty member placeholder');
  assert.equal(rows[0].memberId, 'liam');
  assert.equal(rows[0].account, 'fakeplastictrees#1706');
});
