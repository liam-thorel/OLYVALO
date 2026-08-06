import test from 'node:test';
import assert from 'node:assert/strict';
import { activeLolSessions, groupLolSessions, lolKda, mergeFirebaseEvent, normalizeLolHistory, summarizeLolDays } from '../js/lol-utils.mjs';

test('activeLolSessions rejects stopped and stale sessions', () => {
  const now = 1_000_000;
  const sessions = {
    fresh: { active: true, matchId: 'EUW-1', ts: now - 5_000 },
    stopped: { active: false, matchId: 'EUW-1', ts: now },
    stale: { active: true, matchId: 'EUW-2', ts: now - 60_000 },
  };
  assert.deepEqual(activeLolSessions(sessions, now).map(value => value.id), ['fresh']);
});

test('groupLolSessions keeps simultaneous matches separated', () => {
  const now = 1_000_000;
  const groups = groupLolSessions({
    a: { active:true, matchId:'one', ts:now, playerName:'A' },
    b: { active:true, matchId:'one', ts:now, playerName:'B' },
    c: { active:true, matchId:'two', ts:now, playerName:'C' },
  }, now);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups.find(group => group.matchId === 'one').players.map(player => player.playerName), ['A', 'B']);
});

test('normalizeLolHistory accepts flat and nested Firebase records', () => {
  const result = normalizeLolHistory({
    first: { champion:{ name:'Trundle' }, kills:4, ts:20 },
    player: { second: { champion:{ name:'Tristana' }, kills:8, ts:40 } },
  });
  assert.deepEqual(result.map(match => match.champion.name), ['Tristana', 'Trundle']);
  assert.equal(lolKda({ kills:8, deaths:2, assists:4 }), '6.0');
});

test('summarizeLolDays never mixes records outside their calendar day', () => {
  const matches = [
    { ts:new Date('2026-08-05T10:00:00Z').getTime(), win:true, kills:4, deaths:2, assists:3 },
    { ts:new Date('2026-08-05T11:00:00Z').getTime(), win:false, kills:2, deaths:3, assists:4 },
  ];
  const [day] = summarizeLolDays(matches);
  assert.equal(day.games, 2);
  assert.equal(day.wins, 1);
});

test('mergeFirebaseEvent applies partial writes without losing siblings', () => {
  const merged = mergeFirebaseEvent({ a:{ active:true }, b:{ active:true } }, { path:'/a/active', data:false });
  assert.deepEqual(merged, { a:{ active:false }, b:{ active:true } });
});
