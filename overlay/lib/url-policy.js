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
// Avec olycity.fr, le site principal : le logo du tracker y mène. Pas www,
// ni aucun autre sous-domaine — l'overlay, toujours au premier plan et lancé
// avec Windows, n'affiche que ce qui appartient à OLYCITY.
//
// Acceptée AVANT que le domaine ne soit branché : dès qu'il l'est, GitHub
// redirige l'ancienne adresse vers celle-ci, et un overlay qui ne la
// connaîtrait pas renverrait chaque lien du site vers le navigateur.
const OWN_ORIGINS = new Set(['https://tracker.olycity.fr', 'https://olycity.fr']);

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

// Connexion au site avec Discord. Ouverte dans le navigateur, elle y
// déposait le jeton au lieu de l'overlay ; ouverte sur place, la moindre page
// de Discord hors de l'autorisation (captcha, double authentification, code
// envoyé par e-mail…) repartait dans le navigateur au milieu du parcours. Elle
// a donc sa propre fenêtre, qui accepte tout discord.com le temps de la
// connexion et se ferme dès que Discord renvoie vers le site.
function isDiscordUrl(url) {
  const parsed = parse(url);
  return !!parsed && parsed.origin === 'https://discord.com';
}

// La musique (lecteur en bas du site) se connecte par son serveur :
// /auth/login part chez Discord, /auth/callback revient avec la session. Le
// reste de musique.olycity.fr n'a rien à faire dans l'overlay.
const MUSIC_ORIGIN = 'https://musique.olycity.fr';

function isMusicLogin(url) {
  const parsed = parse(url);
  return !!parsed && parsed.origin === MUSIC_ORIGIN && parsed.pathname === '/auth/login';
}

/**
 * Sort d'une navigation dans la fenêtre de connexion Discord :
 *   'stay'     une page de Discord (ou de la connexion musique), elle s'ouvre
 *              dans la fenêtre ;
 *   'return'   le retour vers le site, jeton compris : il revient à l'overlay ;
 *   'done'     la musique est connectée : il suffit de recharger le site ;
 *   'external' un lien d'aide ou autre, pour le navigateur ;
 *   'block'    tout le reste (file:, protocoles…).
 */
function discordLoginStep(url) {
  if (isDiscordUrl(url)) return 'stay';
  const parsed = parse(url);
  if (parsed?.origin === MUSIC_ORIGIN) return parsed.pathname.startsWith('/auth/') ? 'stay' : 'done';
  if (isAllowedUrl(url)) return 'return';
  return isSafeExternalUrl(url) ? 'external' : 'block';
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

// Page d'envoi du livechat (hub olycity.fr), ouverte dans l'overlay.
const LIVECHAT_PAGE = 'https://olycity.fr/livechat/';

module.exports = { discordLoginStep, isAllowedUrl, isDiscordUrl, isMusicLogin, isSafeExternalUrl, siteUrl, LIVECHAT_PAGE, SITE_ORIGIN, SITE_PATH_PREFIX, OWN_ORIGINS, SITE_HOME };
