const fs = require('fs');
const https = require('https');
const path = require('path');

const REPOSITORY = 'liam-thorel/OLYVALO';
const USER_AGENT = 'OLYCITY-Live-Updater';
const REQUEST_TIMEOUT_MS = 8000;
const MAX_DOWNLOAD_BYTES = 5 * 1024 * 1024;

function versionParts(version) {
  return String(version || '').replace(/^v/i, '').split('.').map(part => Number.parseInt(part, 10) || 0);
}

function compareVersions(left, right) {
  const a = versionParts(left);
  const b = versionParts(right);
  const length = Math.max(a.length, b.length, 3);
  for (let index = 0; index < length; index++) {
    if ((a[index] || 0) > (b[index] || 0)) return 1;
    if ((a[index] || 0) < (b[index] || 0)) return -1;
  }
  return 0;
}

function restartDecision(inGame, installedVersion) {
  if (!installedVersion) return 'none';
  return inGame ? 'defer' : 'restart';
}

function requestBuffer(url, redirects = 4) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/vnd.github+json' },
    }, response => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location && redirects > 0) {
        response.resume();
        requestBuffer(new URL(response.headers.location, url).toString(), redirects - 1).then(resolve, reject);
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`HTTP ${response.statusCode}`));
        return;
      }
      const chunks = [];
      let size = 0;
      response.on('data', chunk => {
        size += chunk.length;
        if (size > MAX_DOWNLOAD_BYTES) {
          response.destroy(new Error('Fichier de mise à jour trop volumineux'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => resolve(Buffer.concat(chunks)));
      response.on('error', reject);
    });
    request.setTimeout(REQUEST_TIMEOUT_MS, () => request.destroy(new Error('Délai de mise à jour dépassé')));
    request.on('error', reject);
  });
}

async function requestJson(url) {
  return JSON.parse((await requestBuffer(url)).toString('utf8'));
}

function validateManifest(manifest, expectedVersion) {
  if (!manifest || manifest.version !== expectedVersion || !Array.isArray(manifest.files)) {
    throw new Error('Manifest de mise à jour invalide');
  }
  const files = [...new Set(manifest.files)];
  if (!files.includes('index.js') || !files.includes('package.json') || !files.includes('updater.js')) {
    throw new Error('Manifest de mise à jour incomplet');
  }
  if (files.some(file => typeof file !== 'string' || !/^[A-Za-z0-9._-]+$/.test(file))) {
    throw new Error('Chemin de mise à jour non autorisé');
  }
  return files;
}

async function latestRelease() {
  const release = await requestJson(`https://api.github.com/repos/${REPOSITORY}/releases/latest`);
  const tag = String(release.tag_name || '');
  return { tag, version: tag.replace(/^v/i, '') };
}

async function installRelease(tag, version, installDir) {
  const rawBase = `https://raw.githubusercontent.com/${REPOSITORY}/${encodeURIComponent(tag)}/live`;
  const manifest = await requestJson(`${rawBase}/update-manifest.json`);
  const files = validateManifest(manifest, version);
  const stagingDir = path.join(installDir, '.olycity-update');
  const backupDir = path.join(installDir, '.olycity-backup');

  await fs.promises.rm(stagingDir, { recursive: true, force: true });
  await fs.promises.rm(backupDir, { recursive: true, force: true });
  await fs.promises.mkdir(stagingDir, { recursive: true });
  await fs.promises.mkdir(backupDir, { recursive: true });

  try {
    for (const file of files) {
      const contents = await requestBuffer(`${rawBase}/${encodeURIComponent(file)}`);
      await fs.promises.writeFile(path.join(stagingDir, file), contents);
    }

    const downloadedPackage = JSON.parse(await fs.promises.readFile(path.join(stagingDir, 'package.json'), 'utf8'));
    if (downloadedPackage.version !== version) throw new Error('Version téléchargée incohérente');

    for (const file of files) {
      const target = path.join(installDir, file);
      if (fs.existsSync(target)) await fs.promises.copyFile(target, path.join(backupDir, file));
    }
    for (const file of files) {
      await fs.promises.copyFile(path.join(stagingDir, file), path.join(installDir, file));
    }
  } catch (error) {
    for (const file of files) {
      const backup = path.join(backupDir, file);
      if (fs.existsSync(backup)) await fs.promises.copyFile(backup, path.join(installDir, file));
    }
    throw error;
  } finally {
    await fs.promises.rm(stagingDir, { recursive: true, force: true });
  }

  return { updated: true, version };
}

async function autoUpdate(currentVersion, installDir = __dirname) {
  if (process.env.OLYCITY_SKIP_UPDATE === '1') return { updated: false, reason: 'disabled' };
  const latest = await latestRelease();
  if (!latest.version || compareVersions(latest.version, currentVersion) <= 0) {
    return { updated: false, version: latest.version || currentVersion };
  }
  return installRelease(latest.tag, latest.version, installDir);
}

module.exports = { autoUpdate, compareVersions, restartDecision, validateManifest };
