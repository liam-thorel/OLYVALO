import test from 'node:test';
import assert from 'node:assert/strict';

import { createLiveDataStore, fetchLiveChannels, isLiveRecordExpired, liveTimestamp, mergeRealtimeEvent, routeLiveRootEvent, staleLiveRecords } from '../js/live-data-store.mjs';

// La relecture se fait canal par canal (live/clients.json…) : ces aides
// répondent à chaque adresse avec la partie correspondante d'un nœud `live`.
const channelKey = url => String(url).match(/\/live\/([A-Za-z]+)\.json$/)?.[1];
const rootFetch = root => async url => root[channelKey(url)] ?? null;
// Une relecture différée : `release(root)` répond aux quatre requêtes à la fois.
function deferredRoot() {
  let release;
  const promise = new Promise(resolve => { release = resolve; });
  return { fetchJson: async url => (await promise)?.[channelKey(url)] ?? null, release: root => release(root) };
}

test('hub round trips abort old reads and restore live subscribers immediately', async () => {
  const sources = [];
  class FakeSource {
    constructor() { this.handlers = {}; this.closed = false; sources.push(this); }
    addEventListener(type, handler) { this.handlers[type] = handler; }
    close() { this.closed = true; }
  }
  // Une relecture = quatre requêtes (une par canal), répondues ensemble.
  const reads = [];
  const store = createLiveDataStore({ EventSourceImpl:FakeSource, fetchJson:(url, options) => {
    if (channelKey(url) === 'clients') {
      let resolve;
      const root = new Promise(done => { resolve = done; });
      reads.push({ resolve, options, root });
    }
    const read = reads.at(-1);
    return read.root.then(value => value?.[channelKey(url)] ?? null);
  } });
  const requests = reads;
  let seen = null;
  store.subscribe(value => { seen = value; }, { refreshOnStart:false });
  store.apply('valorantClients', {path:'/',data:{known:{state:'idle'}}});
  const oldRead = store.refresh();
  store.pause();
  assert.equal(requests[0].options.signal.aborted, true);
  assert.equal(sources[0].closed, true);
  assert.ok(store.snapshot().valorantClients.known, 'preserve visible data while resuming');
  const resumed = store.resume();
  assert.equal(sources.length, 2, 'reconnect without the 75-second silence delay');
  assert.equal(requests.length, 2, 'do not reuse a frozen request');
  requests[1].resolve({clients:{current:{state:'in-game'}}});
  await resumed;
  assert.ok(seen.valorantClients.current, 'existing widgets remain subscribed');
  requests[0].resolve({clients:{stale:{state:'idle'}}});
  await oldRead;
  sources[0].handlers.put({type:'put',data:JSON.stringify({path:'/',data:{clients:{stale:{}}}})});
  assert.deepEqual(Object.keys(store.snapshot().valorantClients), ['current']);
  store.pause();
  const again = store.resume();
  requests[2].resolve({clients:{current:{state:'queue'}}});
  await again;
  assert.equal(seen.valorantClients.current.state, 'queue');
  store.destroy();
});

test('realtime events replace, patch and delete nested values', () => {
  let state = mergeRealtimeEvent({}, { path:'/', data:{ p1:{ state:'idle', map:'Breeze' } } });
  state = mergeRealtimeEvent(state, { path:'/p1/state', data:'in-game' });
  assert.deepEqual(state, { p1:{ state:'in-game', map:'Breeze' } });
  state = mergeRealtimeEvent(state, { path:'/p1/map', data:null });
  assert.deepEqual(state, { p1:{ state:'in-game' } });
  state = mergeRealtimeEvent(state, { path:'/p1', data:null });
  assert.deepEqual(state, {});
  state = mergeRealtimeEvent({ p1:{ state:'idle' } }, { path:'/', eventType:'patch', data:{ p2:{ state:'idle' } } });
  assert.deepEqual(state, { p1:{ state:'idle' }, p2:{ state:'idle' } });
  state = mergeRealtimeEvent(state, { path:'/', eventType:'patch', data:{ 'p1/state':'error', 'p2/state':null } });
  assert.deepEqual(state, { p1:{ state:'error' }, p2:{} });
});

test('timestamps accept milliseconds and legacy seconds', () => {
  assert.equal(liveTimestamp({ ts:1_700_000_000_000 }), 1_700_000_000_000);
  assert.equal(liveTimestamp({ lastSeen:1_700_000_000 }), 1_700_000_000_000);
});

