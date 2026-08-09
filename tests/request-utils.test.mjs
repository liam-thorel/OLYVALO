import test from 'node:test';
import assert from 'node:assert/strict';

import { fetchJsonWithTimeout } from '../js/request-utils.mjs';

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
