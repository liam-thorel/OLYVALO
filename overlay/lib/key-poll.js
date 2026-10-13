/**
 * Lecture directe du raccourci, pour quand RegisterHotKey ne nous parvient pas.
 *
 * LoL enregistre son clavier en « raw input » avec RIDEV_NOHOTKEYS : tant que
 * le jeu a le focus, Windows ne délivre AUCUN raccourci enregistré par
 * RegisterHotKey — le nôtre compris. Le journal le montre : raccourci « actif »,
 * mais jamais « reçu ».
 *
 * Le repli interroge l'état des touches du raccourci (GetAsyncKeyState) toutes
 * les quelques dizaines de millisecondes, et seulement pendant que LoL tourne.
 * Ce n'est PAS un hook clavier : on ne voit passer aucune frappe, on demande
 * juste « ces trois touches sont-elles enfoncées ? ». Aucune injection, aucun
 * contact avec le processus du jeu.
 *
 * Ce module ne touche pas à Windows : la fonction de lecture lui est fournie,
 * ce qui permet de le tester ailleurs.
 */

// Codes de touches virtuelles Win32. Chaque entrée est une liste : la touche
// compte comme enfoncée si l'un des codes l'est (Win gauche OU droite).
const MODIFIERS = {
  control: [0x11], ctrl: [0x11], commandorcontrol: [0x11], cmdorctrl: [0x11],
  shift: [0x10],
  alt: [0x12], option: [0x12], altgr: [0x12],
  super: [0x5B, 0x5C], meta: [0x5B, 0x5C], command: [0x5B, 0x5C], cmd: [0x5B, 0x5C],
};

const NAMED = {
  space: 0x20, tab: 0x09, enter: 0x0D, return: 0x0D, esc: 0x1B, escape: 0x1B,
  backspace: 0x08, delete: 0x2E, insert: 0x2D, home: 0x24, end: 0x23,
  pageup: 0x21, pagedown: 0x22, up: 0x26, down: 0x28, left: 0x25, right: 0x27,
};

/** Code d'une touche non modificatrice, ou null si on ne sait pas la lire. */
function keyCode(name) {
  const key = name.toLowerCase();
  const fn = /^f([1-9]|1\d|2[0-4])$/.exec(key);
  if (fn) return 0x70 + Number(fn[1]) - 1; // F1 = 0x70 … F24 = 0x87
  if (/^[a-z]$/.test(key)) return key.toUpperCase().charCodeAt(0); // 'A' = 0x41
  if (/^[0-9]$/.test(key)) return key.charCodeAt(0); // '0' = 0x30
  return NAMED[key] ?? null;
}

/**
 * « Control+Shift+F8 » → [[0x11], [0x10], [0x77]].
 * null si la combinaison contient une touche inconnue, ou aucune touche hors
 * modificateurs : mieux vaut ne pas sonder qu'en sonder une partie et se
 * déclencher sur Ctrl+Maj seuls.
 */
function acceleratorKeys(accelerator) {
  const parts = String(accelerator || '').split('+').map(part => part.trim()).filter(Boolean);
  if (!parts.length) return null;
  const keys = [];
  let main = 0;
  for (const part of parts) {
    const modifier = MODIFIERS[part.toLowerCase()];
    if (modifier) { keys.push(modifier); continue; }
    const code = keyCode(part);
    if (code === null) return null;
    keys.push([code]);
    main += 1;
  }
  return main === 1 ? keys : null;
}

/**
 * Sonde l'état des touches et appelle onPress une fois par appui : il faut
 * que la combinaison passe de « pas toute enfoncée » à « toute enfoncée ».
 * Garder les touches enfoncées ne répète donc rien.
 *
 * isDown(vk) → booléen ; ses erreurs arrêtent la sonde plutôt que de remplir
 * le journal toutes les 40 ms.
 */
function createKeyPoller({ isDown, keys, onPress, onError = () => {}, intervalMs = 40,
  setInterval_ = setInterval, clearInterval_ = clearInterval }) {
  let timer = null;
  let wasDown = true; // une combinaison déjà tenue au démarrage ne compte pas

  const allDown = () => keys.every(alternatives => alternatives.some(vk => isDown(vk)));

  function tick() {
    let down;
    try {
      down = allDown();
    } catch (error) {
      stop();
      onError(error);
      return;
    }
    if (down && !wasDown) onPress();
    wasDown = down;
  }

  function start() {
    if (timer || !keys?.length) return false;
    wasDown = true;
    timer = setInterval_(tick, intervalMs);
    timer?.unref?.();
    return true;
  }

  function stop() {
    if (!timer) return;
    clearInterval_(timer);
    timer = null;
  }

  return { start, stop, tick, running: () => timer !== null };
}

/**
 * Le même appui peut arriver deux fois : par RegisterHotKey quand le jeu n'a
 * pas le focus, ET par la sonde. Sans ce filtre, l'overlay s'ouvrirait et se
 * refermerait aussitôt.
 */
function createDebounce(windowMs = 400, now = Date.now) {
  let last = -Infinity;
  return () => {
    const at = now();
    if (at - last < windowMs) return false;
    last = at;
    return true;
  };
}

module.exports = { acceleratorKeys, createKeyPoller, createDebounce };
