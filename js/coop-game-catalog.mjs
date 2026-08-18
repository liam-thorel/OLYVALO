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

export async function searchGameCatalog(value, { endpoint, fetchImpl = fetch } = {}) {
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
  const response = await fetchImpl(url, { headers: { Accept: 'application/json' } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Catalogue HTTP ${response.status}`);
  return Array.isArray(payload.results) ? payload.results : [];
}
