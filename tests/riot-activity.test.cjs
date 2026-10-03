const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { ownPresence, decodedPresence, valorantActivity, lolActivity } = require('../live/riot-activity.js');
const presence = (puuid, data) => ({puuid, private:Buffer.from(JSON.stringify(data)).toString('base64')});

test('an unknown local PUUID never borrows a friend presence', () => {
  const records = [presence('friend', {sessionLoopState:'INGAME'}), presence('self', {sessionLoopState:'MENUS'})];
  assert.deepEqual(ownPresence(records, ''), []);
  assert.equal(decodedPresence(ownPresence(records, 'self')).sessionLoopState, 'MENUS');
  assert.equal(decodedPresence([{private:'broken'}]), null);
});
test('own loop is authoritative over party owner loop', () => {
  const data = {sessionLoopState:'MENUS', partyOwnerSessionLoopState:'INGAME', partyPresenceData:{partyState:'MATCHMAKING',partyId:'party',partySize:3,maxPartySize:5,queueEntryTime:1700000000,partyAccessibility:'OPEN'}};
  const value = valorantActivity(data);
  assert.equal(value.activity, 'queue');
  assert.equal(value.partyId, 'party');
  assert.equal(value.queueStartedAt, 1700000000000);
  assert.equal(value.partyOpen, true);
  assert.equal(valorantActivity({...data,sessionLoopState:'PREGAME'}).activity, 'agent-select');
  assert.equal(valorantActivity({...data,sessionLoopState:'INGAME'}).activity, 'in-game');
});
test('legacy presence and absent/missing fields remain safe', () => {
  assert.equal(valorantActivity({sessionLoopState:'MENUS',isIdle:true}).activity, 'away');
  assert.equal(valorantActivity({sessionLoopState:'MENUS',partyState:'MATCHMAKING',queueEntryTime:'bad'}).queueStartedAt, 0);
  assert.equal(valorantActivity(null).activity, 'unknown');
  assert.equal(valorantActivity({sessionLoopState:'MENUS',partySize:-2}).partySize, 0);
});

// Sanitized structure read from the real local Riot API on 2026-10-03.
const nestedLobby = {
  isIdle:false, isValid:true, partySize:1, maxPartySize:5,
  matchPresenceData:{ sessionLoopState:'MENUS', queueId:'competitive' },
  playerPresenceData:{},
  partyPresenceData:{ partyState:'DEFAULT', partySize:1, maxPartySize:5, partyOwnerSessionLoopState:'INGAME' },
};
test('real nested Riot lobby is recognized even when alone in a party', () => {
  assert.equal(valorantActivity(nestedLobby).activity,'menu');
  assert.equal(valorantActivity(nestedLobby).partySize,1);
  assert.equal(valorantActivity(nestedLobby).partyCapacity,5);
});
test('nested local states win over stale legacy fields and the party owner', () => {
  for (const [loop,activity] of [['MENUS','menu'],['PREGAME','agent-select'],['INGAME','in-game'],['UNKNOWN','unknown']]) {
    assert.equal(valorantActivity({...nestedLobby,sessionLoopState:'INGAME',matchPresenceData:{sessionLoopState:loop}}).activity,activity);
  }
  const queued={...nestedLobby,isIdle:true,partyPresenceData:{...nestedLobby.partyPresenceData,partyState:'MATCHMAKING',queueEntryTime:1700000000}};
  assert.equal(valorantActivity(queued).activity,'queue');
  assert.equal(valorantActivity(queued).queueStartedAt,1700000000000);
  assert.equal(valorantActivity({...nestedLobby,isIdle:true}).activity,'away');
  assert.equal(valorantActivity({...nestedLobby,isValid:false}).activity,'unknown');
  assert.equal(valorantActivity({partyPresenceData:{partyOwnerSessionLoopState:'INGAME',partyState:'MATCHMAKING'}}).activity,'unknown');
});
test('own Riot Client and League records cannot hide the Valorant activity', () => {
  const records=[
    {...presence('self',{}),product:'riot_client',time:30},
    {...presence('self',{sessionLoopState:'INGAME'}),product:'league_of_legends',time:25},
    {...presence('friend',{sessionLoopState:'INGAME'}),product:'valorant',time:40},
    {...presence('self',{sessionLoopState:'INGAME'}),product:'valorant',time:10},
    {...presence('self',nestedLobby),product:'valorant',time:20},
  ];
  const own=ownPresence(records,'self');
  assert.equal(own.length,2);
  assert.equal(valorantActivity(decodedPresence(own)).activity,'menu');
  assert.equal(decodedPresence([presence('self',{}),presence('self',nestedLobby)]).matchPresenceData.sessionLoopState,'MENUS');
});
test('League activity uses its own LCU phases', () => {
  assert.equal(lolActivity('ChampSelect'), 'agent-select');
  assert.equal(lolActivity('Matchmaking'), 'queue');
  assert.equal(lolActivity('InProgress'), 'in-game');
  assert.equal(lolActivity('unexpected'), 'unknown');
});
test('failed presence does not return before independent match checks', () => {
  const index = fs.readFileSync(require.resolve('../live/index.js'), 'utf8');
  const failure = index.slice(index.indexOf('if (!res.ok) {', index.indexOf("'/chat/v4/presences'")), index.indexOf('tries = 0;', index.indexOf("'/chat/v4/presences'")));
  assert.doesNotMatch(failure, /\breturn\b/);
  assert.doesNotMatch(index, /presences\.slice\(0, 1\)/);
});
