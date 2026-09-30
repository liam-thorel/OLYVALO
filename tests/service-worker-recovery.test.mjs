import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
function worker(fetchImpl, cached = null) {
  const writes = [];
  const pending = [];
  const context = vm.createContext({
    self:{ addEventListener() {}, location:{ origin:'https://site' } },
    caches:{ open:async () => ({ match:async () => cached, put:async (_request, response) => { writes.push(response); } }) },
    fetch:fetchImpl, AbortController, URL,
    setTimeout:(callback, ms) => setTimeout(callback, ms === 1500 ? 5 : 40), clearTimeout,
  });
  vm.runInContext(source, context);
  return { run:() => context.networkFirst({ mode:'cors' }, { waitUntil:promise => pending.push(promise) }), writes, pending };
}
test('service worker serves cached assets during a slow network and refreshes them afterwards', async () => {
  let release;
  const old = { version:'cached' };
  const fresh = { ok:true, type:'basic', clone:() => ({ version:'fresh' }) };
  const fixture = worker(() => new Promise(resolve => { release = resolve; }), old);
  assert.equal(await fixture.run(), old);
  release(fresh);
  await Promise.all(fixture.pending);
  assert.deepEqual(fixture.writes, [{ version:'fresh' }]);
});
test('service worker bounds a cold request without any cached fallback', async () => {
  const fixture = worker((_request, { signal }) => new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once:true });
  }));
  await assert.rejects(fixture.run(), { name:'AbortError' });
  await Promise.all(fixture.pending);
});
test('service worker returns an available cache after a network failure', async () => {
  const cached = { version:'cached' };
  const fixture = worker(async () => { throw new Error('offline'); }, cached);
  assert.equal(await fixture.run(), cached);
});
