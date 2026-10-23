/**
 * Livechat : des images, GIF, vidéos et textes postés sur Discord (#livechat,
 * /livechat) ou sur olycity.fr/livechat s'affichent par-dessus l'écran des
 * membres. Le bot et le Worker du site écrivent dans livechat/queue ; chaque
 * OLYCITY Live écoute ce nœud et affiche ce qui le concerne.
 *
 * Ici, uniquement la logique pure : validation d'un élément de la file, choix
 * de la zone d'écran, durée d'affichage. Le flux Firebase et la fenêtre sont
 * dans livechat.js et livechat-host.cs.
 */

const LIVECHAT_QUEUE_PATH = 'livechat/queue';
const LIVECHAT_RECEIVERS_PATH = 'livechat/receivers';

// Au-delà, un élément est considéré comme raté : on ne fait pas surgir un
// mème de la veille au démarrage du PC.
const MAX_ITEM_AGE_MS = 90 * 1000;
const MAX_TEXT_LENGTH = 220;
const MAX_MEDIA_BYTES = 500 * 1024 * 1024;

// Les médias ne sont téléchargés que depuis ces hôtes : les pièces jointes
// Discord (le site passe aussi par Discord) et les GIF intégrés par Discord.
// Firebase est ouvert en écriture, une URL arbitraire ferait télécharger
// n'importe quoi à tous les PC du groupe.
const MEDIA_HOSTS = [
  'cdn.discordapp.com',
  'media.discordapp.net',
  'media.tenor.com',
  'c.tenor.com',
  'media.giphy.com',
  'i.giphy.com',
  'i.imgur.com',
  // Envois du site (Worker workers/livechat, stockage R2).
  'olycity-livechat.olycity.workers.dev',
];

// Zone maximale occupée par le média, en fraction de l'écran : centre (cx, cy)
// et taille (w, h). Le média garde ses proportions à l'intérieur.
const SIZE_PRESETS = {
  grand: { cx: 0.5, cy: 0.47, w: 0.72, h: 0.8 },
  moyen: { cx: 0.5, cy: 0.42, w: 0.46, h: 0.52 },
  petit: { cx: 0.83, cy: 0.24, w: 0.27, h: 0.3 },
};

const KINDS = new Set(['image', 'gif', 'video']);

// Un extrait vidéo choisi sur le site : début et fin en millisecondes.
const MAX_TRIM_MS = 60 * 60 * 1000;
const MIN_CLIP_MS = 300;

function normalizeTrim(trim, kind) {
  if (kind !== 'video' || !trim || typeof trim !== 'object') return null;
  const startMs = Math.round(Number(trim.startMs));
  const endMs = Math.round(Number(trim.endMs));
  if (!Number.isFinite(startMs) || startMs < 0 || startMs > MAX_TRIM_MS) return null;
  if (!Number.isFinite(endMs) || endMs - startMs < MIN_CLIP_MS || endMs > MAX_TRIM_MS) return null;
  return { startMs, endMs };
}

function clamp(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function isAllowedMediaUrl(url) {
  let parsed;
  try { parsed = new URL(String(url || '')); } catch { return false; }
  if (parsed.protocol !== 'https:') return false;
  const host = parsed.hostname.toLowerCase();
  return MEDIA_HOSTS.some(allowed => host === allowed || host.endsWith(`.${allowed}`));
}

function mediaKind(kind, url = '') {
  const declared = String(kind || '').toLowerCase();
  if (KINDS.has(declared)) return declared;
  const pathname = (() => { try { return new URL(url).pathname.toLowerCase(); } catch { return ''; } })();
  if (/\.gif$/.test(pathname)) return 'gif';
  if (/\.(mp4|webm|mov|m4v)$/.test(pathname)) return 'video';
  return 'image';
}

/**
 * Zone d'écran d'un élément. Le site peut fournir une boîte libre (centre et
 * largeur) ; elle est bornée pour rester entièrement visible.
 */
function layoutFor(size, box) {
  if (size === 'custom' && box && typeof box === 'object') {
    const w = clamp(box.w, 0.05, 1, 0.46);
    const h = clamp(box.h, 0.04, 1, Math.min(0.95, w * 1.6));
    return {
      w,
      h,
      cx: clamp(box.cx, w / 2, 1 - w / 2, 0.5),
      cy: clamp(box.cy, h / 2, 1 - h / 2, 0.5),
    };
  }
  return { ...(SIZE_PRESETS[size] || SIZE_PRESETS.moyen) };
}

/**
 * Valide un élément brut de livechat/queue. Retourne null s'il n'y a rien
 * d'affichable. Ne fait confiance à aucun champ : n'importe qui peut écrire
 * dans Firebase.
 */
function normalizeItem(id, raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const text = String(raw.text || '').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT_LENGTH);
  let media = null;
  if (raw.media && typeof raw.media === 'object' && isAllowedMediaUrl(raw.media.url)) {
    media = { url: String(raw.media.url), kind: mediaKind(raw.media.kind, raw.media.url) };
  }
  if (!media && !text) return null;

  const size = ['grand', 'moyen', 'petit', 'custom'].includes(raw.size) ? raw.size : 'moyen';
  const from = raw.from && typeof raw.from === 'object' ? raw.from : {};
  const avatar = isAllowedMediaUrl(from.avatar) ? String(from.avatar) : null;
  const target = String(raw.target || '').trim() || null;

  return {
    id: String(id),
    createdAt: Number(raw.createdAt) || 0,
    source: raw.source === 'site' ? 'site' : 'discord',
    // Identifiant roster de l'expéditeur : un envoi ciblé s'affiche aussi chez lui.
    from: { id: String(from.id || '').trim() || null, name: String(from.name || 'Anonyme').slice(0, 40), avatar },
    text,
    media,
    size,
    layout: layoutFor(size, raw.box),
    textPos: raw.textPos === 'haut' ? 'haut' : 'bas',
    durationMs: raw.durationMs == null ? null : clamp(raw.durationMs, 2000, 30000, null),
    muted: raw.muted === true,
    trim: normalizeTrim(raw.trim, media?.kind),
    target,
  };
}

