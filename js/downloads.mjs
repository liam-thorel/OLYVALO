/**
 * Le bouton de téléchargement de la page Live rapporte les deux éléments :
 * l'installeur de l'overlay et l'archive du script.
 *
 * Le lien « Mettre à jour » voisin n'apparaît que lorsqu'un script DÉJÀ
 * installé est périmé : quelqu'un qui n'a jamais rien installé n'avait aucun
 * moyen de récupérer le script depuis le site.
 */

const RELEASE_BASE = 'https://github.com/liam-thorel/OLYVALO/releases/latest/download';

export const BUNDLE = Object.freeze([
  Object.freeze({ name: 'OLYCITY-Overlay-Setup.exe', url: `${RELEASE_BASE}/OLYCITY-Overlay-Setup.exe` }),
  Object.freeze({ name: 'OLYCITY-Live.zip', url: `${RELEASE_BASE}/OLYCITY-Live.zip` }),
]);

// Les navigateurs regroupent les téléchargements lancés coup sur coup et
// n'en gardent parfois qu'un : on les espace.
const SPACING_MS = 600;

function triggerDownload(document_, { url, name }) {
  const anchor = document_.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.rel = 'noopener';
  document_.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

/**
 * Lance les téléchargements dans l'ordre. Retourne une promesse résolue quand
 * tous ont été déclenchés — utile pour les tests, l'appelant n'a pas à attendre.
 */
export function downloadBundle(document_ = globalThis.document, files = BUNDLE, delay = SPACING_MS) {
  return files.reduce((chain, file, index) => chain.then(() => {
    triggerDownload(document_, file);
    // Pas d'attente après le dernier : rien ne suit.
    if (index === files.length - 1) return undefined;
    return new Promise(resolve => setTimeout(resolve, delay));
  }), Promise.resolve());
}

export function wireDownloadButton(document_ = globalThis.document) {
  const button = document_.getElementById('overlay-download-link');
  if (!button) return false;
  button.addEventListener('click', event => {
    // On prend la main sur le comportement natif du lien : sans ça le
    // navigateur ne récupérerait que l'overlay, pointé par son href.
    event.preventDefault();
    downloadBundle(document_);
  });
  return true;
}
