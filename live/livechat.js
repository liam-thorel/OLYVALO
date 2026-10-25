/**
 * Livechat côté poste : écoute livechat/queue (flux Firebase), télécharge les
 * médias et les fait afficher, un par un, par la fenêtre native livechat-host.
 *
 * La fenêtre est un petit programme WPF compilé sur place par le csc.exe du
 * .NET Framework fourni avec Windows : aucun binaire à distribuer, ~25 Ko, et
 * rien ne tourne tant que personne ne poste. Elle est lancée au premier
 * élément puis fermée après quelques minutes d'inactivité.
 *
 * À côté, livechat-keys (compilé de la même façon, sans fenêtre) surveille en
 * permanence la touche qui coupe ou réactive le livechat. Les liens vidéo
 * (YouTube, clips…) passent par yt-dlp (voir ytdlp.js), et livechat/control
 * permet à Liam de réactiver le livechat à distance (/livechat-reactiver).
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
  LIVECHAT_CONTROL_PATH,
  MAX_MEDIA_BYTES,
  applyQueueEvent,
  displayDurationMs,
  hotkeyLabel,
  isAllowedMediaUrl,
  normalizeItem,
  parseLiveChatConfig,
  pendingControl,
  shouldDisplay,
} = require('./livechat-utils.js');
const { openFirebaseStream } = require('./firebase-stream.js');
const { createYtDlp } = require('./ytdlp.js');

const CONFIG_FILENAME = 'olycity-livechat.json';
const HOST_SOURCE = 'livechat-host.cs';
const KEYS_SOURCE = 'livechat-keys.cs';
const CONFIG_POLL_MS = 3000;
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

// Emplacement fixe où le Live indique où sont ses réglages : l'overlay, qui
// ne sait pas où le Live a été dézippé, y lit et y modifie les touches.
const SETTINGS_POINTER = 'settings-location.json';

function publishSettingsLocation(configPath, version) {
  try {
    fs.mkdirSync(cacheDir(), { recursive: true });
    fs.writeFileSync(path.join(cacheDir(), SETTINGS_POINTER), `${JSON.stringify({ configPath, version, updatedAt: Date.now() }, null, 2)}\n`, 'utf8');
  } catch { /* l'overlay ne pourra simplement pas régler les touches */ }
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

// Programmes compilés sur place : la fenêtre (WPF) et la surveillance des
// touches (sans fenêtre). Le nom porte l'empreinte du source : une mise à
// jour du script recompile d'elle-même.
const PROGRAMS = {
  host: { source: HOST_SOURCE, prefix: 'livechat-host', wpf: true },
  keys: { source: KEYS_SOURCE, prefix: 'livechat-keys', wpf: false },
};

async function compileProgram(name, log = () => {}) {
  const program = PROGRAMS[name];
  const source = fs.readFileSync(path.join(__dirname, program.source));
  const hash = crypto.createHash('sha1').update(source).digest('hex').slice(0, 12);
  const exe = path.join(cacheDir(), `${program.prefix}-${hash}.exe`);
  if (fs.existsSync(exe)) return exe;
  const fw = frameworkDir();
  if (!fw) throw new Error('.NET Framework 4 introuvable');
  fs.mkdirSync(cacheDir(), { recursive: true });
  const refs = program.wpf ? [
    path.join(fw, 'WPF', 'PresentationFramework.dll'),
    path.join(fw, 'WPF', 'PresentationCore.dll'),
    path.join(fw, 'WPF', 'WindowsBase.dll'),
    path.join(fw, 'System.Xaml.dll'),
    'System.Drawing.dll',
    'System.Web.Extensions.dll',
  ] : ['System.Web.Extensions.dll'];
  const tmp = `${exe}.tmp`;
  await new Promise((resolve, reject) => {
    execFile(path.join(fw, 'csc.exe'), [
      '-nologo', '-target:winexe', '-optimize+', `-out:${tmp}`,
      ...refs.map(ref => `-r:${ref}`),
      path.join(__dirname, program.source),
    ], { windowsHide: true, timeout: 60000 }, (error, stdout) => {
      if (error) reject(new Error(`compilation : ${String(stdout || error.message).trim().slice(0, 400)}`));
      else resolve();
    });
  });
  fs.renameSync(tmp, exe);
  // Les versions précédentes ne servent plus (un exe en cours d'exécution
  // résiste à la suppression : il partira la fois suivante).
  const stale = new RegExp(`^${program.prefix}-.*\\.exe$`);
  fs.readdirSync(cacheDir())
    .filter(file => stale.test(file) && path.join(cacheDir(), file) !== exe)
    .forEach(file => fs.rm(path.join(cacheDir(), file), { force: true }, () => {}));
  log(`${program.prefix} compilé (${path.basename(exe)})`);
  return exe;
}

const compileHost = log => compileProgram('host', log);

