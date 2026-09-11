/**
 * Réglages persistés. Le fichier est modifiable à la main et peut être
 * corrompu (coupure de courant, édition ratée) : toute valeur invalide
 * retombe sur son défaut plutôt que de faire planter une application lancée
 * au démarrage de Windows, qui n'aurait alors aucun moyen d'être réparée
 * autrement qu'en supprimant le fichier.
 */

const DEFAULTS = {
  hotkey: 'Control+Shift+F8',
  autoShow: true,        // s'afficher au lancement du jeu
  // Mode consultation : la fenêtre ne prend jamais le focus, donc la barre des
  // tâches ne réapparaît pas par-dessus le jeu. En contrepartie il faut
  // cliquer dedans pour s'en servir — ce clic rend le focus, et la barre avec.
  neverFocus: false,
  openAtLogin: true,
  opacity: 0.95,
  bounds: null,          // { x, y, width, height } — position mémorisée
};

const MIN_OPACITY = 0.3; // en dessous, la fenêtre devient invisible et
                         // l'utilisateur ne peut plus la retrouver

// Accélérateurs Electron : une suite de modificateurs puis une touche. On
// valide la FORME ici ; Electron refusera de son côté un accélérateur qu'il ne
// comprend pas, et main.js retombe alors sur le défaut.
const MODIFIERS = new Set([
  'command', 'cmd', 'control', 'ctrl', 'commandorcontrol', 'cmdorctrl',
  'alt', 'option', 'altgr', 'shift', 'super', 'meta',
]);

function isValidHotkey(value) {
  if (typeof value !== 'string') return false;
  const parts = value.split('+').map(part => part.trim()).filter(Boolean);
  if (parts.length < 2) return false; // une touche seule capterait la frappe
                                      // partout dans Windows, jeu compris
  const key = parts[parts.length - 1];
  const modifiers = parts.slice(0, -1);
  if (modifiers.length === 0) return false;
  if (!modifiers.every(part => MODIFIERS.has(part.toLowerCase()))) return false;
  // La dernière partie doit être une touche, pas encore un modificateur.
  return key.length > 0 && !MODIFIERS.has(key.toLowerCase());
}

function isValidBounds(value) {
  if (!value || typeof value !== 'object') return false;
  return ['x', 'y', 'width', 'height'].every(key => Number.isFinite(value[key]))
    && value.width > 0 && value.height > 0;
}

/** Nettoie un objet de réglages venu du disque. Ne jette jamais. */
function sanitize(raw) {
  const input = raw && typeof raw === 'object' ? raw : {};
  const opacity = Number(input.opacity);
  return {
    hotkey: isValidHotkey(input.hotkey) ? input.hotkey : DEFAULTS.hotkey,
    autoShow: typeof input.autoShow === 'boolean' ? input.autoShow : DEFAULTS.autoShow,
    neverFocus: typeof input.neverFocus === 'boolean' ? input.neverFocus : DEFAULTS.neverFocus,
    openAtLogin: typeof input.openAtLogin === 'boolean' ? input.openAtLogin : DEFAULTS.openAtLogin,
    opacity: Number.isFinite(opacity) ? Math.min(1, Math.max(MIN_OPACITY, opacity)) : DEFAULTS.opacity,
    bounds: isValidBounds(input.bounds) ? {
      x: Math.round(input.bounds.x), y: Math.round(input.bounds.y),
      width: Math.round(input.bounds.width), height: Math.round(input.bounds.height),
    } : DEFAULTS.bounds,
  };
}

function parseSettings(fileContents) {
  try {
    return sanitize(JSON.parse(String(fileContents)));
  } catch {
    return sanitize(null);
  }
}

module.exports = { DEFAULTS, MIN_OPACITY, sanitize, parseSettings, isValidHotkey, isValidBounds };
