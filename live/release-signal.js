/**
 * Mise à jour dès la publication d'une version.
 *
 * Sans ça, un poste ne découvre une release qu'à sa vérification suivante,
 * jusqu'à 30 minutes plus tard. Le workflow de release écrit la nouvelle
 * version dans liveControl/release ; chaque poste écoute ce nœud et lance
 * aussitôt sa mise à jour habituelle — qui, elle, attend toujours la fin de
 * la partie en cours avant de redémarrer.
 *
 * Le départ est étalé sur une minute : tous les postes à la fois sur l'API
 * GitHub, c'est le meilleur moyen de se faire limiter.
 */
const { compareVersions } = require('./updater.js');
const { openFirebaseStream } = require('./firebase-stream.js');

const RELEASE_SIGNAL_PATH = 'liveControl/release';
const MAX_JITTER_MS = 60 * 1000;

/** Version à installer d'après le signal, ou null s'il n'annonce rien de neuf. */
function releaseToInstall(signal, currentVersion) {
  const version = String(signal?.version || '').trim();
  if (!/^\d+\.\d+\.\d+$/.test(version)) return null;
  return compareVersions(version, currentVersion) > 0 ? version : null;
}

/**
 * Le nœud arrive entier à la connexion (path "/"), puis champ par champ si
 * seul l'un d'eux change : on garde une copie à jour.
 */
function applySignalEvent(current, event, data) {
  if (!data || typeof data !== 'object') return current;
  const segments = String(data.path || '/').split('/').filter(Boolean);
  if (segments.length === 0) {
    if (event === 'patch') return { ...(current || {}), ...(data.data || {}) };
    return data.data && typeof data.data === 'object' ? { ...data.data } : null;
  }
  return { ...(current || {}), [segments[0]]: data.data };
}

function watchReleaseSignal({ firebaseHost, currentVersion, onRelease, log = () => {}, random = Math.random }) {
  let signal = null;
  let scheduled = '';
  return openFirebaseStream({
    host: firebaseHost,
    path: RELEASE_SIGNAL_PATH,
    onEvent(event, data) {
      signal = applySignalEvent(signal, event, data);
      const version = releaseToInstall(signal, currentVersion);
      if (!version || version === scheduled) return;
      scheduled = version;
      const delay = Math.round(random() * MAX_JITTER_MS);
      log(`Version ${version} publiée — mise à jour dans ${Math.round(delay / 1000)} s`);
      setTimeout(() => onRelease(version), delay).unref?.();
    },
  });
}

module.exports = { RELEASE_SIGNAL_PATH, applySignalEvent, releaseToInstall, watchReleaseSignal };
