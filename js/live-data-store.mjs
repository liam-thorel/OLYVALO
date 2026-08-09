import { fetchJsonWithTimeout } from './request-utils.mjs?v=20260809-route-load-stable';

export const FIREBASE_URL = 'https://realtime-database-5bb9f-default-rtdb.europe-west1.firebasedatabase.app';
export const LIVE_CHANNELS = Object.freeze({
  valorantClients: 'live/clients',
  valorantSessions: 'live/sessions',
  lolClients: 'live/lolClients',
  lolSessions: 'live/lolSessions',
});
const LIVE_ROOT_KEYS = Object.freeze(Object.fromEntries(
  Object.entries(LIVE_CHANNELS).map(([channel, path]) => [path.split('/').at(-1), channel]),
));
export const LIVE_RETENTION_MS = Object.freeze({ active:24 * 60 * 60 * 1000, ended:2 * 60 * 60 * 1000 });

export function liveTimestamp(entry = {}, referenceNow = Date.now()) {
  const value = Number(entry.ts || entry.lastSeen || entry.updatedAt || 0);
  return value > 0 && value < 10_000_000_000 && referenceNow >= 1_000_000_000_000 ? value * 1000 : value;
}

export function liveRecordLifecycle(channel, record = {}) {
  if (String(channel).endsWith('Sessions')) return record.active === false ? 'ended' : 'active';
  const state = String(record.state || '').toLowerCase();
  if (record.online === false || record.connected === false || state === 'stopped') return 'ended';
  return 'active';
}

export function isLiveRecordExpired(channel, record, now = Date.now()) {
  if (!record || typeof record !== 'object') return false;
  const timestamp = liveTimestamp(record, now);
  if (!timestamp) return false;
  const lifecycle = liveRecordLifecycle(channel, record);
  return now - timestamp > LIVE_RETENTION_MS[lifecycle];
}

export function staleLiveRecords(snapshot = {}, now = Date.now()) {
  return Object.entries(LIVE_CHANNELS).flatMap(([channel, firebasePath]) =>
    Object.entries(snapshot[channel] || {})
      .filter(([, record]) => isLiveRecordExpired(channel, record, now))
      .map(([key, record]) => ({ channel, firebasePath, key, record, path:`${firebasePath}/${key}` }))
  );
}

export function mergeRealtimeEvent(current = {}, message = {}) {
  const path = String(message.path || '/');
  const incoming = message.data && typeof message.data === 'object' ? message.data : {};
  if (message.eventType === 'patch' && message.data && typeof message.data === 'object' && !Array.isArray(message.data)) {
    return Object.entries(message.data).reduce((next, [key, value]) => mergeRealtimeEvent(next, {
      path: `${path === '/' ? '' : path}/${key}`,
      data: value,
      eventType: 'patch',
    }), current || {});
  }
  if (path === '/') return incoming;

  const next = { ...(current || {}) };
  const parts = path.split('/').filter(Boolean);
  if (!parts.length) return next;
  let target = next;
  for (let index = 0; index < parts.length - 1; index += 1) {
    target[parts[index]] = { ...(target[parts[index]] || {}) };
    target = target[parts[index]];
  }
  const leaf = parts.at(-1);
  if (message.data === null) delete target[leaf];
  else target[leaf] = message.data;
  return next;
}

export function routeLiveRootEvent(message = {}) {
  const path = String(message.path || '/');
  const parts = path.split('/').filter(Boolean);
  if (parts.length) {
    const channel = LIVE_ROOT_KEYS[parts[0]];
    if (!channel) return [];
    return [{ channel, message:{ ...message, path:parts.length > 1 ? `/${parts.slice(1).join('/')}` : '/' } }];
  }

  const rootData = message.data && typeof message.data === 'object' ? message.data : {};
  if (message.eventType === 'patch') {
    return Object.entries(rootData)
      .filter(([key]) => LIVE_ROOT_KEYS[key])
      .map(([key, data]) => ({ channel:LIVE_ROOT_KEYS[key], message:{ path:'/', data, eventType:'patch' } }));
  }
  return Object.entries(LIVE_ROOT_KEYS).map(([key, channel]) => ({
    channel,
    message:{ path:'/', data:rootData[key] ?? null, eventType:'put' },
  }));
}

