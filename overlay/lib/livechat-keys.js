/**
 * Touches du livechat réglées depuis l'overlay.
 *
 * Les réglages appartiennent à OLYCITY Live (olycity-livechat.json, dans son
 * dossier d'installation) : le Live publie où ils sont dans
 * %LOCALAPPDATA%\OLYCITY\livechat\settings-location.json, et relit le fichier
 * toutes les 3 secondes. L'overlay n'écrit que les champs qu'il change.
 *
 * Même format et mêmes règles que live/livechat-utils.js (un test vérifie
 * que les noms de touches concordent) : { vk, ctrl, shift, alt, win }.
 */
const fs = require('fs');
const path = require('path');

const POINTER = path.join('OLYCITY', 'livechat', 'settings-location.json');
const DEFAULT_SKIP_KEY = { vk: 0x78, ctrl: true, shift: true, alt: false, win: false };
const DEFAULT_TOGGLE_KEY = { vk: 0x79, ctrl: true, shift: true, alt: false, win: false };
const MODIFIER_VKS = new Set([0x10, 0x11, 0x12, 0x5b, 0x5c, 0xa0, 0xa1, 0xa2, 0xa3, 0xa4, 0xa5]);
const FORBIDDEN_VKS = new Set([0x01, 0x02]);
const FIELDS = { toggle: 'toggleKey', skip: 'skipKey' };

const VK_NAMES = {
  0x03: 'Pause/Attn', 0x04: 'Clic molette', 0x05: 'Souris 4', 0x06: 'Souris 5',
  0x08: 'Retour arrière', 0x09: 'Tab', 0x0d: 'Entrée', 0x13: 'Pause', 0x14: 'Verr. Maj',
  0x1b: 'Échap', 0x20: 'Espace', 0x21: 'Page préc.', 0x22: 'Page suiv.', 0x23: 'Fin', 0x24: 'Début',
  0x25: 'Gauche', 0x26: 'Haut', 0x27: 'Droite', 0x28: 'Bas', 0x2c: 'Impr. écran', 0x2d: 'Inser', 0x2e: 'Suppr',
  0x5d: 'Menu', 0x6a: 'Pavé *', 0x6b: 'Pavé +', 0x6d: 'Pavé -', 0x6e: 'Pavé .', 0x6f: 'Pavé /',
  0x90: 'Verr. Num', 0x91: 'Arrêt défil', 0xad: 'Muet', 0xae: 'Volume -', 0xaf: 'Volume +',
  0xb0: 'Piste suivante', 0xb1: 'Piste précédente', 0xb3: 'Lecture/Pause',
  0xba: '$', 0xbb: '=', 0xbc: ',', 0xbe: ';', 0xbf: ':', 0xc0: 'ù', 0xdb: ')', 0xdc: '*', 0xdd: '^', 0xde: '²', 0xdf: '!', 0xe2: '<',
};

function vkName(vk) {
  if (vk >= 0x70 && vk <= 0x87) return `F${vk - 0x6f}`;
  if ((vk >= 0x30 && vk <= 0x39) || (vk >= 0x41 && vk <= 0x5a)) return String.fromCharCode(vk);
  if (vk >= 0x60 && vk <= 0x69) return `Pavé ${vk - 0x60}`;
  return VK_NAMES[vk] || `Touche ${vk}`;
}

function hotkeyLabel(key) {
  if (!key) return 'aucune';
  return [key.ctrl && 'Ctrl', key.shift && 'Maj', key.alt && 'Alt', key.win && 'Win', vkName(key.vk)].filter(Boolean).join('+');
}

function normalizeHotkey(raw, fallback) {
  if (raw === null) return null;
  if (!raw || typeof raw !== 'object') return fallback;
  const vk = Math.round(Number(raw.vk));
  if (!Number.isInteger(vk) || vk < 1 || vk > 254 || MODIFIER_VKS.has(vk) || FORBIDDEN_VKS.has(vk)) return fallback;
  return { vk, ctrl: raw.ctrl === true, shift: raw.shift === true, alt: raw.alt === true, win: raw.win === true };
}

const sameHotkey = (a, b) => Boolean(a && b) && a.vk === b.vk && a.ctrl === b.ctrl && a.shift === b.shift && a.alt === b.alt && a.win === b.win;

