import { fetchJsonWithTimeout } from './request-utils.mjs?v=20260809-route-load-stable';

export function historyIndexTimestamp(value = {}) {
  const reports = value?.reports && typeof value.reports === 'object' ? Object.values(value.reports) : [];
  return Math.max(Number(value?.ts || 0), ...reports.map(report => Number(report?.endTs || report?.ts || 0)));
}

function summaryValue(value) {
  if (!value || typeof value !== 'object') return value;
  if (value.reports && typeof value.reports === 'object') {
    return {
      ...value,
      reports:Object.fromEntries(Object.entries(value.reports).map(([key, report]) => [key, { ...report, __summary:true }])),
    };
  }
  return { ...value, __summary:true };
}

export function createHistoryPager({
  firebaseUrl,
  indexPath,
  dataPath,
  pageSize = 30,
  cacheMs = 60_000,
  fetchJson = fetchJsonWithTimeout,
} = {}) {
  let index = [];
  let indexedAt = 0;
  let indexPromise = null;
  const loaded = new Map();
  const detailCache = new Map();

  const url = path => `${firebaseUrl}/${path}.json`;
  const rebuildIndex = raw => {
    index = Object.entries(raw || {})
      .map(([id, value]) => ({ id, value, ts:historyIndexTimestamp(value) }))
      .filter(entry => entry.ts > 0)
      .sort((left, right) => right.ts - left.ts || right.id.localeCompare(left.id));
    indexedAt = Date.now();
    return index;
  };

  async function loadIndex({ force = false } = {}) {
    if (!force && index.length && Date.now() - indexedAt < cacheMs) return index;
    if (indexPromise) return indexPromise;
    indexPromise = (async () => {
      const rawIndex = await fetchJson(url(indexPath), { timeoutMs:8_000 });
      if (rawIndex && Object.keys(rawIndex).length) return rebuildIndex(rawIndex);

      // Compatibilité de secours avant/pendant une migration d'index : une
      // lecture complète reste fonctionnelle, puis les détails sont gardés en
      // mémoire afin de ne pas être retéléchargés.
      const legacy = await fetchJson(url(dataPath), { timeoutMs:12_000 });
      Object.entries(legacy || {}).forEach(([id, value]) => detailCache.set(id, value));
      return rebuildIndex(legacy || {});
    })().finally(() => { indexPromise = null; });
    return indexPromise;
  }

  async function loadNext() {
    await loadIndex();
    const next = index.filter(entry => !loaded.has(entry.id)).slice(0, pageSize);
    next.forEach(entry => loaded.set(entry.id, summaryValue(entry.value)));
    return snapshot();
  }

  async function loadDetail(id) {
    if (detailCache.has(id)) return detailCache.get(id);
    const detail = await fetchJson(url(`${dataPath}/${encodeURIComponent(id)}`), { timeoutMs:8_000 });
    if (detail) detailCache.set(id, detail);
    return detail;
  }

  function snapshot() {
    const ordered = index.filter(entry => loaded.has(entry.id));
    return {
      data:Object.fromEntries(ordered.map(entry => [entry.id, loaded.get(entry.id)])),
      loaded:ordered.length,
      total:index.length,
      remaining:Math.max(0, index.length - ordered.length),
      hasMore:ordered.length < index.length,
    };
  }

  function reset() {
    index = [];
    indexedAt = 0;
    loaded.clear();
    detailCache.clear();
  }

  return { loadDetail, loadIndex, loadNext, reset, snapshot };
}
