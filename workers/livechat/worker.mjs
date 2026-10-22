/**
 * Envois du site olycity.fr/livechat.
 *
 * Le navigateur ne peut pas héberger un fichier : le Worker le poste dans le
 * salon #livechat via un webhook Discord (l'historique reste au même endroit
 * que les envois faits depuis Discord), récupère l'URL de la pièce jointe et
 * écrit l'élément dans livechat/queue, que les OLYCITY Live écoutent.
 *
 * Le bot ignore les messages de webhook : sans cela, chaque envoi du site
 * s'afficherait deux fois.
 */

const DEFAULT_FIREBASE = 'https://realtime-database-5bb9f-default-rtdb.europe-west1.firebasedatabase.app';
// Limite d'envoi d'un serveur Discord sans boost. Avec des boosts, elle monte
// (50 Mo au niveau 2) : MAX_UPLOAD_MB permet de suivre.
const DEFAULT_MAX_UPLOAD_MB = 10;
const MAX_TEXT_LENGTH = 220;
const SIZES = new Set(['grand', 'moyen', 'petit', 'custom']);
const SIZE_LABELS = { grand: 'grand', moyen: 'moyen', petit: 'petit', custom: 'perso' };
const MIN_INTERVAL_MS = 3000;

// Le Live n'accepte que ces hôtes : l'avatar envoyé par le site doit en être.
const MEDIA_HOSTS = ['cdn.discordapp.com', 'media.discordapp.net'];

const lastSendByIp = new Map();

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
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
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
    return parsed.protocol === 'https:' && MEDIA_HOSTS.includes(parsed.hostname) ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export function mediaKind(contentType, name = '') {
  const type = String(contentType || '').toLowerCase();
  const lower = String(name).toLowerCase();
  if (type === 'image/gif' || lower.endsWith('.gif')) return 'gif';
  if (type.startsWith('image/')) return 'image';
  if (type.startsWith('video/')) return 'video';
  return null;
}

/**
 * Lit et valide le formulaire envoyé par la page. Rend { error } ou les
 * champs propres de l'élément.
 */
export function parseSubmission(form, { maxBytes = DEFAULT_MAX_UPLOAD_MB * 1024 * 1024 } = {}) {
  const text = String(form.get('text') || '').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT_LENGTH);
  const file = form.get('file');
  const hasFile = file && typeof file === 'object' && Number(file.size) > 0;
  if (!hasFile && !text) return { error: 'Il faut un média, un texte, ou les deux.' };
  let kind = null;
  if (hasFile) {
    kind = mediaKind(file.type, file.name);
    if (!kind) return { error: 'Seules les images, les GIF et les vidéos peuvent s’afficher.' };
    if (file.size > maxBytes) return { error: `Fichier trop lourd (${Math.round(maxBytes / 1024 / 1024)} Mo maximum).`, status: 413 };
  }

  const fromName = String(form.get('fromName') || '').trim().slice(0, 40);
  if (!fromName) return { error: 'Choisis ton profil avant d’envoyer.' };
  const size = SIZES.has(form.get('size')) ? form.get('size') : 'moyen';
  let box = null;
  if (size === 'custom') {
    try {
      const raw = JSON.parse(String(form.get('box') || '{}'));
      box = {
        cx: clamp(raw.cx, 0, 1, 0.5),
        cy: clamp(raw.cy, 0, 1, 0.5),
        w: clamp(raw.w, 0.08, 1, 0.46),
        h: clamp(raw.h, 0.08, 1, 0.52),
      };
    } catch {
      return { error: 'Position personnalisée illisible.' };
    }
  }
  const duration = Number(form.get('durationMs'));
  return {
    file: hasFile ? file : null,
    kind,
    text,
    size,
    box,
    textPos: form.get('textPos') === 'haut' ? 'haut' : 'bas',
    durationMs: Number.isFinite(duration) && duration > 0 ? clamp(duration, 2000, 30000, null) : null,
    muted: form.get('muted') === '1',
    target: String(form.get('target') || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 48) || null,
    targetName: String(form.get('targetName') || '').trim().slice(0, 40) || null,
    from: { name: fromName, avatar: allowedAvatar(form.get('fromAvatar')) },
  };
}

