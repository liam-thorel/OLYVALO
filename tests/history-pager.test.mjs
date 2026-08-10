import test from 'node:test';
import assert from 'node:assert/strict';
import { createHistoryPager, historyIndexTimestamp } from '../js/history-pager.mjs';

test('history index timestamps support Valorant reports and flat LoL records', () => {
  assert.equal(historyIndexTimestamp({ ts:10 }), 10);
  assert.equal(historyIndexTimestamp({ reports:{ a:{ ts:20 }, b:{ endTs:30 } } }), 30);
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
