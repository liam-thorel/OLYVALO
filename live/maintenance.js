const STALE_PRESENCE_MS = 24 * 60 * 60 * 1000;
const PRESENCE_PATHS = ['live/clients', 'live/sessions', 'live/lolClients', 'live/lolSessions'];

function stalePresenceKeys(records, now = Date.now(), maxAge = STALE_PRESENCE_MS) {
  if (!records || typeof records !== 'object') return [];
  return Object.entries(records)
    .filter(([, record]) => {
      const ts = Number(record?.ts || 0);
      return Number.isFinite(ts) && ts > 0 && now - ts > maxAge;
    })
    .map(([key]) => key);
}

async function cleanupStalePresence({ getFB, putFB, now = Date.now(), paths = PRESENCE_PATHS }) {
  if (typeof getFB !== 'function' || typeof putFB !== 'function') return 0;
  const snapshots = await Promise.all(paths.map(path => getFB(path).catch(() => null)));
  const removals = [];
  paths.forEach((path, index) => {
    stalePresenceKeys(snapshots[index], now).forEach(key => {
      const recordPath = `${path}/${key}`;
      removals.push((async () => {
        // Relecture juste avant la suppression : un autre script a pu publier
        // un heartbeat frais depuis le snapshot initial.
        const current = await getFB(recordPath).catch(() => null);
        if (stalePresenceKeys({ [key]: current }, now).length === 0) return false;
        return putFB(recordPath, null).catch(() => false);
      })());
    });
  });
  const results = await Promise.all(removals);
  return results.filter(Boolean).length;
}

module.exports = {
  PRESENCE_PATHS,
  STALE_PRESENCE_MS,
  cleanupStalePresence,
  stalePresenceKeys,
};
