/**
 * Clé API HenrikDev.
 *
 * Le site est statique et public (GitHub Pages) : une clé livrée dans le bundle
 * est lisible par n'importe quel visiteur dans les DevTools. Il n'existe aucun
 * moyen de l'y cacher — la seule vraie protection serait de passer par un
 * proxy côté serveur.
 *
 * On arrête donc de faire semblant : la clé n'est plus commitée. Chacun
 * renseigne la sienne (gratuite sur api.henrikdev.xyz/dashboard), stockée dans
 * son localStorage. `config.js` reste supporté comme point d'extension pour un
 * déploiement privé, mais il est ignoré par git.
 */

const STORAGE_KEY = 'olycity-henrik-key';

export function storedKey() {
  try {
    return (localStorage.getItem(STORAGE_KEY) || '').trim();
  } catch {
    return '';
  }
}

export function setStoredKey(value) {
  const key = String(value || '').trim();
  try {
    if (key) localStorage.setItem(STORAGE_KEY, key);
    else localStorage.removeItem(STORAGE_KEY);
  } catch { /* navigation privée : la clé vaudra pour la session courante */ }
  cached = key || null;
  return key;
}

let cached = null;

/**
 * Ordre de résolution : clé personnelle du navigateur, puis config.js si le
 * déploiement en fournit un. L'import est dynamique et tolérant à l'absence du
 * fichier — un import statique ferait échouer le chargement de tout le site.
 */
export async function resolveApiKey() {
  if (cached) return cached;

  const local = storedKey();
  if (local) { cached = local; return cached; }

  try {
    const module = await import('../config.js');
    const fromConfig = String(module?.CONFIG?.HENRIK_API_KEY || '').trim();
    // Le gabarit d'exemple ne doit pas être pris pour une vraie clé.
    if (fromConfig && !/^HDEV-X+/i.test(fromConfig)) { cached = fromConfig; return cached; }
  } catch { /* pas de config.js : cas normal du déploiement public */ }

  return '';
}

export function forgetCachedKey() {
  cached = null;
}
