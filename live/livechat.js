/**
 * Livechat côté poste : écoute livechat/queue (flux Firebase), télécharge les
 * médias et les fait afficher, un par un, par la fenêtre native livechat-host.
 *
 * La fenêtre est un petit programme WPF compilé sur place par le csc.exe du
 * .NET Framework fourni avec Windows : aucun binaire à distribuer, ~25 Ko, et
 * rien ne tourne tant que personne ne poste. Elle est lancée au premier
 * élément puis fermée après quelques minutes d'inactivité.
 */
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');
const {
  LIVECHAT_QUEUE_PATH,
  LIVECHAT_RECEIVERS_PATH,
  MAX_MEDIA_BYTES,
  applyQueueEvent,
  displayDurationMs,
  isAllowedMediaUrl,
  normalizeItem,
  parseLiveChatConfig,
  shouldDisplay,
} = require('./livechat-utils.js');
const { openFirebaseStream } = require('./firebase-stream.js');

const CONFIG_FILENAME = 'olycity-livechat.json';
const HOST_SOURCE = 'livechat-host.cs';
const HOST_IDLE_MS = 3 * 60 * 1000;
const HEARTBEAT_MS = 2 * 60 * 1000;
const MAX_PENDING = 12;
const DOWNLOAD_TIMEOUT_MS = 25 * 1000;

function frameworkDir() {
  const windir = process.env.WINDIR || process.env.SystemRoot || 'C:\\Windows';
  const candidates = ['Framework64', 'Framework'].map(name => path.join(windir, 'Microsoft.NET', name, 'v4.0.30319'));
  return candidates.find(dir => fs.existsSync(path.join(dir, 'csc.exe'))) || null;
}

function cacheDir() {
  const base = process.env.LOCALAPPDATA || os.tmpdir();
  return path.join(base, 'OLYCITY', 'livechat');
}

function extensionFor(contentType, url) {
  const type = String(contentType || '').toLowerCase();
  if (type.includes('gif')) return '.gif';
  if (type.includes('png')) return '.png';
  if (type.includes('webp')) return '.webp';
  if (type.includes('jpeg') || type.includes('jpg')) return '.jpg';
  if (type.includes('mp4')) return '.mp4';
  if (type.includes('webm')) return '.webm';
  if (type.includes('quicktime')) return '.mov';
  try {
    const ext = path.extname(new URL(url).pathname).toLowerCase();
    if (/^\.[a-z0-9]{2,5}$/.test(ext)) return ext;
  } catch { /* extension par défaut */ }
  return '.bin';
}

// Téléchargement borné : hôte autorisé à chaque redirection, taille et durée
// maximales. Rend { file, contentType }.
function download(url, dir, name, redirects = 3) {
  return new Promise((resolve, reject) => {
    if (!isAllowedMediaUrl(url)) { reject(new Error('hôte non autorisé')); return; }
    const request = https.get(url, { timeout: DOWNLOAD_TIMEOUT_MS, headers: { 'User-Agent': 'OLYCITY-Live' } }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects > 0) {
        res.resume();
        download(new URL(res.headers.location, url).toString(), dir, name, redirects - 1).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) { res.resume(); reject(new Error(`HTTP ${res.statusCode}`)); return; }
      if (Number(res.headers['content-length']) > MAX_MEDIA_BYTES) { res.destroy(); reject(new Error('fichier trop lourd')); return; }
      const contentType = String(res.headers['content-type'] || '');
      const file = path.join(dir, `${name}${extensionFor(contentType, url)}`);
      const out = fs.createWriteStream(file);
      let received = 0;
      res.on('data', chunk => {
        received += chunk.length;
        if (received > MAX_MEDIA_BYTES) { res.destroy(new Error('fichier trop lourd')); }
      });
      res.on('error', error => { out.destroy(); fs.rm(file, { force: true }, () => {}); reject(error); });
      out.on('error', reject);
      out.on('finish', () => resolve({ file, contentType }));
      res.pipe(out);
    });
    request.on('timeout', () => request.destroy(new Error('délai dépassé')));
    request.on('error', reject);
  });
}

/**
 * Ce que la fenêtre doit afficher, d'après la déclaration et le fichier
 * réellement reçu : un « GIF » Tenor est en fait une vidéo MP4 à boucler.
 */
