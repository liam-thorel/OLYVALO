/**
 * Envois du site olycity.fr/livechat.
 *
 * Le fichier est stocké dans Cloudflare R2 (bucket `olycity-livechat-media`,
 * vidé automatiquement au bout d'un jour) et servi par ce Worker sur /m/<clé> :
 * jusqu'à 500 Mo, là où un webhook Discord plafonne à 10 Mo sans boost. Un
 * Worker gratuit refuse les requêtes de plus de 100 Mo : la page envoie donc
 * le fichier en morceaux (envoi multipart R2).
 *
 *   POST /upload/start      { type, size }            → { key, uploadId, partSize }
 *   PUT  /upload/part?key=&uploadId=&part=N  (morceau)  → { partNumber, etag }
 *   POST /upload/complete   { key, uploadId, parts }  → { key }
 *   POST /send              { fromName, text, mediaKey, size, … } → { ok, id }
 *   GET  /me                membre du roster reconnu derrière le jeton Discord
 *   GET  /m/<clé>           lecture publique, avec plages (Range)
 *
 * /send écrit l'élément dans livechat/queue, que les OLYCITY Live écoutent, et
 * annonce l'envoi dans le salon #livechat par webhook. Le bot ignore les
 * messages de webhook : sans cela, chaque envoi s'afficherait deux fois.
 *
 * Toute écriture exige la connexion Discord de la page (jeton OAuth2,
 * `Authorization: Bearer …`). Le Worker demande à Discord à qui il appartient
 * et le retrouve dans le roster : le nom et l'avatar affichés viennent de là,
 * jamais du navigateur, et un compte hors roster ne peut rien envoyer.
 */

const DEFAULT_FIREBASE = 'https://realtime-database-5bb9f-default-rtdb.europe-west1.firebasedatabase.app';
const DEFAULT_MEMBERS_URL = 'https://tracker.olycity.fr/data/members.json';
const DISCORD_API = 'https://discord.com/api/v10';
const IDENTITY_TTL_MS = 10 * 60 * 1000;
const ROSTER_TTL_MS = 10 * 60 * 1000;
const MAX_BYTES = 500 * 1024 * 1024;
// Sous la limite de 100 Mo par requête du plan gratuit, au-dessus du minimum
// de 5 Mo imposé par R2 à chaque morceau sauf le dernier.
const PART_SIZE = 50 * 1024 * 1024;
const MAX_TEXT_LENGTH = 220;
const SIZES = new Set(['grand', 'moyen', 'petit', 'custom']);
const SIZE_LABELS = { grand: 'grand', moyen: 'moyen', petit: 'petit', custom: 'perso' };
const MIN_INTERVAL_MS = 3000;
const EXTENSIONS = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/bmp': 'bmp',
  'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov',
};

// Le Live n'accepte que ces hôtes : l'avatar envoyé par le site doit en être.
const AVATAR_HOSTS = ['cdn.discordapp.com', 'media.discordapp.net'];

const lastActionByIp = new Map();
const identities = new Map();
let rosterCache = { members: null, at: 0 };

const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
});

export function siteOrigins(env) {
  const list = String(env?.SITE_ORIGIN || 'https://olycity.fr,https://tracker.olycity.fr')
    .split(',')
    .map(entry => entry.trim().replace(/\/$/, ''))
    .filter(Boolean);
  return list.length ? list : ['https://olycity.fr'];
}

function originAllowed(origin, env) {
  return siteOrigins(env).includes(origin) || /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin);
}

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  return {
    'Access-Control-Allow-Origin': originAllowed(origin, env) ? origin : siteOrigins(env)[0],
    'Access-Control-Allow-Methods': 'GET, HEAD, POST, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, Range',
    'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
    Vary: 'Origin',
  };
}

