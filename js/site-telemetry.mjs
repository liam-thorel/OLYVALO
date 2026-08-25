const STORAGE_KEY = 'olycity-site-vitals-v1';

function save(snapshot) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...snapshot, savedAt:Date.now() })); }
  catch { /* Private mode and full storage must never block the site. */ }
}

export function readSiteVitals() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); }
  catch { return null; }
}

export function initSiteTelemetry() {
  const metrics = readSiteVitals() || {};
  const navigation = performance.getEntriesByType?.('navigation')?.[0];
  if (navigation) {
    metrics.loadMs = Math.round(navigation.loadEventEnd || navigation.duration || 0);
    metrics.domMs = Math.round(navigation.domContentLoadedEventEnd || 0);
  }
  save(metrics);
  if (!('PerformanceObserver' in window)) return;
  try {
    new PerformanceObserver(list => {
      const entry = list.getEntries().at(-1);
      if (entry) { metrics.lcpMs = Math.round(entry.startTime); save(metrics); }
    }).observe({ type:'largest-contentful-paint', buffered:true });
  } catch {}
  try {
    let cls = 0;
    new PerformanceObserver(list => {
      list.getEntries().forEach(entry => { if (!entry.hadRecentInput) cls += entry.value; });
      metrics.cls = Number(cls.toFixed(3));
      save(metrics);
    }).observe({ type:'layout-shift', buffered:true });
  } catch {}
}
