import test from 'node:test';
import assert from 'node:assert/strict';
import { createHistoryPager, historyIndexTimestamp } from '../js/history-pager.mjs';

test('history index timestamps support Valorant reports and flat LoL records', () => {
  assert.equal(historyIndexTimestamp({ ts:10 }), 10);
  assert.equal(historyIndexTimestamp({ reports:{ a:{ ts:20 }, b:{ endTs:30 } } }), 30);
});

test('an empty history is cached rather than fully downloaded on every visit', async () => {
  let calls = 0;
  const pager = createHistoryPager({ firebaseUrl:'https://firebase', indexPath:'index', dataPath:'history', fetchJson:async () => { calls++; return null; } });
  await pager.loadNext();
  await pager.loadNext();
  assert.equal(calls, 2, 'one index and one legacy fallback, not two of each');
});

test('concurrent detail requests share one request and a failure can be retried', async () => {
  let calls = 0;
  const pager = createHistoryPager({ firebaseUrl:'https://firebase', dataPath:'history', fetchJson:async () => { calls++; if (calls === 1) throw new Error('offline'); return { ts:1 }; } });
  const first = await Promise.allSettled([pager.loadDetail('same'), pager.loadDetail('same')]);
  assert.equal(calls, 1);
  assert.equal(first[0].status, 'rejected');
  assert.deepEqual(await pager.loadDetail('same'), { ts:1 });
  assert.equal(calls, 2);
});

test('history pager loads newest summaries first and details on demand', async () => {
  const calls = [];
  const responses = {
    'https://firebase/historyIndex/valorant.json':{
      old:{ reports:{ a:{ ts:10, map:'Ascent' } } },
      newest:{ reports:{ b:{ ts:30, map:'Lotus' } } },
      middle:{ reports:{ c:{ ts:20, map:'Bind' } } },
    },
    'https://firebase/live/history/newest.json':{ reports:{ b:{ ts:30, map:'Lotus', players:[{ name:'Nico' }] } } },
  };
  const pager = createHistoryPager({
    firebaseUrl:'https://firebase', indexPath:'historyIndex/valorant', dataPath:'live/history', pageSize:2,
    fetchJson:async url => { calls.push(url); return responses[url] || null; },
  });
  const first = await pager.loadNext();
  assert.deepEqual(Object.keys(first.data), ['newest','middle']);
  assert.equal(first.data.newest.reports.b.__summary, true);
  assert.equal(first.remaining, 1);
  const detail = await pager.loadDetail('newest');
  assert.equal(detail.reports.b.players[0].name, 'Nico');
  const second = await pager.loadNext();
  assert.deepEqual(Object.keys(second.data), ['newest','middle','old']);
  assert.equal(calls.filter(url => url.endsWith('historyIndex/valorant.json')).length, 1);
});

test('history pager refreshes the visible page without appending older matches', async () => {
  let revision = 0;
  const indexes = [
    {
      first:{ ts:30, champion:'Ahri' },
      second:{ ts:20, champion:'Garen' },
      old:{ ts:10, champion:'Lux' },
    },
    {
      newest:{ ts:40, champion:'Jinx' },
      first:{ ts:31, champion:'Akali' },
      second:{ ts:20, champion:'Garen' },
      old:{ ts:10, champion:'Lux' },
    },
  ];
  const pager = createHistoryPager({
    firebaseUrl:'https://firebase', indexPath:'historyIndex/lol', dataPath:'live/lolHistory', pageSize:2,
    fetchJson:async () => indexes[Math.min(revision++, indexes.length - 1)],
  });

  const first = await pager.loadNext();
  assert.deepEqual(Object.keys(first.data), ['first', 'second']);

  const refreshed = await pager.refresh();
  assert.deepEqual(Object.keys(refreshed.data), ['newest', 'first']);
  assert.equal(refreshed.data.first.champion, 'Akali');
  assert.equal(refreshed.loaded, 2);
  assert.equal(refreshed.remaining, 2);
});
