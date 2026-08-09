import test from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregateCompetitiveMatches,
  normalizeAgentName,
  rateLimitDelayMs,
  selectActMatches,
  shouldStopMatchPagination,
} from '../js/valorant-season.mjs';

function match({ id, season = 'act-current', agent, won, kills, deaths, assists, score, rounds, shots }) {
  return {
    metadata: {
      match_id: id,
      started_at: `2026-08-${id === 'newer' ? '08' : id === 'older' ? '07' : '06'}T20:00:00.000Z`,
      season: { id: season },
    },
    players: [{
      puuid: 'nico-puuid',
      name: 'Drew A Picasso',
      tag: 'XOOO',
      team_id: 'Blue',
      agent: { name: agent },
      stats: {
        kills,
        deaths,
        assists,
        score,
        headshots: shots.head,
        bodyshots: shots.body,
        legshots: shots.leg,
      },
    }],
    teams: [{ team_id: 'Blue', won }],
    rounds: Array.from({ length: rounds }, () => ({})),
  };
}

test('the current Valorant act is selected from the newest match', () => {
  const current = match({ id: 'newer', agent: 'Sage', won: true, kills: 20, deaths: 10, assists: 5, score: 4200, rounds: 20, shots: { head: 10, body: 20, leg: 0 } });
  const second = match({ id: 'older', agent: 'Omen', won: false, kills: 10, deaths: 10, assists: 5, score: 3000, rounds: 20, shots: { head: 5, body: 15, leg: 0 } });
  const previousAct = match({ id: 'previous', season: 'act-previous', agent: 'Jett', won: true, kills: 30, deaths: 5, assists: 2, score: 6000, rounds: 18, shots: { head: 20, body: 20, leg: 0 } });

  const selected = selectActMatches([previousAct, second, current]);
  assert.equal(selected.seasonId, 'act-current');
  assert.deepEqual(selected.matches.map(entry => entry.metadata.match_id), ['newer', 'older']);
});

test('season aggregates produce top agents and useful competitive metrics', () => {
  const matches = [
    match({ id: 'newer', agent: 'sage', won: true, kills: 20, deaths: 10, assists: 5, score: 4200, rounds: 20, shots: { head: 10, body: 20, leg: 0 } }),
    match({ id: 'older', agent: 'Sage', won: false, kills: 10, deaths: 10, assists: 5, score: 3000, rounds: 20, shots: { head: 5, body: 15, leg: 0 } }),
  ];
  const stats = aggregateCompetitiveMatches(matches, { puuid: 'nico-puuid' });

  assert.equal(stats.games, 2);
  assert.equal(stats.winRatePct, 50);
  assert.equal(stats.kd, '1.50');
  assert.equal(stats.kda, '2.00');
  assert.equal(stats.acs, 180);
  assert.equal(stats.hsPercent, 30);
  assert.deepEqual(stats.topAgents, ['Sage']);
  assert.deepEqual(stats.topAgentStats[0], { name: 'Sage', games: 2, wins: 1, winRatePct: 50 });
});

test('pagination continues through a full page and stops at the act boundary', () => {
  const currentPage = Array.from({ length: 10 }, (_, index) => ({ metadata: { season: { id: 'act-current' }, match_id: `m-${index}` } }));
  assert.equal(shouldStopMatchPagination(currentPage, 'act-current', 10), false);
  currentPage[9] = { metadata: { season: { id: 'act-previous' }, match_id: 'old' } };
  assert.equal(shouldStopMatchPagination(currentPage, 'act-current', 10), true);
  assert.equal(shouldStopMatchPagination(currentPage.slice(0, 4), 'act-current', 10), true);
});

test('agent aliases remain compatible with Valorant asset names', () => {
  assert.equal(normalizeAgentName('kayo'), 'KAY/O');
  assert.equal(normalizeAgentName('omen'), 'Omen');
});

test('Henrik rate-limit headers choose a bounded automatic retry delay', () => {
  const retryHeaders = new Headers({ 'retry-after': '12' });
  assert.equal(rateLimitDelayMs(retryHeaders), 12_750);
  const draftHeaders = new Headers({ ratelimit: '"per1min";r=0;t=28;pk=:test:' });
  assert.equal(rateLimitDelayMs(draftHeaders), 28_750);
  assert.equal(rateLimitDelayMs(new Headers()), 35_000);
});
