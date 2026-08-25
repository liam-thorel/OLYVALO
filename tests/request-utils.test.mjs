import test from 'node:test';
import assert from 'node:assert/strict';

import { fetchJsonWithRetry, fetchJsonWithTimeout } from '../js/request-utils.mjs';

test('fetchJsonWithTimeout returns parsed JSON', async () => {
  const data = await fetchJsonWithTimeout('/ok', {
    fetchImpl: async () => ({ ok: true, json: async () => ({ ready: true }) }),
  });
  assert.deepEqual(data, { ready: true });
});

test('fetchJsonWithTimeout aborts a request that never finishes', async () => {
  const fetchImpl = (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });

  await assert.rejects(
    fetchJsonWithTimeout('/slow', { timeoutMs: 15, fetchImpl }),
    /Délai de chargement dépassé/,
  );
});

test('fetchJsonWithTimeout rejects unsuccessful HTTP responses', async () => {
  await assert.rejects(
    fetchJsonWithTimeout('/error', {
      fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({}) }),
    }),
    /HTTP 503/,
  );
});

test('fetchJsonWithRetry recovers from a transient network failure', async () => {
  let calls = 0;
  const retries = [];
  const data = await fetchJsonWithRetry('/unstable', {
    retryDelays:[0],
    onRetry:attempt => retries.push(attempt),
    fetchImpl:async () => {
      calls += 1;
      if (calls === 1) throw new TypeError('Load failed');
      return { ok:true, json:async () => ({ ready:true }) };
    },
  });
  assert.deepEqual(data, { ready:true });
  assert.equal(calls, 2);
  assert.deepEqual(retries, [1]);
});

test('fetchJsonWithRetry does not retry a permanent HTTP 404', async () => {
  let calls = 0;
  await assert.rejects(fetchJsonWithRetry('/missing', {
    retryDelays:[0, 0],
    fetchImpl:async () => {
      calls += 1;
      return { ok:false, status:404, json:async () => ({}) };
    },
  }), /HTTP 404/);
  assert.equal(calls, 1);
});
