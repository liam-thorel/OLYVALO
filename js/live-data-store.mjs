import { fetchJsonWithTimeout } from './request-utils.mjs?v=20260809-route-load-stable';

export const FIREBASE_URL = 'https://realtime-database-5bb9f-default-rtdb.europe-west1.firebasedatabase.app';
export const LIVE_CHANNELS = Object.freeze({
  valorantClients: 'live/clients',
  valorantSessions: 'live/sessions',
  lolClients: 'live/lolClients',
  lolSessions: 'live/lolSessions',
});

export function liveTimestamp(entry = {}, referenceNow = Date.now()) {
  const value = Number(entry.ts || entry.lastSeen || entry.updatedAt || 0);
  return value > 0 && value < 10_000_000_000 && referenceNow >= 1_000_000_000_000 ? value * 1000 : value;
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
    Object.entries(LIVE_CHANNELS).forEach(([channel, path]) => {
      const source = new EventSourceImpl(`${firebaseUrl}/${path}.json`);
      const handle = event => {
        try { apply(channel, { ...JSON.parse(event.data), eventType:event.type }); }
        catch (error) { console.error(`[OLYCITY] Live data ${channel}`, error); }
      };
      source.addEventListener('put', handle);
      source.addEventListener('patch', handle);
      source.onopen = () => {
        channelState[channel].connected = true;
        channelState[channel].error = '';
        emit();
      };
      source.onerror = () => {
        channelState[channel].connected = false;
        channelState[channel].error = 'reconnecting';
        emit();
      };
      sources.set(channel, source);
    });
  }

  async function refresh({ timeoutMs = 4_000 } = {}) {
    start();
    if (refreshPromise) return refreshPromise;
    refreshPromise = Promise.all(Object.entries(LIVE_CHANNELS).map(async ([channel, path]) => {
      const revisionAtStart = revisions[channel];
      try {
        const incoming = await fetchJson(`${firebaseUrl}/${path}.json`, { timeoutMs });
        // Une mise à jour SSE reçue pendant le GET reste prioritaire.
        data[channel] = revisions[channel] === revisionAtStart
          ? { ...(incoming || {}) }
          : { ...(incoming || {}), ...data[channel] };
        channelState[channel] = {
          loaded: true,
          connected: channelState[channel].connected,
          error: '',
          updatedAt: Date.now(),
        };
      } catch (error) {
        channelState[channel].error = error?.message || 'unavailable';
      }
    })).then(() => {
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
