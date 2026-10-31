/**
 * Acte Valorant en cours, pour borner les statistiques de l'Historique à la
 * saison actuelle. Les parties enregistrées ne portent pas l'identifiant de
 * saison : on prend les dates de l'acte (valorant-api.com/v1/seasons).
 *
 * Sans réponse (hors ligne, API indisponible), l'Historique se rabat sur
 * toutes les compétitives enregistrées, et le dit.
 */

const SEASONS_URL = 'https://valorant-api.com/v1/seasons';
const CACHE_KEY = 'olycity-valorant-act-v1';
const CACHE_MS = 12 * 3_600_000;

/** « ACT III » → « Acte III », « EPISODE 9 » → « Épisode 9 », « V25 » reste « V25 ». */
function frenchSeasonName(name = '') {
  return String(name).trim()
    .replace(/^act\b/i, 'Acte')
    .replace(/^episode\b/i, 'Épisode');
}

/**
 * Acte qui contient `now`, d'après la liste de valorant-api.com :
 * { uuid, label, startTime, endTime } ou null.
 */
export function currentAct(seasons = [], now = Date.now()) {
  const list = Array.isArray(seasons) ? seasons : [];
  const act = list.find(season => /act/i.test(String(season?.type || ''))
    && Date.parse(season.startTime) <= now && now < Date.parse(season.endTime));
  if (!act) return null;
  const episode = list.find(season => season?.uuid && season.uuid === act.parentUuid);
  const label = [episode?.displayName, act.displayName].filter(Boolean).map(frenchSeasonName).join(' · ');
  return { uuid: act.uuid, label: label || 'Acte en cours', startTime: Date.parse(act.startTime), endTime: Date.parse(act.endTime) };
}

/** La partie a-t-elle été jouée pendant l'acte ? */
export function inAct(game, act) {
  const ts = Number(game?.ts || game?.endTs || 0);
  return Boolean(act) && ts >= act.startTime && ts < act.endTime;
}

let pending = null;

/** Acte en cours (gardé 12 h), ou null si l'API ne répond pas. */
export function loadCurrentAct({ fetchImpl = globalThis.fetch, storage = globalThis.localStorage, now = Date.now(), timeoutMs = 4_000 } = {}) {
  try {
    const cached = JSON.parse(storage?.getItem(CACHE_KEY) || 'null');
    if (cached?.act && now - cached.savedAt < CACHE_MS && now < cached.act.endTime) return Promise.resolve(cached.act);
  } catch { /* stockage indisponible */ }
  if (pending) return pending;
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = setTimeout(() => controller?.abort(), timeoutMs);
  pending = fetchImpl(SEASONS_URL, controller ? { signal: controller.signal } : undefined)
    .then(response => (response.ok ? response.json() : null))
    .then(body => {
      const act = currentAct(body?.data, now);
      if (act) { try { storage?.setItem(CACHE_KEY, JSON.stringify({ savedAt: now, act })); } catch { /* plein */ } }
      return act;
    })
    .catch(() => null)
    .finally(() => { clearTimeout(timer); pending = null; });
  return pending;
}