function clamp(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function allowedAvatar(url) {
  try {
    const parsed = new URL(String(url || ''));
    return parsed.protocol === 'https:' && AVATAR_HOSTS.includes(parsed.hostname) ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export function mediaKind(contentType) {
  const type = String(contentType || '').toLowerCase();
  if (type === 'image/gif') return 'gif';
  if (type.startsWith('image/')) return 'image';
  if (type.startsWith('video/')) return 'video';
  return null;
}

// ─── Identité ─────────────────────────────────────────────────────────

/** Le roster ne connaît l'identifiant Discord que par l'URL d'avatar. */
export function discordIdFromAvatar(url) {
  return String(url || '').match(/\/avatars\/(\d+)\//)?.[1] || null;
}

export function rosterMembers(list, overlay) {
  const members = new Map();
  (Array.isArray(list) ? list : []).forEach(m => {
    if (m?.id && m?.name) members.set(m.id, { id: m.id, name: m.name, avatar: m.avatar || null });
  });
  Object.entries(overlay || {}).forEach(([id, m]) => {
    if (!members.has(id) && m?.name) members.set(id, { id, name: m.name, avatar: m.avatar || null });
  });
  return [...members.values()].map(m => ({ ...m, discordId: discordIdFromAvatar(m.avatar) }));
}

async function loadRoster(env, now) {
  if (rosterCache.members && now - rosterCache.at < ROSTER_TTL_MS) return rosterCache.members;
  const firebase = String(env.FIREBASE_ROOT || DEFAULT_FIREBASE).replace(/\/$/, '');
  const [list, overlay] = await Promise.all([
    fetch(env.MEMBERS_URL || DEFAULT_MEMBERS_URL).then(r => (r.ok ? r.json() : [])).catch(() => []),
    fetch(`${firebase}/rosterOverlay/members.json`).then(r => (r.ok ? r.json() : null)).catch(() => null),
  ]);
  const members = rosterMembers(list, overlay);
  if (members.length) rosterCache = { members, at: now };
  return members.length ? members : rosterCache.members || [];
}

async function sha256(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Membre du roster derrière le jeton Discord de la requête, ou { error }.
 * Le résultat est gardé quelques minutes : un envoi de 500 Mo fait une
 * dizaine de requêtes, inutile d'interroger Discord à chacune.
 */
export async function authenticate(request, env, now = Date.now()) {
  const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return { error: 'Connecte-toi avec Discord.', status: 401 };
  const hash = await sha256(token);
  const cached = identities.get(hash);
  if (cached && now - cached.at < IDENTITY_TTL_MS) return cached.result;

  const res = await fetch(`${DISCORD_API}/users/@me`, { headers: { Authorization: `Bearer ${token}` } }).catch(() => null);
  if (!res) return { error: 'Discord injoignable, réessaie.', status: 502 };
  if (res.status === 401) return { error: 'Connexion Discord expirée, reconnecte-toi.', status: 401 };
  if (!res.ok) return { error: `Discord a refusé la vérification (HTTP ${res.status}).`, status: 502 };
  const user = await res.json();
  const member = (await loadRoster(env, now)).find(m => m.discordId === String(user.id));
  const result = member
    ? {
      member: {
        id: member.id,
        name: member.name,
        avatar: allowedAvatar(member.avatar)
          || (user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128` : null),
      },
    }
    : { error: 'Ton compte Discord ne fait pas partie du roster OLYCITY.', status: 403 };
  identities.set(hash, { result, at: now });
  if (identities.size > 500) identities.clear();
  return result;
}

/** Clés créées par /upload/start uniquement : pas de chemin, pas de « .. ». */
export function isValidKey(key = '') {
  return /^[a-z0-9]{6,40}\.(png|jpg|webp|gif|bmp|mp4|webm|mov)$/.test(String(key));
}

export function planUpload({ type, size } = {}, now = Date.now()) {
  const contentType = String(type || '').split(';')[0].trim().toLowerCase();
  const extension = EXTENSIONS[contentType];
  if (!extension) return { error: 'Format non pris en charge : PNG, JPEG, WebP, GIF, MP4, WebM ou MOV.' };
  const bytes = Number(size);
  if (!Number.isFinite(bytes) || bytes <= 0) return { error: 'Fichier vide.' };
  if (bytes > MAX_BYTES) return { error: 'Fichier trop lourd (500 Mo maximum).', status: 413 };
  const key = `${now.toString(36)}${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}.${extension}`;
  return { key, contentType, partSize: PART_SIZE, parts: Math.ceil(bytes / PART_SIZE) };
}

/**
 * Valide les champs d'un envoi (corps JSON de /send). Rend { error } ou les
 * champs propres de l'élément.
 */
export function parseSubmission(body = {}, member = null) {
  const text = String(body.text || '').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT_LENGTH);
  const mediaKey = body.mediaKey ? String(body.mediaKey) : null;
  if (mediaKey && !isValidKey(mediaKey)) return { error: 'Média introuvable.' };
  if (!mediaKey && !text) return { error: 'Il faut un média, un texte, ou les deux.' };

  if (!member?.name) return { error: 'Connecte-toi avec Discord.', status: 401 };
  const size = SIZES.has(body.size) ? body.size : 'moyen';
  let box = null;
  if (size === 'custom') {
    const raw = body.box && typeof body.box === 'object' ? body.box : {};
    box = {
      cx: clamp(raw.cx, 0, 1, 0.5),
      cy: clamp(raw.cy, 0, 1, 0.5),
      w: clamp(raw.w, 0.08, 1, 0.46),
      h: clamp(raw.h, 0.08, 1, 0.52),
    };
  }
  const duration = Number(body.durationMs);
  return {
    mediaKey,
    text,
    size,
    box,
    textPos: body.textPos === 'haut' ? 'haut' : 'bas',
    durationMs: Number.isFinite(duration) && duration > 0 ? clamp(duration, 2000, 30000, null) : null,
    muted: body.muted === true,
    target: String(body.target || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 48) || null,
    targetName: String(body.targetName || '').trim().slice(0, 40) || null,
    from: { name: String(member.name).slice(0, 40), avatar: allowedAvatar(member.avatar) },
  };
}

export function discordContent(submission, mediaUrl = null) {
  const details = [SIZE_LABELS[submission.size]];
  if (submission.targetName) details.push(`pour ${submission.targetName}`);
  const lines = [];
  if (submission.text) lines.push(submission.text);
  if (mediaUrl) lines.push(mediaUrl);
  lines.push(`-# 📺 envoyé depuis olycity.fr/livechat · ${details.join(' · ')}`);
  return lines.join('\n');
}

export function queueItem(submission, media, discordMessageId = null) {
  return {
    createdAt: { '.sv': 'timestamp' },
    source: 'site',
    from: submission.from,
    text: submission.text,
    media,
    size: submission.size,
    ...(submission.box ? { box: submission.box } : {}),
    textPos: submission.textPos,
    ...(submission.durationMs ? { durationMs: submission.durationMs } : {}),
    ...(submission.muted ? { muted: true } : {}),
    target: submission.target,
    ...(discordMessageId ? { discordMessageId } : {}),
  };
}

// L'annonce Discord n'est qu'un historique : son échec n'empêche pas
// l'affichage sur les écrans.
async function announceOnDiscord(env, submission, mediaUrl) {
  if (!env.DISCORD_WEBHOOK_URL) return null;
  try {
    const url = new URL(env.DISCORD_WEBHOOK_URL);
    url.searchParams.set('wait', 'true');
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: submission.from.name,
        avatar_url: submission.from.avatar || undefined,
        content: discordContent(submission, mediaUrl),
        allowed_mentions: { parse: [] },
      }),
    });
    return res.ok ? (await res.json())?.id || null : null;
  } catch {
    return null;
  }
}

function rateLimited(request, now, bucket) {
  const key = `${bucket}:${request.headers.get('CF-Connecting-IP') || 'local'}`;
  if (lastActionByIp.has(key) && now - lastActionByIp.get(key) < MIN_INTERVAL_MS) return true;
  lastActionByIp.set(key, now);
  if (lastActionByIp.size > 2000) lastActionByIp.clear();
  return false;
}

async function readJson(request) {
  try { return await request.json(); } catch { return null; }
}

async function serveMedia(request, env, key, cors) {
  if (!isValidKey(key)) return json({ error: 'Introuvable' }, 404, cors);
  const object = await env.MEDIA.get(key, { range: request.headers, onlyIf: request.headers });
  if (!object) return json({ error: 'Introuvable' }, 404, cors);
  const headers = new Headers(cors);
  object.writeHttpMetadata(headers);
  headers.set('ETag', object.httpEtag);
  headers.set('Accept-Ranges', 'bytes');
  headers.set('Cache-Control', 'public, max-age=86400');
  if (!('body' in object)) return new Response(null, { status: 304, headers });
  let status = 200;
  if (object.range && request.headers.has('Range')) {
    const offset = object.range.offset ?? 0;
    const length = object.range.length ?? object.size - offset;
    headers.set('Content-Range', `bytes ${offset}-${offset + length - 1}/${object.size}`);
    headers.set('Content-Length', String(length));
    status = 206;
  } else {
    headers.set('Content-Length', String(object.size));
  }
  return new Response(request.method === 'HEAD' ? null : object.body, { status, headers });
}

export async function handleRequest(request, env, { now = Date.now() } = {}) {
  const cors = corsHeaders(request, env);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  const url = new URL(request.url);

  const media = url.pathname.match(/^\/m\/([^/]+)$/);
  if (media && (request.method === 'GET' || request.method === 'HEAD')) return serveMedia(request, env, media[1], cors);

  // Tout le reste écrit : réservé au site, et aux membres connectés.
  if (!originAllowed(request.headers.get('Origin') || '', env)) return json({ error: 'Origine refusée' }, 403, cors);
  const identity = await authenticate(request, env, now);
  if (identity.error) return json({ error: identity.error }, identity.status, cors);

  // La page affiche le membre tel que le Worker le reconnaît.
  if (url.pathname === '/me' && request.method === 'GET') return json({ member: identity.member }, 200, cors);

  if (url.pathname === '/upload/start' && request.method === 'POST') {
    if (rateLimited(request, now, 'start')) return json({ error: 'Doucement : un envoi toutes les 3 secondes.' }, 429, cors);
    const plan = planUpload(await readJson(request) || {}, now);
    if (plan.error) return json({ error: plan.error }, plan.status || 400, cors);
    const upload = await env.MEDIA.createMultipartUpload(plan.key, { httpMetadata: { contentType: plan.contentType } });
    return json({ key: plan.key, uploadId: upload.uploadId, partSize: plan.partSize, parts: plan.parts }, 200, cors);
  }

  if (url.pathname === '/upload/part' && request.method === 'PUT') {
    const key = url.searchParams.get('key') || '';
    const part = Number(url.searchParams.get('part'));
    const uploadId = url.searchParams.get('uploadId') || '';
    if (!isValidKey(key) || !uploadId || !Number.isInteger(part) || part < 1 || part > Math.ceil(MAX_BYTES / PART_SIZE)) {
      return json({ error: 'Morceau invalide.' }, 400, cors);
    }
    if (Number(request.headers.get('Content-Length') || 0) > PART_SIZE) return json({ error: 'Morceau trop gros.' }, 413, cors);
    try {
      const uploaded = await env.MEDIA.resumeMultipartUpload(key, uploadId).uploadPart(part, request.body);
      return json({ partNumber: uploaded.partNumber, etag: uploaded.etag }, 200, cors);
    } catch (error) {
      return json({ error: `Envoi interrompu : ${error.message}` }, 502, cors);
    }
  }

  if (url.pathname === '/upload/complete' && request.method === 'POST') {
    const body = await readJson(request) || {};
    const parts = Array.isArray(body.parts) ? body.parts : [];
    if (!isValidKey(body.key) || !body.uploadId || !parts.length) return json({ error: 'Envoi incomplet.' }, 400, cors);
    try {
      const object = await env.MEDIA.resumeMultipartUpload(body.key, String(body.uploadId))
        .complete(parts.map(p => ({ partNumber: Number(p.partNumber), etag: String(p.etag) })));
      if (object.size > MAX_BYTES) {
        await env.MEDIA.delete(body.key);
        return json({ error: 'Fichier trop lourd (500 Mo maximum).' }, 413, cors);
      }
      return json({ key: body.key }, 200, cors);
    } catch (error) {
      return json({ error: `Envoi inachevé : ${error.message}` }, 502, cors);
    }
  }

  if (url.pathname === '/send' && request.method === 'POST') {
    if (rateLimited(request, now, 'send')) return json({ error: 'Doucement : un envoi toutes les 3 secondes.' }, 429, cors);
    const submission = parseSubmission(await readJson(request) || {}, identity.member);
    if (submission.error) return json({ error: submission.error }, submission.status || 400, cors);

    let mediaInfo = null;
    let mediaUrl = null;
    if (submission.mediaKey) {
      const head = await env.MEDIA.head(submission.mediaKey);
      const kind = mediaKind(head?.httpMetadata?.contentType);
      if (!head || !kind) return json({ error: 'Média introuvable, renvoie-le.' }, 404, cors);
      mediaUrl = `${url.origin}/m/${submission.mediaKey}`;
      mediaInfo = { url: mediaUrl, kind };
    }

    const discordMessageId = await announceOnDiscord(env, submission, mediaUrl);
    const firebase = String(env.FIREBASE_ROOT || DEFAULT_FIREBASE).replace(/\/$/, '');
    const res = await fetch(`${firebase}/livechat/queue.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(queueItem(submission, mediaInfo, discordMessageId)),
    });
    if (!res.ok) return json({ error: `Firebase a refusé l’envoi (HTTP ${res.status}).` }, 502, cors);
    const { name } = await res.json();
    return json({ ok: true, id: name }, 200, cors);
  }

  return json({ error: 'Introuvable' }, 404, cors);
}

export default {
  fetch(request, env) {
    return handleRequest(request, env);
  },
};
