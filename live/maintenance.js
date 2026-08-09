const { presenceLifecycle, presenceTimestamp } = require('./presence-schema.js');

const STALE_PRESENCE_MS = 24 * 60 * 60 * 1000;
const ENDED_PRESENCE_MS = 2 * 60 * 60 * 1000;
const PRESENCE_CLEANUP_INTERVAL_MS = 30 * 60 * 1000;
const PRESENCE_PATHS = ['live/clients', 'live/sessions', 'live/lolClients', 'live/lolSessions'];

function stalePresenceKeys(records, now = Date.now(), maxAge = STALE_PRESENCE_MS) {
  if (!records || typeof records !== 'object') return [];
  return Object.entries(records)
    .filter(([, record]) => {
      const ts = presenceTimestamp(record, now);
      return Number.isFinite(ts) && ts > 0 && now - ts > maxAge;
    })
    .map(([key]) => key);
}

function presenceRetentionMs(path, record = {}) {
  const kind = String(path).includes('Sessions') || String(path).endsWith('/sessions') ? 'session' : 'client';
  return ['ended', 'offline'].includes(presenceLifecycle(record, kind)) ? ENDED_PRESENCE_MS : STALE_PRESENCE_MS;
}

function stalePresenceKeysForPath(path, records, now = Date.now()) {
  if (!records || typeof records !== 'object') return [];
  return Object.entries(records)
    .filter(([, record]) => stalePresenceKeys({ record }, now, presenceRetentionMs(path, record)).length > 0)
    .map(([key]) => key);
}

async function cleanupStalePresence({ getFB, putFB, now = Date.now(), paths = PRESENCE_PATHS }) {
  if (typeof getFB !== 'function' || typeof putFB !== 'function') return 0;
  const snapshots = await Promise.all(paths.map(path => getFB(path).catch(() => null)));
  const removals = [];
  paths.forEach((path, index) => {
    stalePresenceKeysForPath(path, snapshots[index], now).forEach(key => {
      const recordPath = `${path}/${key}`;
      removals.push((async () => {
        // Relecture juste avant la suppression : un autre script a pu publier
        // un heartbeat frais depuis le snapshot initial.
        const current = await getFB(recordPath).catch(() => null);
        if (stalePresenceKeys({ [key]: current }, now, presenceRetentionMs(path, current)).length === 0) return false;
        return putFB(recordPath, null).catch(() => false);
      })());
    });
  });
  const results = await Promise.all(removals);
  return results.filter(Boolean).length;
}

module.exports = {
  PRESENCE_PATHS,
  PRESENCE_CLEANUP_INTERVAL_MS,
  ENDED_PRESENCE_MS,
  STALE_PRESENCE_MS,
  cleanupStalePresence,
  presenceRetentionMs,
  stalePresenceKeys,
  stalePresenceKeysForPath,
};
