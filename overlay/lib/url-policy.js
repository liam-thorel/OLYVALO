/**
 * L'overlay charge un site distant. Sans garde-fou, un lien externe ouvrirait
 * n'importe quelle page dans une fenêtre qui, elle, est toujours au-dessus du
 * jeu et lancée au démarrage de Windows. On enferme donc la navigation dans
 * l'origine du site, et tout le reste part dans le navigateur par défaut.
 */

const SITE_ORIGIN = 'https://liam-thorel.github.io';
const SITE_PATH_PREFIX = '/OLYVALO';

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

function siteUrl(hash = '') {
  return `${SITE_ORIGIN}${SITE_PATH_PREFIX}/${hash}`;
}

module.exports = { isAllowedUrl, isSafeExternalUrl, siteUrl, SITE_ORIGIN, SITE_PATH_PREFIX };
