import test from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest, runScheduled } from '../workers/notifications/worker.mjs';

function fakeKv() {
  const values = new Map();
  return {
    async get(key, type) {
      const value = values.get(key);
      return type === 'json' && value ? JSON.parse(value) : value ?? null;
    },
    async put(key, value) { values.set(key, String(value)); },
    async delete(key) { values.delete(key); },
    async list({ prefix = '' } = {}) {
      return { keys:[...values.keys()].filter(key => key.startsWith(prefix)).map(name => ({ name })), list_complete:true };
    },
    values,
  };
}

const env = () => ({
  SITE_ORIGIN:'https://liam-thorel.github.io',
  VAPID_PUBLIC_KEY:'public-test-key',
  PUSH_SUBSCRIPTIONS:fakeKv(),
});

test('notification worker exposes public configuration with CORS', async () => {
  const response = await handleRequest(new Request('https://push.example/config', {
    headers:{ Origin:'https://liam-thorel.github.io' },
  }), env());
  assert.equal(response.status, 200);
  assert.equal((await response.json()).publicKey, 'public-test-key');
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'https://liam-thorel.github.io');
});

test('subscription endpoint rejects malformed entries and stores valid devices', async () => {
  const workerEnv = env();
  const invalid = await handleRequest(new Request('https://push.example/subscriptions', {
    method:'POST', headers:{ 'Content-Type':'application/json' }, body:'{}',
  }), workerEnv);
  assert.equal(invalid.status, 400);
  const valid = await handleRequest(new Request('https://push.example/subscriptions', {
    method:'POST',
    headers:{ 'Content-Type':'application/json' },
    body:JSON.stringify({
      memberId:'nico',
      name:'Nico',
      subscription:{ endpoint:'https://push.example/device', keys:{ p256dh:'key', auth:'auth' } },
    }),
  }), workerEnv);
  assert.equal(valid.status, 201);
  assert.equal((await workerEnv.PUSH_SUBSCRIPTIONS.list({ prefix:'sub:' })).keys.length, 1);
  const removed = await handleRequest(new Request('https://push.example/subscriptions', {
    method:'DELETE', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ endpoint:'https://push.example/device' }),
  }), workerEnv);
  assert.equal(removed.status, 200);
  assert.equal((await workerEnv.PUSH_SUBSCRIPTIONS.list({ prefix:'sub:' })).keys.length, 0);
});

test('admin notification test is limited to Nico and Liam and rate limited', async () => {
  const workerEnv = env();
  const forbidden = await handleRequest(new Request('https://push.example/notifications/test', {
    method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ memberId:'rayhan' }),
  }), workerEnv);
  assert.equal(forbidden.status, 403);
  const first = await handleRequest(new Request('https://push.example/notifications/test', {
    method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ memberId:'liam', name:'Liam' }),
  }), workerEnv);
  assert.equal(first.status, 200);
  const second = await handleRequest(new Request('https://push.example/notifications/test', {
    method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ memberId:'liam', name:'Liam' }),
  }), workerEnv);
  assert.equal(second.status, 429);
});

test('first scheduled scan records existing promotions without sending retroactive notifications', async () => {
  const workerEnv = env();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    const path = String(url);
    if (path.includes('groupNight/current')) return Response.json(null);
    if (path.includes('historyIndex/valorant')) return Response.json({
      oldMatch:{ ts:100, reports:{ nico:{ member:'Nico', memberId:'nico', rr:{ tierBefore:11, tier:12 } } } },
    });
    if (path.includes('live/lolHistory')) return Response.json({});
    throw new Error('Unexpected URL ' + path);
  };
  try {
    const result = await runScheduled(workerEnv, 1_000);
    assert.deepEqual(result, { reminder:0, valorant:0, lol:0 });
    assert.ok(workerEnv.PUSH_SUBSCRIPTIONS.values.has('rank-bootstrap:v1'));
    assert.ok([...workerEnv.PUSH_SUBSCRIPTIONS.values.keys()].some(key => key.startsWith('sent:rank:valorant:oldMatch:')));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('scheduled worker records distinct 30 and 15 minute session reminders', async () => {
  const workerEnv = env();
  workerEnv.PUSH_SUBSCRIPTIONS.values.set('rank-bootstrap:v1', '1');
  const startsAt = Date.UTC(2026, 7, 24, 20, 0);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    const path = String(url);
    if (path.includes('groupNight/current')) return Response.json({ startsAt, updatedAt:123, gameTitle:'PEAK', time:'22:00' });
    if (path.includes('historyIndex/valorant') || path.includes('live/lolHistory')) return Response.json({});
    throw new Error('Unexpected URL ' + path);
  };
  try {
    await runScheduled(workerEnv, startsAt - 30 * 60_000);
    await runScheduled(workerEnv, startsAt - 15 * 60_000);
    const markers = [...workerEnv.PUSH_SUBSCRIPTIONS.values.keys()].filter(key => key.startsWith('sent:session:')).sort();
    assert.equal(markers.length, 2);
    assert.ok(markers.some(key => key.endsWith(':30')));
    assert.ok(markers.some(key => key.endsWith(':15')));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