/**
 * Durée d'affichage d'une image ou d'un texte. Une vidéo, elle, se joue
 * jusqu'au bout dans la limite de maxVideoMs (décidé par la fenêtre, qui seule
 * connaît sa durée réelle).
 */
function displayDurationMs(item) {
  if (item.durationMs) return item.durationMs;
  if (!item.media) return Math.min(10000, 3500 + item.text.length * 60);
  const base = item.size === 'grand' ? 8000 : item.size === 'petit' ? 6000 : 7000;
  return item.text.length > 80 ? base + 2000 : base;
}

/**
 * Faut-il afficher cet élément sur ce PC ? `startedAt` est l'instant où le
 * flux a été ouvert : ce qui était déjà dans la file à ce moment a été affiché
 * (ou raté) avant, sauf s'il est tout récent — un redémarrage du script ne
 * doit pas faire perdre ce qui vient d'être posté.
 */
function shouldDisplay(item, { memberId = '', now = Date.now(), seen = new Set(), enabled = true } = {}) {
  if (!item || !enabled || seen.has(item.id)) return false;
  // Un envoi ciblé s'affiche chez son destinataire, et chez celui qui l'envoie
  // pour qu'il voie ce qu'il a fait apparaître.
  if (item.target && item.target !== memberId && item.from.id !== memberId) return false;
  // Horloges du PC et de Firebase pas forcément d'accord : on tolère un écart.
  return item.createdAt > 0 && now - item.createdAt <= MAX_ITEM_AGE_MS && item.createdAt - now <= MAX_ITEM_AGE_MS;
}

/**
 * Réglages propres au poste (olycity-livechat.json, hors manifeste pour
 * survivre aux mises à jour). Activé par défaut : c'est tout l'intérêt.
 */
function parseLiveChatConfig(raw) {
  let parsed = {};
  try { parsed = JSON.parse(String(raw || '{}')) || {}; } catch { parsed = {}; }
  return {
    enabled: parsed.enabled !== false,
    volume: Math.round(clamp(parsed.volume, 0, 100, 60)),
    maxVideoSeconds: Math.round(clamp(parsed.maxVideoSeconds, 5, 120, 30)),
  };
}

/**
 * Lecteur de flux SSE Firebase : accumule les morceaux reçus et rend les
 * évènements complets ({ event, data }) au fur et à mesure.
 */
function createSseParser(onEvent) {
  let buffer = '';
  return chunk => {
    buffer += String(chunk).replace(/\r\n/g, '\n');
    let end;
    while ((end = buffer.indexOf('\n\n')) !== -1) {
      const block = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      let event = 'message';
      const data = [];
      block.split('\n').forEach(line => {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
      });
      let payload = null;
      try { payload = JSON.parse(data.join('\n')); } catch { payload = null; }
      onEvent({ event, data: payload });
    }
  };
}

/**
 * Applique un évènement put/patch Firebase à la copie locale de la file et
 * rend les identifiants d'éléments ajoutés ou modifiés.
 */
function applyQueueEvent(queue, event, data) {
  if (!data || typeof data !== 'object') return [];
  const segments = String(data.path || '/').split('/').filter(Boolean);
  if (event === 'put' && segments.length === 0) {
    Object.keys(queue).forEach(key => delete queue[key]);
    Object.assign(queue, data.data && typeof data.data === 'object' ? data.data : {});
    return Object.keys(queue);
  }
  if (event === 'patch' && segments.length === 0) {
    const changed = [];
    Object.entries(data.data || {}).forEach(([key, value]) => {
      if (value === null) delete queue[key];
      else { queue[key] = value; changed.push(key); }
    });
    return changed;
  }
  if (event !== 'put' && event !== 'patch') return [];
  const [key, ...rest] = segments;
  if (rest.length === 0) {
    if (data.data === null) { delete queue[key]; return []; }
    queue[key] = event === 'patch' ? { ...(queue[key] || {}), ...data.data } : data.data;
    return [key];
  }
  // Modification profonde (rare) : on fusionne dans l'élément existant.
  const item = queue[key] && typeof queue[key] === 'object' ? queue[key] : (queue[key] = {});
  let cursor = item;
  rest.slice(0, -1).forEach(segment => {
    if (!cursor[segment] || typeof cursor[segment] !== 'object') cursor[segment] = {};
    cursor = cursor[segment];
  });
  cursor[rest[rest.length - 1]] = data.data;
  return [key];
}

module.exports = {
  LIVECHAT_QUEUE_PATH,
  LIVECHAT_RECEIVERS_PATH,
  MAX_ITEM_AGE_MS,
  MAX_MEDIA_BYTES,
  MEDIA_HOSTS,
  SIZE_PRESETS,
  applyQueueEvent,
  createSseParser,
  displayDurationMs,
  isAllowedMediaUrl,
  layoutFor,
  mediaKind,
  normalizeItem,
  normalizeTrim,
  parseLiveChatConfig,
  shouldDisplay,
};
