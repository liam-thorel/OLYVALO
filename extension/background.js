/**
 * OLYCITY Livechat — service worker de l'extension.
 *
 * Tout ce qui sort de l'extension passe par ici : la connexion Discord
 * (application OLYBOT, même compte que sur le site et le bot), les appels au
 * Worker livechat, et le téléversement d'une vidéo « fichier » trouvée sur une
 * page. Le script de page (content.js) ne fait qu'afficher le logo et le
 * panneau, et demande le reste par messages.
 */
importScripts('video-links.js');

const DISCORD_CLIENT_ID = '1281505908224168027'; // application OLYBOT
const WORKER = 'https://olycity-livechat.olycity.workers.dev';
const FIREBASE = 'https://realtime-database-5bb9f-default-rtdb.europe-west1.firebasedatabase.app';
const MEMBERS_URL = 'https://tracker.olycity.fr/data/members.json';
const TOKEN_KEY = 'discordToken';
const MAX_BYTES = 500 * 1024 * 1024;
const RECEIVER_FRESH_MS = 5 * 60 * 1000;

let accountCache = { value: undefined, at: 0 };

// ─── Connexion Discord ──────────────────────────────────────────────────────

async function storedToken() {
  const { [TOKEN_KEY]: saved } = await chrome.storage.local.get(TOKEN_KEY);
  return saved && saved.expiresAt > Date.now() ? saved.token : null;
}

/**
 * Flux OAuth2 implicite dans une fenêtre Discord ouverte par le navigateur.
 * L'adresse de retour (https://<id>.chromiumapp.org/) doit être déclarée sur
 * le portail Discord, application OLYBOT → OAuth2 → Redirects.
 */
async function login() {
  const state = crypto.randomUUID();
  const url = new URL('https://discord.com/oauth2/authorize');
  url.search = new URLSearchParams({
    client_id: DISCORD_CLIENT_ID, response_type: 'token', scope: 'identify',
    redirect_uri: chrome.identity.getRedirectURL(), state, prompt: 'none',
  }).toString();
  const returned = await chrome.identity.launchWebAuthFlow({ url: url.toString(), interactive: true });
  const params = new URLSearchParams(new URL(returned).hash.slice(1));
  if (params.get('error')) throw new Error('Connexion Discord annulée.');
  if (params.get('state') !== state || !params.get('access_token')) throw new Error('Connexion Discord refusée, réessaie.');
  await chrome.storage.local.set({
    [TOKEN_KEY]: {
      token: params.get('access_token'),
      expiresAt: Date.now() + Number(params.get('expires_in') || 3600) * 1000 - 60000,
    },
  });
  accountCache = { value: undefined, at: 0 };
  return account(true);
}

async function logout() {
  await chrome.storage.local.remove(TOKEN_KEY);
  accountCache = { value: null, at: Date.now() };
  return null;
}

async function api(path, options = {}) {
  const token = await storedToken();
  if (!token) throw Object.assign(new Error('Connecte-toi avec Discord.'), { status: 401 });
  const res = await fetch(`${WORKER}${path}`, {
    ...options,
    headers: { ...(options.headers || {}), Authorization: `Bearer ${token}` },
  }).catch(() => null);
  if (!res) throw new Error('Serveur livechat injoignable.');
  const body = await res.json().catch(() => ({}));
  if (res.status === 401) { await chrome.storage.local.remove(TOKEN_KEY); accountCache = { value: null, at: Date.now() }; }
  if (!res.ok) throw Object.assign(new Error(body.error || `Erreur ${res.status}`), { status: res.status });
  return body;
}

/** Membre connecté ({ member, admin }) ou null. Gardé une minute. */
async function account(force = false) {
  if (!force && accountCache.value !== undefined && Date.now() - accountCache.at < 60000) return accountCache.value;
  if (!await storedToken()) { accountCache = { value: null, at: Date.now() }; return null; }
  try {
    const body = await api('/me');
    accountCache = { value: { member: body.member, admin: body.admin === true }, at: Date.now() };
  } catch (error) {
    if (error.status === 401 || error.status === 403) accountCache = { value: null, at: Date.now() };
    else throw error;
  }
  return accountCache.value;
}

// ─── Destinataires ──────────────────────────────────────────────────────────

