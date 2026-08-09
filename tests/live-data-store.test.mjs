import test from 'node:test';
import assert from 'node:assert/strict';

import { createLiveDataStore, isLiveRecordExpired, liveTimestamp, mergeRealtimeEvent, staleLiveRecords } from '../js/live-data-store.mjs';

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

test('one store opens only one EventSource per channel for all subscribers', () => {
  const opened = [];
  class FakeEventSource {
    constructor(url) { this.url = url; opened.push(url); }
    addEventListener() {}
    close() {}
  }
  const store = createLiveDataStore({ EventSourceImpl:FakeEventSource, fetchJson:async () => ({}) });
  const stopA = store.subscribe(() => {}, { refreshOnStart:false });
  const stopB = store.subscribe(() => {}, { refreshOnStart:false });
  assert.equal(opened.length, 4);
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
  const store = createLiveDataStore({ EventSourceImpl:null, fetchJson:async () => pending });
  const refreshing = store.refresh();
  store.apply('valorantClients', { path:'/p1', data:{ state:'in-game', ts:20 } });
  release({ p1:{ state:'idle', ts:10 }, p2:{ state:'idle', ts:10 } });
  const snapshot = await refreshing;
  assert.equal(snapshot.valorantClients.p1.state, 'in-game');
  assert.equal(snapshot.valorantClients.p2.state, 'idle');
});

test('refresh removes cached records that no longer exist remotely', async () => {
  const store = createLiveDataStore({ EventSourceImpl:null, fetchJson:async () => ({ current:{ ts:20 } }) });
  store.apply('valorantClients', { path:'/', data:{ stale:{ ts:10 } } });
  const snapshot = await store.refresh();
  assert.deepEqual(snapshot.valorantClients, { current:{ ts:20 } });
});
