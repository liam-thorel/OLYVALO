/**
 * OLYCITY · Storage
 * Wrapper localStorage avec keys et fallbacks.
 */

const KEYS = {
  THEME: 'olycity-theme',
  FAVS: 'olycity-favs',
  PLAYER_STATS: 'olycity-player-stats',
};

export const storage = {
  getTheme() {
    try { return localStorage.getItem(KEYS.THEME) || 'dark'; }
    catch { return 'dark'; }
  },
  setTheme(value) {
    try { localStorage.setItem(KEYS.THEME, value); } catch {}
  },

  getFavs() {
    try {
      const raw = localStorage.getItem(KEYS.FAVS);
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  },
  setFavs(favs) {
    try { localStorage.setItem(KEYS.FAVS, JSON.stringify(favs)); } catch {}
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
};

export function formatRelTime(ts) {
  const diff = (Date.now() - ts) / 1000;
  if (diff < 60) return "à l'instant";
  if (diff < 3600) return `il y a ${Math.floor(diff / 60)}min`;
  if (diff < 86400) return `il y a ${Math.floor(diff / 3600)}h`;
  return `il y a ${Math.floor(diff / 86400)}j`;
}