/** Membres du roster, avec ceux dont le Live est en ligne et accepte le livechat. */
async function targets() {
  const [list, overlay, receivers] = await Promise.all([
    fetch(MEMBERS_URL).then(r => (r.ok ? r.json() : [])).catch(() => []),
    fetch(`${FIREBASE}/rosterOverlay/members.json`).then(r => r.json()).catch(() => null),
    fetch(`${FIREBASE}/livechat/receivers.json`).then(r => r.json()).catch(() => null),
  ]);
  const members = new Map((Array.isArray(list) ? list : []).map(m => [m.id, m.name]));
  if (overlay && !Array.isArray(overlay)) {
    Object.entries(overlay).forEach(([id, m]) => { if (!members.has(id) && m?.name) members.set(id, m.name); });
  }
  const now = Date.now();
  return [...members.entries()]
    .map(([id, name]) => {
      const receiver = receivers?.[id];
      const fresh = receiver && now - Number(receiver.ts || 0) <= RECEIVER_FRESH_MS;
      return { id, name, online: Boolean(fresh && receiver.enabled !== false), muted: Boolean(fresh && receiver.enabled === false) };
    })
    .sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name, 'fr'));
}

// ─── Envoi ──────────────────────────────────────────────────────────────────

/**
 * Vidéo « fichier » d'une page qui n'est pas un site connu : téléchargée par
 * l'extension puis déposée sur le Worker, comme un envoi depuis le site. Les
 * Live ne contactent ainsi que le Worker, jamais le site d'origine.
 */
async function uploadFromUrl(fileUrl, onProgress) {
  const res = await fetch(fileUrl, { credentials: 'include' }).catch(() => null);
  if (!res?.ok) throw new Error('Vidéo inaccessible depuis l’extension.');
  const type = String(res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const declared = Number(res.headers.get('content-length') || 0);
  if (declared > MAX_BYTES) throw new Error('Vidéo trop lourde (500 Mo maximum).');
  const blob = await res.blob();
  if (blob.size > MAX_BYTES) throw new Error('Vidéo trop lourde (500 Mo maximum).');
  const contentType = ['video/mp4', 'video/webm', 'video/quicktime'].includes(type) ? type : 'video/mp4';

  const plan = await api('/upload/start', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: contentType, size: blob.size }),
  });
  const parts = [];
  for (let index = 0, offset = 0; offset < blob.size; index += 1, offset += plan.partSize) {
    const chunk = blob.slice(offset, Math.min(blob.size, offset + plan.partSize));
    const query = new URLSearchParams({ key: plan.key, uploadId: plan.uploadId, part: String(index + 1) });
    parts.push(await api(`/upload/part?${query}`, { method: 'PUT', body: chunk }));
    onProgress?.(Math.min(1, (offset + chunk.size) / blob.size));
  }
  await api('/upload/complete', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: plan.key, uploadId: plan.uploadId, parts }),
  });
  return plan.key;
}

async function send(payload, tabId) {
  const body = {
    text: String(payload.text || '').slice(0, 220),
    size: ['grand', 'moyen', 'petit'].includes(payload.size) ? payload.size : 'moyen',
    target: payload.target || null,
    targetName: payload.targetName || null,
    muted: payload.muted === true,
    trim: payload.trim || null,
    via: 'extension',
  };
  if (payload.link) {
    const link = self.OlyVideoLinks.normalizeVideoLink(payload.link);
    if (!link) throw new Error('Ce lien n’est pas pris en charge.');
    body.link = link.url;
  } else if (payload.fileUrl) {
    body.mediaKey = await uploadFromUrl(payload.fileUrl, progress => {
      if (tabId != null) chrome.tabs.sendMessage(tabId, { type: 'upload-progress', progress }).catch(() => {});
    });
  }
  return api('/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

async function reenable(target) {
  return api('/control', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ target: target || 'all' }) });
}

// ─── Messages du script de page et de la fenêtre de l'extension ─────────────

const HANDLERS = {
  account: () => account(),
  login: () => login(),
  logout: () => logout(),
  targets: () => targets(),
  send: (message, sender) => send(message.payload || {}, sender.tab?.id),
  reenable: message => reenable(message.target),
};

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  const handler = HANDLERS[message?.type];
  if (!handler) return false;
  Promise.resolve(handler(message, sender))
    .then(result => reply({ ok: true, result }))
    .catch(error => reply({ ok: false, error: error.message || String(error) }));
  return true; // réponse asynchrone
});