export function discordContent(submission) {
  const details = [SIZE_LABELS[submission.size]];
  if (submission.targetName) details.push(`pour ${submission.targetName}`);
  const caption = submission.text ? `${submission.text}\n` : '';
  return `${caption}-# 📺 envoyé depuis olycity.fr/livechat · ${details.join(' · ')}`;
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

async function postToDiscord(env, submission) {
  const url = new URL(env.DISCORD_WEBHOOK_URL);
  url.searchParams.set('wait', 'true');
  const payload = {
    username: submission.from.name,
    avatar_url: submission.from.avatar || undefined,
    content: discordContent(submission),
    allowed_mentions: { parse: [] },
  };
  const body = new FormData();
  body.set('payload_json', JSON.stringify(payload));
  if (submission.file) body.set('files[0]', submission.file, submission.file.name || 'media');
  const res = await fetch(url, { method: 'POST', body });
  if (res.status === 413) throw Object.assign(new Error('Fichier trop lourd pour Discord.'), { status: 413 });
  if (!res.ok) throw new Error(`Discord a refusé l’envoi (HTTP ${res.status}).`);
  return res.json();
}

export async function handleRequest(request, env, { now = Date.now() } = {}) {
  const cors = corsHeaders(request, env);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  const { pathname } = new URL(request.url);
  if (request.method !== 'POST' || pathname !== '/send') return json({ error: 'Introuvable' }, 404, cors);
  if (!originAllowed(request.headers.get('Origin') || '', env)) return json({ error: 'Origine refusée' }, 403, cors);
  if (!env.DISCORD_WEBHOOK_URL) return json({ error: 'Livechat pas encore configuré (webhook manquant).' }, 503, cors);

  const ip = request.headers.get('CF-Connecting-IP') || 'local';
  if (lastSendByIp.has(ip) && now - lastSendByIp.get(ip) < MIN_INTERVAL_MS) return json({ error: 'Doucement : un envoi toutes les 3 secondes.' }, 429, cors);

  let form;
  try { form = await request.formData(); } catch { return json({ error: 'Formulaire illisible.' }, 400, cors); }
  const maxBytes = clamp(env.MAX_UPLOAD_MB, 1, 500, DEFAULT_MAX_UPLOAD_MB) * 1024 * 1024;
  const submission = parseSubmission(form, { maxBytes });
  if (submission.error) return json({ error: submission.error }, submission.status || 400, cors);
  lastSendByIp.set(ip, now);
  if (lastSendByIp.size > 1000) lastSendByIp.clear();

  let message;
  try {
    message = await postToDiscord(env, submission);
  } catch (error) {
    return json({ error: error.message }, error.status || 502, cors);
  }

  let media = null;
  if (submission.file) {
    const attachment = message?.attachments?.[0];
    if (!attachment?.url) return json({ error: 'Discord n’a pas renvoyé le fichier.' }, 502, cors);
    media = { url: attachment.url, kind: mediaKind(attachment.content_type, attachment.filename) || submission.kind };
  }

  const firebase = String(env.FIREBASE_ROOT || DEFAULT_FIREBASE).replace(/\/$/, '');
  const res = await fetch(`${firebase}/livechat/queue.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(queueItem(submission, media, message?.id || null)),
  });
  if (!res.ok) return json({ error: `Firebase a refusé l’envoi (HTTP ${res.status}).` }, 502, cors);
  const { name } = await res.json();
  return json({ ok: true, id: name }, 200, cors);
}

export default {
  fetch(request, env) {
    return handleRequest(request, env);
  },
};
