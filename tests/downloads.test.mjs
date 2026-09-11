import assert from 'node:assert/strict';
import { BUNDLE, downloadBundle, wireDownloadButton } from '../js/downloads.mjs';

// Le lien « Mettre à jour » de la page Live n'apparaît que lorsqu'un script
// DÉJÀ installé est périmé. Quelqu'un qui n'a jamais rien installé n'avait
// aucun moyen de récupérer le script : le bouton doit rapporter les deux.

// ─── Ce qui est téléchargé ───────────────────────────────────────────────────
assert.equal(BUNDLE.length, 2);
assert.deepEqual(BUNDLE.map(file => file.name),
  ['OLYCITY-Overlay-Setup.exe', 'OLYCITY-Live.zip']);

// URLs sans version : GitHub redirige /releases/latest/download/ vers la
// dernière release, la page n'a donc pas à être modifiée à chaque publication.
BUNDLE.forEach(file => {
  assert.match(file.url, /^https:\/\/github\.com\/liam-thorel\/OLYVALO\/releases\/latest\/download\//);
  assert.ok(file.url.endsWith(file.name), `${file.name} doit correspondre à son URL`);
});

// ─── DOM minimal ─────────────────────────────────────────────────────────────
function fakeDocument() {
  const clicked = [];
  const body = { appendChild() {}, };
  const listeners = new Map();
  const button = {
    id: 'overlay-download-link',
    addEventListener: (type, handler) => listeners.set(type, handler),
  };
  return {
    clicked, listeners, button, body,
    createElement: () => {
      const anchor = { remove() {} };
      Object.defineProperty(anchor, 'click', {
        value: () => clicked.push({ href: anchor.href, download: anchor.download }),
      });
      return anchor;
    },
    getElementById: id => (id === 'overlay-download-link' ? button : null),
  };
}

// ─── Les deux fichiers partent, dans l'ordre ─────────────────────────────────
const doc = fakeDocument();
await downloadBundle(doc, BUNDLE, 0);
assert.deepEqual(doc.clicked.map(a => a.download),
  ['OLYCITY-Overlay-Setup.exe', 'OLYCITY-Live.zip'],
  'les deux téléchargements sont déclenchés, overlay d’abord');
assert.equal(doc.clicked[0].href, BUNDLE[0].url);
assert.equal(doc.clicked[1].href, BUNDLE[1].url);

// L'attribut download doit être posé : sans lui le navigateur peut naviguer
// vers l'URL au lieu de télécharger.
doc.clicked.forEach(anchor => assert.ok(anchor.download, 'attribut download présent'));

// ─── Le clic est intercepté ──────────────────────────────────────────────────
// Sans preventDefault, le navigateur suivrait le href du lien et ne
// récupérerait que l'overlay.
const wired = fakeDocument();
assert.equal(wireDownloadButton(wired), true);
assert.ok(wired.listeners.has('click'), 'un écouteur de clic est posé');

let prevented = false;
wired.listeners.get('click')({ preventDefault: () => { prevented = true; } });
assert.equal(prevented, true, 'le comportement natif du lien est neutralisé');

// ─── Page sans le bouton ─────────────────────────────────────────────────────
// interactions.js appelle wireDownloadButton à chaque rendu du diagnostic :
// il doit pouvoir signaler l'absence sans lever d'exception.
const empty = { getElementById: () => null };
assert.equal(wireDownloadButton(empty), false);

console.log('downloads: le bouton rapporte l’overlay ET le script Live');
