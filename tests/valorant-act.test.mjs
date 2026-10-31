import assert from 'node:assert/strict';
import test from 'node:test';
import { currentAct, inAct, loadCurrentAct } from '../js/valorant-act.mjs';
import { createHistoryPager } from '../js/history-pager.mjs';

const seasons = [
  { uuid:'ep', displayName:'V25', type:'EAresType::Episode', startTime:'2025-01-08T00:00:00Z', endTime:'2026-01-07T00:00:00Z' },
  { uuid:'a5', displayName:'ACT V', type:'EAresType::Act', parentUuid:'ep', startTime:'2025-08-27T00:00:00Z', endTime:'2025-10-22T00:00:00Z' },
  { uuid:'a6', displayName:'ACT VI', type:'EAresType::Act', parentUuid:'ep', startTime:'2025-10-22T00:00:00Z', endTime:'2026-01-07T00:00:00Z' },
];
const now = Date.parse('2025-10-31T12:00:00Z');

test('acte en cours et parties de l’acte', () => {
  const act = currentAct(seasons, now);
  assert.deepEqual(act, { uuid:'a6', label:'V25 · Acte VI', startTime:Date.parse('2025-10-22T00:00:00Z'), endTime:Date.parse('2026-01-07T00:00:00Z') });
  assert.equal(currentAct(seasons, Date.parse('2027-01-01')), null);
  assert.equal(currentAct(null, now), null);
  assert.equal(inAct({ ts:Date.parse('2025-10-25T20:00:00Z') }, act), true);
  assert.equal(inAct({ ts:Date.parse('2025-10-01T20:00:00Z') }, act), false, 'acte précédent');
  assert.equal(inAct({ ts:now }, null), false);
});

test('chargement : gardé en cache, null si l’API ne répond pas', async () => {
  const store = new Map();
  const storage = { getItem:k => store.get(k) ?? null, setItem:(k, v) => store.set(k, v) };
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return { ok:true, json:async () => ({ data:seasons }) }; };
  assert.equal((await loadCurrentAct({ fetchImpl, storage, now })).uuid, 'a6');
  assert.equal((await loadCurrentAct({ fetchImpl, storage, now:now + 3_600_000 })).uuid, 'a6');
  assert.equal(calls, 1, 'en cache');
  assert.equal(await loadCurrentAct({ fetchImpl:async () => { throw new Error('hors ligne'); }, storage:null, now }), null);
});

test('le pager donne tout l’index aux statistiques, pas seulement la page chargée', async () => {
  const index = Object.fromEntries(Array.from({ length:45 }, (_, i) => [`g${i}`, { ts:1_000 + i, map:'Haven', mode:'competitive' }]));
  const pager = createHistoryPager({ firebaseUrl:'x', indexPath:'i', dataPath:'d', pageSize:30, fetchJson:async () => index });
  const page = await pager.loadNext();
  assert.equal(page.loaded, 30);
  const all = pager.allSummaries();
  assert.equal(Object.keys(all).length, 45);
  assert.equal(all.g0.__summary, true);
});