/** Arguments de la touche « passer » pour la fenêtre (0 : aucune). */
function skipArgs(key) {
  if (!key) return { skipVk: 0 };
  return { skipVk: key.vk, skipCtrl: key.ctrl, skipShift: key.shift, skipAlt: key.alt, skipWin: key.win };
}

function createLiveChat({ firebaseHost, getIdentity, putFB, log, installDir = __dirname, scriptVersion = '' }) {
  const configPath = path.join(installDir, CONFIG_FILENAME);
  const workDir = path.join(cacheDir(), 'media');
  const ytdlp = createYtDlp({ dir: cacheDir(), log });
  const queue = {};
  const control = {};
  const seen = new Set();
  const pending = [];
  let stream = null;
  let controlStream = null;
  let keys = null;
  let keysBrokenUntil = 0;
  let keysSignature = '';
  let configWatch = null;
  let current = null; // élément affiché en ce moment
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

  // Écrit seulement les champs modifiés : LIVECHAT.bat peut avoir réglé le
  // reste entre-temps.
  const writeConfig = changes => {
    let raw = {};
    try { raw = JSON.parse(fs.readFileSync(configPath, 'utf8')) || {}; } catch { raw = {}; }
    fs.writeFileSync(configPath, `${JSON.stringify({ ...raw, ...changes }, null, 2)}\n`, 'utf8');
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
    let media = Promise.resolve(null);
    if (item.media?.link) {
      media = ytdlp.resolve(item.media.url, { workDir, base, site: item.media.site })
        .then(found => (found.stream
          ? { file: found.stream, remote: true, contentType: 'video/mp4' }
          : { file: found.file, contentType: 'video/mp4' }))
        .catch(error => ({ error }));
    } else if (item.media) {
      media = download(item.media.url, workDir, base).catch(error => ({ error }));
    }
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

  /**
   * Message local, affiché même livechat coupé et avant le reste de la file :
   * c'est la confirmation d'une touche ou d'une réactivation à distance.
   */
  function notify(text) {
    const item = {
      id: `local-${Date.now().toString(36)}`, from: { id: null, name: 'OLYCITY Livechat', avatar: null },
      text, media: null, size: 'petit', layout: { cx: 0.83, cy: 0.12, w: 0.3, h: 0.1 },
      textPos: 'bas', durationMs: 2600, muted: true, trim: null,
    };
    pending.unshift({ item, ready: Promise.resolve([null, null]), local: true });
    if (current) send({ cmd: 'skip' });
    pump();
  }

  async function pump() {
    if (pumping) return;
    pumping = true;
    try {
      while (pending.length && !stopped) {
        const entry = pending.shift();
        const { item, ready } = entry;
        let [media, avatar] = await ready;
        // Une adresse lue en continu n'est pas un fichier à effacer.
        const cleanup = [media && !media.remote ? media.file : null, avatar?.file].filter(Boolean);
        try {
          if (media?.error) { log(`média de ${item.from.name} ignoré : ${media.error.message}`); if (!item.text) continue; }
          const config = readConfig();
          if (!config.enabled && !entry.local) continue;
          const child = await ensureHost();
          if (!child) continue;
          clearTimeout(hostIdleTimer);
          const shape = media?.file
            ? (item.media?.link ? { kind: 'video', loop: false } : hostKind(item, media.contentType, media.file))
            : { kind: 'text', loop: false };
          let reason = await display(item, media, avatar, shape, config);
          // Une vidéo YouTube lue en continu qui refuse de s'ouvrir : on la
          // télécharge et on réessaie, une fois.
          if (reason === 'error' && media?.remote && !stopped) {
            log(`lecture en continu impossible, téléchargement de la vidéo de ${item.from.name}`);
            const base = `${item.id.replace(/[^A-Za-z0-9_-]/g, '')}-dl`;
            media = await ytdlp.download(item.media.url, { workDir, base }).then(file => ({ file, contentType: 'video/mp4' }), error => ({ error }));
            if (media.file) { cleanup.push(media.file); reason = await display(item, media, avatar, shape, readConfig()); }
            else log(`vidéo de ${item.from.name} ignorée : ${media.error.message}`);
          }
        } finally {
          cleanup.forEach(file => fs.rm(file, { force: true }, () => {}));
        }
      }
    } finally {
      pumping = false;
      if (host) scheduleHostIdle();
    }
  }

  /** Fait afficher un élément et attend la fin : rend la raison (end, skip, error…). */
  async function display(item, media, avatar, shape, config) {
    current = item;
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
      ...skipArgs(config.skipKey),
    });
    if (!item.id.startsWith('local-')) {
      log(`📺 ${item.from.name} → ${item.media?.link ? `lien ${item.media.site}` : shape.kind}${item.text ? ` « ${item.text.slice(0, 40)} »` : ''} (${item.size})`);
    }
    // Garde-fou : la fenêtre répond toujours, mais un blocage ne doit
    // pas figer la file pour de bon. Une vidéo lue en continu a 15 s de
    // plus pour s'ouvrir.
    const limit = Math.max(durationMs, config.maxVideoSeconds * 1000) + (media?.remote ? 35000 : 20000);
    const guard = new Promise(resolve => { const t = setTimeout(() => resolve('timeout'), limit); t.unref?.(); });
    const reason = await Promise.race([done, guard]);
    waiter = null;
    current = null;
    if (reason === 'timeout') { log('fenêtre livechat bloquée, redémarrage'); host?.kill(); host = null; }
    return reason;
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

  // ─── Couper / réactiver ───────────────────────────────────────────────

  function setEnabled(enabled, why) {
    const config = readConfig();
    if (config.enabled === enabled) return;
    writeConfig({ enabled });
    log(`livechat ${enabled ? 'réactivé' : 'coupé'} (${why})`);
    // Coupé : la file en attente part avec (les messages locaux restent).
    if (!enabled) pending.splice(0, pending.length, ...pending.filter(entry => entry.local));
    const key = config.toggleKey ? hotkeyLabel(config.toggleKey) : null;
    notify(enabled
      ? `Livechat réactivé${why.startsWith('par ') ? ` ${why}` : ''}`
      : `Livechat coupé${key ? ` · ${key} pour le réactiver` : ''}`);
    heartbeat().catch(() => {});
  }

  // Surveillance permanente de la touche « couper / réactiver ».
  async function ensureKeys() {
    if (keys || Date.now() < keysBrokenUntil) return keys;
    try {
      const exe = await compileProgram('keys', log);
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
          if (message.evt === 'key' && message.action === 'toggle') setEnabled(!readConfig().enabled, 'touche');
        }
      });
      child.on('exit', () => {
        if (keys === child) { keys = null; keysSignature = ''; }
        if (!stopped) keysBrokenUntil = Date.now() + 60 * 1000;
      });
      child.on('error', error => log(`touches livechat : ${error.message}`));
      child.stdin.on('error', () => {});
      keys = child;
      keysSignature = '';
      return child;
    } catch (error) {
      keysBrokenUntil = Date.now() + 30 * 60 * 1000;
      log(`touches livechat indisponibles : ${error.message}`);
      return null;
    }
  }

  // Les réglages de LIVECHAT.bat sont relus sans redémarrer le script.
  async function syncKeys() {
    const config = readConfig();
    const signature = JSON.stringify(config.toggleKey);
    const child = config.toggleKey ? await ensureKeys() : keys;
    if (!child || signature === keysSignature) return;
    try { child.stdin.write(`${JSON.stringify({ cmd: 'keys', toggle: config.toggleKey })}\n`); } catch { return; }
    keysSignature = signature;
  }

  function applyControl() {
    const config = readConfig();
    const order = pendingControl(control, { memberId: getIdentity()?.memberId || '', appliedAt: config.controlAppliedAt });
    if (!order) return;
    writeConfig({ controlAppliedAt: order.at });
    if (!config.enabled) setEnabled(true, `par ${order.by}`);
  }

  function start() {
    if (process.platform !== 'win32') return;
    publishSettingsLocation(configPath, scriptVersion);
    stream = openFirebaseStream({
      host: firebaseHost,
      path: LIVECHAT_QUEUE_PATH,
      onEvent: (event, data) => applyQueueEvent(queue, event, data).forEach(consider),
    });
    controlStream = openFirebaseStream({
      host: firebaseHost,
      path: LIVECHAT_CONTROL_PATH,
      onEvent: (event, data) => { applyQueueEvent(control, event, data); applyControl(); },
    });
    heartbeat().catch(() => {});
    setInterval(() => heartbeat().catch(() => {}), HEARTBEAT_MS).unref?.();
    syncKeys().catch(() => {});
    configWatch = setInterval(() => syncKeys().catch(() => {}), CONFIG_POLL_MS);
    configWatch.unref?.();
    // yt-dlp prêt avant le premier lien : 18 Mo, une fois, en arrière-plan.
    const warm = setTimeout(() => { if (readConfig().enabled) ytdlp.ensure().catch(error => log(`yt-dlp indisponible : ${error.message}`)); }, 60 * 1000);
    warm.unref?.();
    // Restes d'un arrêt brutal pendant un affichage.
    fs.rm(workDir, { recursive: true, force: true }, () => {});
  }

  function stop() {
    stopped = true;
    stream?.stop();
    controlStream?.stop();
    clearInterval(configWatch);
    send({ cmd: 'quit' });
    try { keys?.stdin.end(); } catch { /* déjà fermé */ }
  }

  return { start, stop, setEnabled };
}

module.exports = { createLiveChat, compileHost, compileProgram, hostKind, extensionFor, skipArgs, SETTINGS_POINTER };
