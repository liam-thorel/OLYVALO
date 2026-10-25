/**
 * yt-dlp : lit les liens vidéo du livechat (YouTube, clips Twitch, X…).
 *
 * Téléchargé au premier besoin depuis la release officielle sur GitHub, avec
 * vérification de l'empreinte SHA-256 publiée à côté, puis mis à jour tous les
 * trois jours : YouTube change souvent, une version vieille d'un mois ne lit
 * plus rien. Rien n'est installé tant que personne n'envoie de lien.
 *
 * Pas de ffmpeg (80 Mo de plus par PC) : on ne demande que des formats qui
 * contiennent déjà image ET son dans un seul fichier.
 *   - YouTube : l'adresse directe de la vidéo est passée à la fenêtre, qui la
 *     lit en continu et saute au début de l'extrait sans tout télécharger ;
 *   - les autres sites (clips courts, mais adresses souvent liées à des
 *     en-têtes ou des cookies) : la vidéo est téléchargée entièrement.
 */
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

const RELEASE = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download';
const EXE_NAME = 'yt-dlp.exe';
const UPDATE_EVERY_MS = 3 * 24 * 60 * 60 * 1000;
const RESOLVE_TIMEOUT_MS = 45 * 1000;
const DOWNLOAD_TIMEOUT_MS = 150 * 1000;
// Le binaire vient de GitHub ; ses redirections ne doivent pas mener ailleurs.
const BINARY_HOSTS = ['github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com'];

// Un seul fichier avec image et son, en HTTP simple (pas de HLS ni de DASH,
// illisibles sans ffmpeg), 720p au plus. En dernier recours : l'image seule.
const FORMAT = [
  'b[ext=mp4][height<=720][vcodec!=none][acodec!=none][protocol^=http][protocol!*=dash]',
  'b[height<=720][vcodec!=none][acodec!=none][protocol^=http][protocol!*=dash]',
  'b[vcodec!=none][acodec!=none][protocol^=http][protocol!*=dash]',
  'bv*[ext=mp4][height<=720][protocol^=http][protocol!*=dash]',
].join('/');

const COMMON_ARGS = [
  '--no-playlist', '--no-warnings', '--no-progress', '--no-mtime',
  '--socket-timeout', '15',
  // Un direct ne se termine jamais : refusé.
  '--match-filter', '!is_live',
  '-f', FORMAT,
];

function fetchBuffer(url, { maxBytes = 64 * 1024 * 1024, redirects = 5 } = {}) {
  return new Promise((resolve, reject) => {
    const host = new URL(url).hostname;
    if (!BINARY_HOSTS.includes(host)) { reject(new Error(`hôte inattendu : ${host}`)); return; }
    const request = https.get(url, { timeout: 60000, headers: { 'User-Agent': 'OLYCITY-Live' } }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects > 0) {
        res.resume();
        fetchBuffer(new URL(res.headers.location, url).toString(), { maxBytes, redirects: redirects - 1 }).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) { res.resume(); reject(new Error(`HTTP ${res.statusCode}`)); return; }
      const chunks = [];
      let size = 0;
      res.on('data', chunk => {
        size += chunk.length;
        if (size > maxBytes) res.destroy(new Error('fichier trop lourd'));
        else chunks.push(chunk);
      });
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
    request.on('timeout', () => request.destroy(new Error('délai dépassé')));
    request.on('error', reject);
  });
}

/** Empreinte attendue de yt-dlp.exe dans le fichier SHA2-256SUMS de la release. */
function expectedHash(sums, name = EXE_NAME) {
  const line = String(sums).split(/\r?\n/).find(entry => entry.trim().split(/\s+/)[1]?.replace(/^\*/, '') === name);
  const hash = line?.trim().split(/\s+/)[0]?.toLowerCase();
  return /^[0-9a-f]{64}$/.test(hash || '') ? hash : null;
}

function run(exe, args, timeout) {
  return new Promise((resolve, reject) => {
    execFile(exe, args, { windowsHide: true, timeout, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        const detail = String(stderr || error.message).trim().split(/\r?\n/).filter(Boolean).pop() || error.message;
        reject(new Error(detail.replace(/^ERROR:\s*/, '').slice(0, 300)));
      } else resolve(String(stdout));
    });
  });
}

function createYtDlp({ dir, log = () => {} }) {
  const exe = path.join(dir, EXE_NAME);
  let installing = null;
  let updating = null;

  async function install() {
    fs.mkdirSync(dir, { recursive: true });
    const [binary, sums] = await Promise.all([
      fetchBuffer(`${RELEASE}/${EXE_NAME}`),
      fetchBuffer(`${RELEASE}/SHA2-256SUMS`, { maxBytes: 1024 * 1024 }),
    ]);
    const expected = expectedHash(sums);
    const actual = crypto.createHash('sha256').update(binary).digest('hex');
    if (!expected || expected !== actual) throw new Error('empreinte de yt-dlp invalide, téléchargement rejeté');
    const tmp = `${exe}.tmp`;
    fs.writeFileSync(tmp, binary);
    fs.renameSync(tmp, exe);
    log(`yt-dlp installé (${Math.round(binary.length / 1024 / 1024)} Mo)`);
  }

  /** Installe yt-dlp s'il manque ; rend son chemin. */
  async function ensure() {
    if (fs.existsSync(exe)) {
      maybeUpdate();
      return exe;
    }
    installing = installing || install().finally(() => { installing = null; });
    await installing;
    return exe;
  }

  // Mise à jour en arrière-plan : la version installée sert en attendant.
  function maybeUpdate() {
    let age = 0;
    try { age = Date.now() - fs.statSync(exe).mtimeMs; } catch { return; }
    if (age < UPDATE_EVERY_MS || updating) return;
    updating = install()
      .catch(error => {
        log(`mise à jour de yt-dlp impossible : ${error.message}`);
        // Réessayer demain plutôt qu'à chaque lien.
        try { fs.utimesSync(exe, new Date(), new Date(Date.now() - UPDATE_EVERY_MS + 24 * 60 * 60 * 1000)); } catch { /* tant pis */ }
      })
      .finally(() => { updating = null; });
  }

  /**
   * Ce que la fenêtre doit lire pour ce lien : { stream } (adresse directe,
   * lue en continu) ou { file } (vidéo téléchargée dans `workDir`).
   */
  async function resolve(link, { workDir, base, site }) {
    const binary = await ensure();
    if (site === 'youtube') {
      const out = await run(binary, [...COMMON_ARGS, '-g', '--', link], RESOLVE_TIMEOUT_MS);
      const urls = out.split(/\r?\n/).map(line => line.trim()).filter(line => /^https:\/\//.test(line));
      if (urls.length === 1) return { stream: urls[0] };
      // Image et son séparés (rare avec ce format) : on télécharge.
    }
    return { file: await download(link, { workDir, base }) };
  }

  async function download(link, { workDir, base }) {
    const binary = await ensure();
    fs.mkdirSync(workDir, { recursive: true });
    const out = await run(binary, [
      ...COMMON_ARGS,
      '--max-filesize', '500M',
      '-o', path.join(workDir, `${base}.%(ext)s`),
      '--print', 'after_move:filepath', '--no-simulate',
      '--', link,
    ], DOWNLOAD_TIMEOUT_MS);
    const file = out.split(/\r?\n/).map(line => line.trim()).filter(Boolean).pop();
    if (!file || !fs.existsSync(file)) throw new Error('vidéo introuvable après téléchargement');
    return file;
  }

  return { ensure, resolve, download, path: exe };
}

module.exports = { createYtDlp, expectedHash, FORMAT, COMMON_ARGS };
