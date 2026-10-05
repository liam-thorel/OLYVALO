/**
 * Mise à jour automatique, via electron-updater et les releases GitHub.
 *
 * Deux règles de conduite, qui viennent de l'usage : l'overlay tourne pendant
 * qu'on joue, et redémarrer une application au milieu d'une partie serait pire
 * que de ne pas se mettre à jour du tout.
 *
 *   1. Le téléchargement se fait en fond, sans rien demander.
 *   2. L'installation n'interrompt jamais une partie, ni quelqu'un qui
 *      regarde l'overlay.
 *
 * Elle attendait la fermeture de l'application. Mais l'overlay vit dans la
 * zone de notification et ne se ferme pratiquement jamais, et un arrêt de
 * Windows le tue sans lui laisser le temps d'installer : des postes sont
 * restés des semaines sur une version qui ne connaissait pas la nouvelle
 * adresse du site. Elle se fait donc désormais en silence, dès que la fenêtre
 * est masquée et qu'aucun jeu ne tourne — voir shouldInstallNow.
 *
 * Ce module ne fait que câbler les évènements et journaliser ; l'appelant
 * décide quoi montrer. Séparé de main.js pour que la logique de décision
 * ci-dessous soit testable sans Electron.
 */

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 4 fois par jour : une release
                                              // par semaine au mieux, inutile
                                              // d'interroger GitHub sans cesse
const FIRST_CHECK_DELAY_MS = 30_000; // laisse le démarrage se terminer

/**
 * Faut-il lancer une vérification maintenant ?
 *
 * On ne télécharge pas 90 Mo pendant une partie : ça consomme de la bande
 * passante au pire moment, et l'installation devra de toute façon attendre la
 * fermeture de l'application.
 */
function shouldCheck({ gameRunning, lastCheckAt, now, intervalMs = CHECK_INTERVAL_MS }) {
  if (gameRunning) return false;
  if (!lastCheckAt) return true;
  return now - lastCheckAt >= intervalMs;
}

/**
 * Faut-il installer maintenant la mise à jour téléchargée ?
 *
 * Seulement quand personne ne peut s'en apercevoir : pas de partie en cours,
 * et la fenêtre masquée. L'installation est silencieuse et relance
 * l'application, qui revient masquée dans la zone de notification.
 */
function shouldInstallNow({ downloaded, gameRunning, visible }) {
  return Boolean(downloaded) && !gameRunning && !visible;
}

/** Résumé lisible d'une version téléchargée, pour le menu et le journal. */
function updateLabel(info) {
  const version = info?.version;
  return version ? `Redémarrer pour installer la ${version}` : 'Redémarrer pour mettre à jour';
}

function setupAutoUpdate({ autoUpdater, log, onStateChange = () => {} }) {
  // L'installation ne doit jamais couper une partie : electron-updater
  // l'applique à la fermeture de l'application, pas à chaud.
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = { info: log, warn: log, error: log, debug: () => {} };

  let downloaded = null;

  autoUpdater.on('checking-for-update', () => log('[maj] vérification'));
  autoUpdater.on('update-not-available', info => log('[maj] déjà à jour', info?.version || ''));
  autoUpdater.on('update-available', info => log('[maj] version disponible :', info?.version || '?'));
  autoUpdater.on('download-progress', progress => {
    log(`[maj] téléchargement ${Math.round(progress?.percent || 0)}%`);
  });
  autoUpdater.on('update-downloaded', info => {
    downloaded = info;
    log('[maj] prête, sera installée à la fermeture :', info?.version || '?');
    onStateChange({ downloaded: info });
  });
  // Une mise à jour qui échoue ne doit pas empêcher l'overlay de fonctionner :
  // pas de réseau, GitHub indisponible, release sans latest.yml… on le note et
  // on réessaiera au prochain passage.
  autoUpdater.on('error', error => log('[maj] échec —', error?.message || error));

  return {
    check: () => autoUpdater.checkForUpdates().catch(error => {
      log('[maj] échec —', error?.message || error);
      return null;
    }),
    // Installation silencieuse (pas de fenêtre d'installation par-dessus le
    // bureau), puis relance de l'overlay.
    installNow: () => autoUpdater.quitAndInstall(true, true),
    pending: () => downloaded,
  };
}

module.exports = {
  setupAutoUpdate, shouldCheck, shouldInstallNow, updateLabel,
  CHECK_INTERVAL_MS, FIRST_CHECK_DELAY_MS,
};