test('stale record detection keeps active data longer than ended data', () => {
  const now = 1_700_000_000_000;
  assert.equal(isLiveRecordExpired('valorantClients', { online:false, ts:now-3*60*60*1000 }, now), true);
  assert.equal(isLiveRecordExpired('valorantClients', { online:true, ts:now-3*60*60*1000 }, now), false);
  const stale = staleLiveRecords({
    valorantSessions:{ ended:{ active:false, ts:now-3*60*60*1000 }, fresh:{ active:true, ts:now-1000 } },
    lolClients:{ old:{ connected:false, lastSeen:now-3*60*60*1000 } },
  }, now);
  assert.deepEqual(stale.map(entry => entry.path).sort(), ['live/lolClients/old','live/sessions/ended']);
});

test('root realtime events are routed to the matching live channel', () => {
  const initial = routeLiveRootEvent({ path:'/', eventType:'put', data:{ clients:{ nico:{ state:'idle' } }, lolSessions:{ game:{ active:true } } } });
  assert.equal(initial.length, 4);
  assert.deepEqual(initial.find(entry => entry.channel === 'valorantClients').message.data, { nico:{ state:'idle' } });
  const nested = routeLiveRootEvent({ path:'/clients/nico/state', eventType:'put', data:'in-game' });
  assert.deepEqual(nested, [{ channel:'valorantClients', message:{ path:'/nico/state', eventType:'put', data:'in-game' } }]);
  assert.deepEqual(routeLiveRootEvent({ path:'/history/match', eventType:'put', data:{} }), []);
});

test('one store opens one root EventSource for all channels and subscribers', () => {
  const opened = [];
  class FakeEventSource {
    constructor(url) { this.url = url; opened.push(url); }
    addEventListener() {}
    close() {}
  }
  const store = createLiveDataStore({ EventSourceImpl:FakeEventSource, fetchJson:async () => ({}) });
  const stopA = store.subscribe(() => {}, { refreshOnStart:false });
  const stopB = store.subscribe(() => {}, { refreshOnStart:false });
  assert.deepEqual(opened, ['https://realtime-database-5bb9f-default-rtdb.europe-west1.firebasedatabase.app/live.json']);
  stopA();
  stopB();
  store.destroy();
});

test('connection status is shared during a disconnect and reconnect', () => {
  const instances = [];
  class FakeEventSource {
    constructor(url) { this.url = url; instances.push(this); }
    addEventListener() {}
    close() {}
  }
  const store = createLiveDataStore({ EventSourceImpl:FakeEventSource, fetchJson:async () => ({}) });
  const snapshots = [];
  const stop = store.subscribe(snapshot => snapshots.push(snapshot), { refreshOnStart:false });
  instances[0].onerror();
  assert.equal(snapshots.at(-1).status.valorantClients.error, 'reconnecting');
  instances[0].onopen();
  assert.equal(snapshots.at(-1).status.valorantClients.connected, true);
  assert.equal(snapshots.at(-1).status.valorantClients.error, '');
  stop();
  store.destroy();
});

test('refresh keeps a newer realtime value received during the request', async () => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const store = createLiveDataStore({ EventSourceImpl:null, fetchJson:async url => (await pending)?.[channelKey(url)] ?? null });
  const refreshing = store.refresh();
  store.apply('valorantClients', { path:'/p1', data:{ state:'in-game', ts:20 } });
  release({ clients:{ p1:{ state:'idle', ts:10 }, p2:{ state:'idle', ts:10 } } });
  const snapshot = await refreshing;
  assert.equal(snapshot.valorantClients.p1.state, 'in-game');
  assert.equal(snapshot.valorantClients.p2.state, 'idle');
});

test('refresh removes cached records that no longer exist remotely', async () => {
  const store = createLiveDataStore({ EventSourceImpl:null, fetchJson:rootFetch({ clients:{ current:{ ts:20 } } }) });
  store.apply('valorantClients', { path:'/', data:{ stale:{ ts:10 } } });
  const snapshot = await store.refresh();
  assert.deepEqual(snapshot.valorantClients, { current:{ ts:20 } });
});

test('silent realtime stream is restarted and refreshed without a page reload', async () => {
  const instances = [];
  class FakeEventSource {
    constructor(url) { this.url = url; this.closed = false; this.listeners = {}; instances.push(this); }
    addEventListener(type, handler) { this.listeners[type] = handler; }
    close() { this.closed = true; }
  }
  const store = createLiveDataStore({
    EventSourceImpl:FakeEventSource,
    fetchJson:rootFetch({ sessions:{ player:{ active:true, mapClean:'Ascent', ts:Date.now() } } }),
  });
  store.start();
  assert.equal(await store.recoverIfSilent(Date.now() + 60_000), false);
  assert.equal(await store.recoverIfSilent(Date.now() + 76_000), true);
  assert.equal(instances.length, 2);
  assert.equal(instances[0].closed, true);
  assert.equal(store.snapshot().valorantSessions.player.mapClean, 'Ascent');
  store.destroy();
});

