/**
 * Suivi des redirections HTTP pour les petites requêtes du script.
 *
 * `https.get` de Node ne suit PAS les redirections. Tant que le site vivait à
 * une seule adresse, ça ne se voyait pas. Avec le domaine olycity.fr, GitHub
 * Pages répond `301` sur l'ancienne adresse liam-thorel.github.io/OLYVALO :
 * sans ce module, l'assistant d'installation ne pouvait plus lire le roster,
 * et un nouveau poste ne pouvait pas choisir son membre.
 */

const MAX_REDIRECTS = 3;
const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);

/**
 * Adresse suivante, ou null si la réponse n'est pas une redirection à suivre.
 *
 * Uniquement vers https : une redirection vers http ferait transiter le
 * roster en clair, et vers un autre protocole n'a aucun sens ici.
 */
function redirectTarget(currentUrl, statusCode, location) {
  if (!REDIRECT_CODES.has(Number(statusCode)) || !location) return null;
  let next;
  try {
    next = new URL(String(location), currentUrl);
  } catch {
    return null;
  }
  return next.protocol === 'https:' ? next.href : null;
}

module.exports = { redirectTarget, MAX_REDIRECTS };
