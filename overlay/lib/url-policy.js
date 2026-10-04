/**
 * L'overlay charge un site distant. Sans garde-fou, un lien externe ouvrirait
 * n'importe quelle page dans une fenêtre qui, elle, est toujours au-dessus du
 * jeu et lancée au démarrage de Windows. On enferme donc la navigation dans
 * l'origine du site, et tout le reste part dans le navigateur par défaut.
 */

const SITE_ORIGIN = 'https://liam-thorel.github.io';
const SITE_PATH_PREFIX = '/OLYVALO';

// L'adresse propre du site. Contrairement à github.io, elle n'héberge que
// OLYCITY : toute l'origine est sûre, quel que soit le chemin.
//
// Le sous-domaine seulement, pas olycity.fr ni www : ils ne servent pas le
// site, et l'overlay — toujours au premier plan, lancé avec Windows — ne doit
// rien afficher d'autre.
//
// Acceptée AVANT que le domaine ne soit branché : dès qu'il l'est, GitHub
// redirige l'ancienne adresse vers celle-ci, et un overlay qui ne la
// connaîtrait pas renverrait chaque lien du site vers le navigateur.
const OWN_ORIGINS = new Set(['https://tracker.olycity.fr']);

function parse(url) {
  try {
    return new URL(String(url));
  } catch {
    return null;
  }
}

/** Navigation autorisée À L'INTÉRIEUR de l'overlay. */
function isAllowedUrl(url) {
  const parsed = parse(url);
  if (!parsed) return false;
  if (OWN_ORIGINS.has(parsed.origin)) return true;
  if (parsed.origin !== SITE_ORIGIN) return false;
  // Même origine ne suffit pas : github.io héberge les pages de tous les
  // dépôts de l'utilisateur, on reste sur celui d'OLYCITY.
  return parsed.pathname === SITE_PATH_PREFIX || parsed.pathname.startsWith(`${SITE_PATH_PREFIX}/`);
}

/**
 * Un lien qu'on refuse d'afficher dans l'overlay peut quand même être ouvert
 * dans le navigateur — mais seulement s'il est http(s). Sans ce filtre,
 * shell.openExternal() accepterait file:, ms-settings: ou n'importe quel
 * gestionnaire de protocole enregistré sur la machine.
 */
function isSafeExternalUrl(url) {
  const parsed = parse(url);
  return !!parsed && (parsed.protocol === 'https:' || parsed.protocol === 'http:');
}

// Adresse chargée par l'overlay : directement le domaine, plutôt que
// l'ancienne adresse github.io qui ne fait plus que rediriger. Un détour de
// moins à chaque ouverture, et plus de dépendance à cette redirection, qui
// disparaîtrait si le site quittait un jour GitHub Pages. L'ancienne adresse
// reste autorisée ci-dessus pour les liens qui y pointent encore.
const SITE_HOME = 'https://tracker.olycity.fr';

function siteUrl(hash = '') {
  return `${SITE_HOME}/${hash}`;
}

module.exports = { isAllowedUrl, isSafeExternalUrl, siteUrl, SITE_ORIGIN, SITE_PATH_PREFIX, OWN_ORIGINS, SITE_HOME };