function hostKind(item, contentType, file) {
  const type = String(contentType || '').toLowerCase();
  const ext = path.extname(file || '').toLowerCase();
  const isVideo = type.startsWith('video/') || ['.mp4', '.webm', '.mov', '.m4v'].includes(ext);
  if (isVideo) return { kind: 'video', loop: item.media.kind === 'gif' };
  if (type.includes('gif') || ext === '.gif') return { kind: 'gif', loop: false };
  return { kind: 'image', loop: false };
}

async function compileHost(log = () => {}) {
  const source = fs.readFileSync(path.join(__dirname, HOST_SOURCE));
  const hash = crypto.createHash('sha1').update(source).digest('hex').slice(0, 12);
  const exe = path.join(cacheDir(), `livechat-host-${hash}.exe`);
  if (fs.existsSync(exe)) return exe;
  const fw = frameworkDir();
  if (!fw) throw new Error('.NET Framework 4 introuvable');
  fs.mkdirSync(cacheDir(), { recursive: true });
  const refs = [
    path.join(fw, 'WPF', 'PresentationFramework.dll'),
    path.join(fw, 'WPF', 'PresentationCore.dll'),
    path.join(fw, 'WPF', 'WindowsBase.dll'),
    path.join(fw, 'System.Xaml.dll'),
    'System.Drawing.dll',
    'System.Web.Extensions.dll',
  ];
  const tmp = `${exe}.tmp`;
  await new Promise((resolve, reject) => {
    execFile(path.join(fw, 'csc.exe'), [
      '-nologo', '-target:winexe', '-optimize+', `-out:${tmp}`,
      ...refs.map(ref => `-r:${ref}`),
      path.join(__dirname, HOST_SOURCE),
    ], { windowsHide: true, timeout: 60000 }, (error, stdout) => {
      if (error) reject(new Error(`compilation : ${String(stdout || error.message).trim().slice(0, 400)}`));
      else resolve();
    });
  });
  fs.renameSync(tmp, exe);
  // Les versions précédentes ne servent plus.
  fs.readdirSync(cacheDir())
    .filter(name => /^livechat-host-.*\.exe$/.test(name) && path.join(cacheDir(), name) !== exe)
    .forEach(name => fs.rm(path.join(cacheDir(), name), { force: true }, () => {}));
  log(`fenêtre livechat compilée (${path.basename(exe)})`);
  return exe;
}