test('keep-alive events prevent unnecessary stream recovery', async () => {
  const instances = [];
  class FakeEventSource {
    constructor() { this.listeners = {}; instances.push(this); }
    addEventListener(type, handler) { this.listeners[type] = handler; }
    close() {}
  }
  const store = createLiveDataStore({ EventSourceImpl:FakeEventSource, fetchJson:async () => ({}) });
  store.start();
  instances[0].listeners['keep-alive']();
  assert.equal(await store.recoverIfSilent(Date.now() + 30_000), false);
  assert.equal(instances.length, 1);
  store.destroy();
});

test('a deletion during a delayed GET is not resurrected by its old response', async () => {
  const { fetchJson, release } = deferredRoot();
  const store = createLiveDataStore({ EventSourceImpl:null, fetchJson });
  const pending = store.refresh();
  store.apply('valorantClients', { path:'/gone', data:null });
  release({ clients:{ gone:{ state:'in-game' }, remaining:{ state:'idle' } } });
  assert.deepEqual((await pending).valorantClients, { remaining:{ state:'idle' } });
  store.destroy();
});

test('a complete realtime snapshot replaces a delayed GET atomically across channels', async () => {
  const { fetchJson, release } = deferredRoot();
  let source;
  class FakeSource {
    constructor() { source = this; this.handlers = {}; }
    addEventListener(type, handler) { this.handlers[type] = handler; }
    close() {}
  }
  const store = createLiveDataStore({ EventSourceImpl:FakeSource, fetchJson });
  const seen = [];
  store.subscribe(value => seen.push(value), { refreshOnStart:false });
  const pending = store.refresh();
  seen.length = 0;
  source.handlers.put({ type:'put', data:JSON.stringify({ path:'/', data:{ clients:{ fresh:{ state:'in-game' } }, sessions:{ fresh:{ active:true } } } }) });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].valorantClients.fresh.state, 'in-game');
  assert.equal(seen[0].valorantSessions.fresh.active, true);
  release({ clients:{ old:{ state:'idle' } }, sessions:{ old:{ active:true } } });
  assert.deepEqual(Object.keys((await pending).valorantClients), ['fresh']);
  store.destroy();
});

test('callbacks from a replaced stream and a destroyed request are ignored', async () => {
  const instances = [];
  const { fetchJson, release } = deferredRoot();
  class FakeSource {
    constructor() { this.handlers = {}; instances.push(this); }
    addEventListener(type, handler) { this.handlers[type] = handler; }
    close() {}
  }
  const store = createLiveDataStore({ EventSourceImpl:FakeSource, fetchJson });
  store.start();
  const recovery = store.recoverIfSilent(Date.now() + 80_000);
  instances[0].handlers.put({ type:'put', data:JSON.stringify({ path:'/clients/old', data:{ state:'in-game' } }) });
  assert.deepEqual(store.snapshot().valorantClients, {});
  store.destroy();
  release({ clients:{ old:{ state:'in-game' } } });
  await recovery;
  assert.deepEqual(store.snapshot().valorantClients, {});
});

test('la relecture ne prend que les quatre canaux, jamais tout le nœud live', async () => {
  const urls = [];
  const root = await fetchLiveChannels(async url => { urls.push(url); return { from:url }; }, 'https://fb');
  assert.deepEqual(urls.sort(), [
    'https://fb/live/clients.json', 'https://fb/live/lolClients.json',
    'https://fb/live/lolSessions.json', 'https://fb/live/sessions.json',
  ], 'live/history et live/lolHistory grossissent à chaque partie : ils ne sont pas relus');
  assert.equal(root.clients.from, 'https://fb/live/clients.json');
});

test('une relecture ratée ne fait pas croire à une reconnexion quand le flux est à jour', async () => {
  let source;
  class FakeSource {
    constructor() { source = this; this.handlers = {}; }
    addEventListener(type, handler) { this.handlers[type] = handler; }
    close() {}
  }
  let fail = false;
  const store = createLiveDataStore({ EventSourceImpl:FakeSource, fetchJson:async url => {
    if (fail) throw new Error('The operation was aborted');
    return null;
  } });
  store.start();
  source.onopen();
  source.handlers.put({ type:'put', data:JSON.stringify({ path:'/', data:{ clients:{} } }) });
  // Navigation vers la page Live : relecture qui expire, personne ne joue
  // (aucun évènement du flux ensuite). C'était l'écran « Reconnexion au Live ».
  fail = true;
  const snapshot = await store.refresh();
  assert.equal(snapshot.status.valorantClients.error, '');
  assert.equal(snapshot.status.valorantSessions.connected, true);
  // Sans flux connecté, l'échec reste signalé.
  source.onerror();
  assert.match((await store.refresh()).status.valorantClients.error, /reconnecting|aborted/);
  store.destroy();
});
