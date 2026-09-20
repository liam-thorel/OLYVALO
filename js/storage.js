/**
 * OLYCITY · Storage
 * Wrapper localStorage avec keys et fallbacks.
 */

const KEYS = {
  THEME: 'olycity-theme',
  // Ancien format : une entrée par NOM DE MEMBRE. Conservé en lecture seule —
  // les synchros déjà faites décrivent le compte principal, et les jeter
  // obligerait tout le monde à recommencer.
  PLAYER_STATS: 'olycity-player-stats',
  // Nouveau format : une entrée par COMPTE, indexée sur le PUUID. Un joueur et
  // son smurf se disputaient la même case, et synchroniser l'un effaçait
  // l'autre.
  ACCOUNT_STATS: 'olycity-account-stats',
};

export const storage = {
  getTheme() {
    try { return localStorage.getItem(KEYS.THEME) || 'dark'; }
    catch { return 'dark'; }
  },
  setTheme(value) {
    try { localStorage.setItem(KEYS.THEME, value); } catch {}
  },

  getPlayerStats() {
    try {
      const raw = localStorage.getItem(KEYS.PLAYER_STATS);
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  },
  setPlayerStats(stats) {
    try { localStorage.setItem(KEYS.PLAYER_STATS, JSON.stringify(stats)); } catch {}
  },

  getAccountStats() {
    try {
      const raw = localStorage.getItem(KEYS.ACCOUNT_STATS);
      const parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch { return {}; }
  },
  setAccountStats(stats) {
    try { localStorage.setItem(KEYS.ACCOUNT_STATS, JSON.stringify(stats)); } catch {}
  },
};

export function formatRelTime(ts) {
  const diff = (Date.now() - ts) / 1000;
  if (diff < 60) return "à l'instant";
  if (diff < 3600) return `il y a ${Math.floor(diff / 60)}min`;
  if (diff < 86400) return `il y a ${Math.floor(diff / 3600)}h`;
  return `il y a ${Math.floor(diff / 86400)}j`;
}