function createLiveChat({ firebaseHost, getIdentity, putFB, log, installDir = __dirname, scriptVersion = '' }) {
  const configPath = path.join(installDir, CONFIG_FILENAME);
  const workDir = path.join(cacheDir(), 'media');
  const queue = {};
  const seen = new Set();
  const pending = [];
  let stream = null;
  let pumping = false;
  let host = null;
  let hostIdleTimer = null;
  let hostBrokenUntil = 0;
  let waiter = null;
  let stopped = false;

  const readConfig = () => {
    try { return parseLiveChatConfig(fs.readFileSync(configPath, 'utf8')); }
    catch { return parseLiveChatConfig(''); }
  };

  const remember = id => {
    seen.add(id);
    if (seen.size > 500) seen.delete(seen.values().next().value);
  };

  // ─── Fenêtre native ────────────────────────────────────────────────────

  async function ensureHost() {
    if (host) return host;
    if (Date.now() < hostBrokenUntil) return null;
    try {
      const exe = await compileHost(log);
      const child = spawn(exe, [], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
      let buffer = '';
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', chunk => {
        buffer += chunk;
        let index;
        while ((index = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, index).trim();
          buffer = buffer.slice(index + 1);
          let message = null;
          try { message = JSON.parse(line); } catch { continue; }
          if (message.evt === 'error') log(`affichage impossible : ${message.detail}`);
          if (message.evt === 'done' && waiter && waiter.id === message.id) waiter.resolve(message.detail);
        }
      });
      child.on('exit', () => {
        if (host === child) host = null;
        if (waiter) waiter.resolve('exit');
      });
      child.on('error', error => log(`fenêtre livechat : ${error.message}`));
      child.stdin.on('error', () => {});
      host = child;
      return child;
    } catch (error) {
      hostBrokenUntil = Date.now() + 30 * 60 * 1000;
      log(`fenêtre livechat indisponible : ${error.message}`);
      return null;
    }
  }

  function send(command) {
    if (!host) return;
    try { host.stdin.write(`${JSON.stringify(command)}\n`); } catch { /* fenêtre fermée */ }
  }

  function scheduleHostIdle() {
    clearTimeout(hostIdleTimer);
    hostIdleTimer = setTimeout(() => { send({ cmd: 'quit' }); }, HOST_IDLE_MS);
    hostIdleTimer.unref?.();
  }

  // ─── File d'affichage ─────────────────────────────────────────────────

  function prepare(item) {
    fs.mkdirSync(workDir, { recursive: true });
    const base = item.id.replace(/[^A-Za-z0-9_-]/g, '');
    const media = item.media
      ? download(item.media.url, workDir, base).catch(error => ({ error }))
      : Promise.resolve(null);
    const avatar = item.from.avatar
      ? download(item.from.avatar, workDir, `${base}-avatar`).catch(() => null)
      : Promise.resolve(null);
    return Promise.all([media, avatar]);
  }

  function enqueue(item) {
    remember(item.id);
    pending.push({ item, ready: prepare(item) });
    while (pending.length > MAX_PENDING) pending.shift();
    pump();
  }

  async function pump() {
    if (pumping) return;
    pumping = true;
    try {
      while (pending.length && !stopped) {
        const { item, ready } = pending.shift();
        const [media, avatar] = await ready;
        const files = [media?.file, avatar?.file].filter(Boolean);
        try {
          if (media?.error) { log(`média de ${item.from.name} ignoré : ${media.error.message}`); if (!item.text) continue; }
          const config = readConfig();
          if (!config.enabled) continue;
          const child = await ensureHost();
          if (!child) continue;
          clearTimeout(hostIdleTimer);
          const shape = media?.file ? hostKind(item, media.contentType, media.file) : { kind: 'text', loop: false };
          const done = new Promise(resolve => { waiter = { id: item.id, resolve }; });
          const durationMs = displayDurationMs(item);
          send({
            cmd: 'show',
            id: item.id,
            kind: shape.kind,
            loop: shape.loop,
            path: media?.file || '',
            text: item.text,
            textPos: item.textPos,
            fromName: item.from.name,
            avatarPath: avatar?.file || '',
            ...item.layout,
            durationMs,
            maxVideoMs: config.maxVideoSeconds * 1000,
            volume: item.muted ? 0 : config.volume / 100,
            // Un GIF Tenor livré en vidéo n'a jamais d'extrait : il boucle en entier.
            startMs: item.trim && !shape.loop ? item.trim.startMs : 0,
            endMs: item.trim && !shape.loop ? item.trim.endMs : 0,
          });
          log(`📺 ${item.from.name} → ${shape.kind}${item.text ? ` « ${item.text.slice(0, 40)} »` : ''} (${item.size})`);
          // Garde-fou : la fenêtre répond toujours, mais un blocage ne doit
          // pas figer la file pour de bon.
          const limit = Math.max(durationMs, config.maxVideoSeconds * 1000) + 20000;
          const guard = new Promise(resolve => { const t = setTimeout(() => resolve('timeout'), limit); t.unref?.(); });
          const reason = await Promise.race([done, guard]);
          waiter = null;
          if (reason === 'timeout') { log('fenêtre livechat bloquée, redémarrage'); host?.kill(); host = null; }
        } finally {
          files.forEach(file => fs.rm(file, { force: true }, () => {}));
        }
      }
    } finally {
      pumping = false;
      if (host) scheduleHostIdle();
    }
  }

  function consider(id) {
    const config = readConfig();
    const item = normalizeItem(id, queue[id]);
    const memberId = getIdentity()?.memberId || '';
    if (shouldDisplay(item, { memberId, seen, enabled: config.enabled })) enqueue(item);
    else if (item) remember(item.id);
  }

  async function heartbeat() {
    const identity = getIdentity();
    if (!identity?.memberId) return;
    await putFB(`${LIVECHAT_RECEIVERS_PATH}/${identity.memberId}`, {
      name: identity.memberName,
      enabled: readConfig().enabled,
      ts: Date.now(),
      version: scriptVersion,
    });
  }

  function start() {
    if (process.platform !== 'win32') return;
    stream = openFirebaseStream({
      host: firebaseHost,
      path: LIVECHAT_QUEUE_PATH,
      onEvent: (event, data) => applyQueueEvent(queue, event, data).forEach(consider),
    });
    heartbeat().catch(() => {});
    setInterval(() => heartbeat().catch(() => {}), HEARTBEAT_MS).unref?.();
    // Restes d'un arrêt brutal pendant un affichage.
    fs.rm(workDir, { recursive: true, force: true }, () => {});
  }

  function stop() {
    stopped = true;
    stream?.stop();
    send({ cmd: 'quit' });
  }

  return { start, stop };
}

module.exports = { createLiveChat, compileHost, hostKind, extensionFor };