/**
 * Touche appuyée dans la fenêtre de réglage. `keyCode` de Chromium vaut le
 * code de touche virtuelle Windows. Rend { key }, { cancel } (Échap seul) ou
 * null (un modificateur seul : on attend la touche principale).
 */
function keyFromKeyboardEvent(event) {
  const vk = Number(event?.keyCode);
  if (!Number.isInteger(vk) || MODIFIER_VKS.has(vk)) return null;
  const mods = { ctrl: Boolean(event.ctrlKey), shift: Boolean(event.shiftKey), alt: Boolean(event.altKey), win: Boolean(event.metaKey) };
  if (vk === 0x1b && !mods.ctrl && !mods.shift && !mods.alt && !mods.win) return { cancel: true };
  const key = normalizeHotkey({ vk, ...mods }, null);
  return key ? { key } : null;
}

/** Bouton de souris : molette (1), précédent (3) et suivant (4) seulement. */
function keyFromMouseEvent(event) {
  const vk = { 1: 0x04, 3: 0x05, 4: 0x06 }[event?.button];
  if (!vk) return null;
  return { key: { vk, ctrl: Boolean(event.ctrlKey), shift: Boolean(event.shiftKey), alt: Boolean(event.altKey), win: Boolean(event.metaKey) } };
}

function pointerPath(env = process.env) {
  return env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, POINTER) : null;
}

/** Emplacement des réglages du Live sur ce PC, ou null (Live absent ou trop ancien). */
function findSettingsFile({ env = process.env, fsImpl = fs } = {}) {
  const pointer = pointerPath(env);
  if (!pointer) return null;
  try {
    const { configPath } = JSON.parse(fsImpl.readFileSync(pointer, 'utf8'));
    return typeof configPath === 'string' && configPath.endsWith('olycity-livechat.json') ? configPath : null;
  } catch {
    return null;
  }
}

function readRaw(file, fsImpl = fs) {
  try { return JSON.parse(fsImpl.readFileSync(file, 'utf8')) || {}; } catch { return {}; }
}

/** État à afficher : { found, enabled, toggle, skip, labels }. */
function readLivechatKeys({ env, fsImpl = fs } = {}) {
  const file = findSettingsFile({ env, fsImpl });
  if (!file) return { found: false };
  const raw = readRaw(file, fsImpl);
  const skip = normalizeHotkey(raw.skipKey, DEFAULT_SKIP_KEY);
  let toggle = normalizeHotkey(raw.toggleKey, DEFAULT_TOGGLE_KEY);
  if (sameHotkey(skip, toggle)) toggle = null;
  return {
    found: true,
    enabled: raw.enabled !== false,
    toggle, skip,
    labels: { toggle: hotkeyLabel(toggle), skip: hotkeyLabel(skip) },
  };
}

/**
 * Change une touche (`action` : toggle | skip ; `key` : la touche, ou null
 * pour la retirer). Refuse une combinaison déjà prise par l'autre action.
 * Rend { ok } ou { error }.
 */
function writeLivechatKey(action, key, { env, fsImpl = fs } = {}) {
  const field = FIELDS[action];
  if (!field) return { error: 'Action inconnue.' };
  const file = findSettingsFile({ env, fsImpl });
  if (!file) return { error: 'OLYCITY Live introuvable sur ce PC (version 4.24.2 ou plus récente nécessaire).' };
  const value = key === null ? null : normalizeHotkey(key, undefined);
  if (value === undefined) return { error: 'Touche non utilisable.' };
  const current = readLivechatKeys({ env, fsImpl });
  const other = action === 'toggle' ? current.skip : current.toggle;
  if (value && sameHotkey(value, other)) return { error: `${hotkeyLabel(value)} sert déjà à l'autre action.` };
  const raw = readRaw(file, fsImpl);
  fsImpl.writeFileSync(file, `${JSON.stringify({ ...raw, [field]: value }, null, 2)}\n`, 'utf8');
  return { ok: true };
}

module.exports = {
  DEFAULT_SKIP_KEY, DEFAULT_TOGGLE_KEY, findSettingsFile, hotkeyLabel, keyFromKeyboardEvent, keyFromMouseEvent,
  normalizeHotkey, pointerPath, readLivechatKeys, sameHotkey, vkName, writeLivechatKey,
};
