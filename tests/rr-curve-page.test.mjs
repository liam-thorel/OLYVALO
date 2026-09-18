import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const read = file => readFileSync(path.join(root, '..', file), 'utf8');

const html = read('index.html');
const main = read('js/main.js');
const page = read('js/rr-curve-page.mjs');
const css = read('css/layout.css');

// ─── La page doit être atteignable ───────────────────────────────────────────
// Un onglet peut être parfaitement écrit et rester invisible : il suffit qu'un
// seul des cinq points de câblage manque.
assert.match(html, /<div id="page-courbes" class="spa-page">/, 'la section existe');
assert.match(html, /id="curves-content"/, 'le conteneur que la page remplit');
assert.match(html, /data-page="courbes"/, 'le bouton de navigation');
assert.match(html, /nav\('courbes'\)/);
assert.match(html, /<symbol id="oly-icon-curves"/, 'l’icône référencée par le bouton');
assert.match(html, /href="#oly-icon-curves"/);

assert.match(main, /import \{ initRrCurvePage \} from '\.\/rr-curve-page\.mjs/);
assert.match(main, /if \(page === 'courbes'\) \{\s*initRrCurvePage\(\);/, 'la navigation initialise la page');
assert.match(main, /courbes: 'OLYCITY — Courbes'/, 'titre du document');

// Les listes de routes doivent TOUTES connaître la page. Il y en a trois —
// la validation de nav(), la lecture du hash au chargement, et la page
// restaurée depuis sessionStorage. En oublier une donne un onglet qui marche
// au clic mais retombe sur l'accueil au F5 ou sur un lien direct #courbes.
// `'history'` distingue les listes de ROUTES du regroupement du menu mobile
// (`morePages`), qui n'a rien à valider.
const routeLists = [...main.matchAll(/\[[^\]]*'history'[^\]]*'betting'[^\]]*\]/g)].map(m => m[0]);
assert.equal(routeLists.length, 3, 'les trois listes de routes sont bien trouvées');
routeLists.forEach(list => assert.ok(list.includes('courbes'), `route manquante dans ${list}`));

// ─── La page lit les bonnes sources ──────────────────────────────────────────
assert.match(page, /live\/lolHistory' : 'live\/history'/, 'un historique par jeu');
assert.match(page, /data\/roster\.json/, 'le roster porte la séparation main / smurfs');
// Les séries viennent du module pur : c'est lui qui est testé.
assert.match(page, /from '\.\/rr-curve-utils\.mjs/);
assert.match(page, /valorantAccountSeries|lolAccountSeries/);

// Le balisage vit dans un module de vue sans DOM : c'est lui que teste
// rr-curve-view.test.mjs, et lui qu'affiche l'aperçu de conception.
assert.match(page, /from '\.\/rr-curve-view\.mjs/);
assert.match(page, /renderCurvePage\(\{ allSeries, visible, presets, activePreset, game \}\)/);

// ─── Ouverture sur les comptes principaux ────────────────────────────────────
assert.match(page, /activePreset = presets\[0\]\?\.id \|\| 'mains'/, 'on ouvre sur les mains');

// ─── Mise en forme présente ──────────────────────────────────────────────────
['.curve-presets', '.curve-chart', '.curve-legend-item', '.curve-legend-dot.smurf', '.curve-empty']
  .forEach(selector => assert.ok(css.includes(selector), `${selector} doit être stylé`));
// Le SVG se redimensionne par son viewBox : sans largeur fluide il déborderait
// sur téléphone.
assert.match(css, /\.curve-chart\{[^}]*width:100%/);

console.log('rr-curve-page: onglet câblé de bout en bout, sources et échappement vérifiés');

// ─── Mobile ──────────────────────────────────────────────────────────────────
// La barre mobile ne tient que cinq entrées : une sixième chasserait les
// autres. Courbes passe donc par la feuille « Plus », comme roster, jeux et
// paris — et le bouton « Plus » doit s'allumer quand la page est ouverte.
const responsive = read('css/responsive.css');
assert.match(responsive, /\.page-nav > \.page-nav-btn\[data-page="courbes"\]/, 'bouton masqué de la barre mobile');
assert.match(html, /data-mobile-page="courbes"/, 'entrée dans la feuille « Plus »');
assert.match(main, /morePages = \['roster', 'courbes', 'games', 'betting'\]/);

console.log('rr-curve-page: navigation mobile validée');
