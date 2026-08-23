import { extractSteamAppId } from './coop-games-utils.mjs';

let endpointPromise = null;

export async function gameCatalogEndpoint() {
  if (window.OLYCITY_GAME_CATALOG_ENDPOINT) return String(window.OLYCITY_GAME_CATALOG_ENDPOINT).replace(/\/$/, '');
  if (!endpointPromise) {
    endpointPromise = import('../config.js')
      .then(module => String(module.CONFIG?.GAME_CATALOG_ENDPOINT || '').replace(/\/$/, ''))
      .catch(() => '');
  }
  return endpointPromise;
}

export async function searchGameCatalog(value, { endpoint, fetchImpl = fetch, signal } = {}) {
  const query = String(value || '').trim();
  if (query.length < 2) return [];
  const base = String(endpoint ?? await gameCatalogEndpoint()).replace(/\/$/, '');
  if (!base) {
    const error = new Error('Le catalogue automatique n’est pas encore connecté.');
    error.code = 'CATALOG_NOT_CONFIGURED';
    throw error;
  }
  const steamAppId = extractSteamAppId(query);
  const url = new URL(`${base}/search`);
  if (steamAppId) url.searchParams.set('steamAppId', steamAppId);
  else url.searchParams.set('q', query);
  const response = await fetchImpl(url, { headers: { Accept: 'application/json' }, signal });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Catalogue HTTP ${response.status}`);
  return Array.isArray(payload.results) ? payload.results : [];
}

export async function fetchSteamReviewSummaries(appIds = [], { endpoint, fetchImpl = fetch, signal } = {}) {
  const ids = [...new Set(appIds.map(String).filter(id => /^\d{2,10}$/.test(id)))].slice(0, 20);
  if (!ids.length) return [];
  const base = String(endpoint ?? await gameCatalogEndpoint()).replace(/\/$/, '');
  if (!base) return [];
  const url = new URL(`${base}/reviews`);
  url.searchParams.set('ids', ids.join(','));
  const response = await fetchImpl(url, { headers: { Accept: 'application/json' }, signal });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Avis Steam HTTP ${response.status}`);
  return Array.isArray(payload.reviews) ? payload.reviews : [];
}