export function createLiveDataStore({
  fetchJson = fetchJsonWithTimeout,
  EventSourceImpl = globalThis.EventSource,
  firebaseUrl = FIREBASE_URL,
} = {}) {
  const data = Object.fromEntries(Object.keys(LIVE_CHANNELS).map(channel => [channel, {}]));
  const channelState = Object.fromEntries(Object.keys(LIVE_CHANNELS).map(channel => [channel, {
    loaded: false, connected: false, error: '', updatedAt: 0,
  }]));
  const listeners = new Set();
  const sources = new Map();
  const revisions = Object.fromEntries(Object.keys(LIVE_CHANNELS).map(channel => [channel, 0]));
  let started = false;
  let refreshPromise = null;

  const snapshot = () => ({
    ...data,
    status: Object.fromEntries(Object.entries(channelState).map(([channel, status]) => [channel, { ...status }])),
  });
  const emit = () => {
    const current = snapshot();
    listeners.forEach(listener => {
      try { listener(current); } catch (error) { console.error('[OLYCITY] Live data listener', error); }
    });
  };

  function apply(channel, message) {
    if (!(channel in data)) return;
    data[channel] = mergeRealtimeEvent(data[channel], message);
    revisions[channel] += 1;
    channelState[channel] = {
      loaded: true,
      connected: true,
      error: '',
      updatedAt: Date.now(),
    };
    emit();
  }

  function start() {
    if (started) return;
    started = true;
    if (!EventSourceImpl) return;
    const source = new EventSourceImpl(`${firebaseUrl}/live.json`);
    const handle = event => {
      try {
        routeLiveRootEvent({ ...JSON.parse(event.data), eventType:event.type })
          .forEach(({ channel, message }) => apply(channel, message));
      } catch (error) { console.error('[OLYCITY] Live data', error); }
    };
    source.addEventListener('put', handle);
    source.addEventListener('patch', handle);
    source.onopen = () => {
      Object.keys(channelState).forEach(channel => {
        channelState[channel].connected = true;
        channelState[channel].error = '';
      });
      emit();
    };
    source.onerror = () => {
      Object.keys(channelState).forEach(channel => {
        channelState[channel].connected = false;
        channelState[channel].error = 'reconnecting';
      });
      emit();
    };
    sources.set('live', source);
  }

  async function refresh({ timeoutMs = 4_000 } = {}) {
    start();
    if (refreshPromise) return refreshPromise;
    const revisionsAtStart = { ...revisions };
    refreshPromise = fetchJson(`${firebaseUrl}/live.json`, { timeoutMs }).then(incomingRoot => {
      Object.entries(LIVE_CHANNELS).forEach(([channel, path]) => {
        const incoming = incomingRoot?.[path.split('/').at(-1)] || {};
        // Une mise à jour SSE reçue pendant le GET reste prioritaire.
        data[channel] = revisions[channel] === revisionsAtStart[channel]
          ? { ...(incoming || {}) }
          : { ...(incoming || {}), ...data[channel] };
        channelState[channel] = {
          loaded: true,
          connected: channelState[channel].connected,
          error: '',
          updatedAt: Date.now(),
        };
      });
    }).catch(error => {
      Object.keys(channelState).forEach(channel => {
        channelState[channel].error = error?.message || 'unavailable';
      });
    }).then(() => {
      emit();
      return snapshot();
    }).finally(() => { refreshPromise = null; });
    return refreshPromise;
  }

  function subscribe(listener, { refreshOnStart = true } = {}) {
    start();
    listeners.add(listener);
    listener(snapshot());
    if (refreshOnStart && !Object.values(channelState).every(status => status.loaded)) refresh().catch(() => {});
    return () => listeners.delete(listener);
  }

  function destroy() {
    sources.forEach(source => source.close());
    sources.clear();
    listeners.clear();
    started = false;
  }

  return { apply, destroy, refresh, snapshot, start, subscribe };
}

export const liveDataStore = createLiveDataStore();
