import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { hubLogoRect, landingAngle, startTransform, isPlainClick, arrivalUrl, restoreHubTransition } from '../js/hub-transition.mjs';

// Transition tracker → olycity.fr. La position d'arrivée reproduit le CSS du
// hub (olycity-hub/index.html) ; vérifiée de bout en bout dans Chromium à
// 1280×800 et 390×780 : 0 px d'écart avec la roue du hub une fois chargé.

test('la roue atterrit là où le hub la dessine', () => {
  // Bureau : largeur plafonnée à 112 px, marge haute 8vh.
  assert.deepEqual(hubLogoRect({ innerWidth: 1280, innerHeight: 800 }),
    { left: 584, top: 64, width: 112, height: 123.2 });
  // Mobile : largeur plancher 84 px.
  const mobile = hubLogoRect({ innerWidth: 390, innerHeight: 780 });
  assert.equal(mobile.width, 84);
  assert.equal(mobile.left, 153);
  assert.ok(Math.abs(mobile.top - 62.4) < 1e-9);
  // Très grand écran : marge haute plafonnée à 96 px.
  assert.equal(hubLogoRect({ innerWidth: 2560, innerHeight: 1440 }).top, 96);
  // Très petit écran : plancher de 40 px.
  assert.equal(hubLogoRect({ innerWidth: 320, innerHeight: 400 }).top, 40);
});

test('le centrage tient compte de la barre de défilement, pas la taille', () => {
  // vw inclut la barre, le centrage non : avec 17 px de barre, la roue reste
  // centrée sur la zone visible.
  const rect = hubLogoRect({ innerWidth: 1297, innerHeight: 800, clientWidth: 1280 });
  assert.equal(rect.width, 112);
  assert.equal(rect.left, 584);
});

test('la roue finit sur un tour complet, l’angle où celle du hub démarre', () => {
  for (const start of [0, 10, 179, 180, 181, 359.9]) {
    const end = landingAngle(start);
    assert.equal(end % 360, 0, `départ ${start}°`);
    assert.ok(end - start >= 180, 'au moins un demi-tour : la roue tourne en grandissant');
    assert.ok(end - start < 540, 'pas plus d’un tour et demi : sinon elle s’emballe');
  }
});

test('le vol part exactement de la roue du tracker', () => {
  const from = { left: 18, top: 11, width: 36 };
  const to = { left: 584, top: 64, width: 112 };
  assert.equal(startTransform(from, to), `translate(-566px, -53px) scale(${36 / 112})`);
});

test('ctrl, maj, molette… gardent le comportement normal du lien', () => {
  assert.equal(isPlainClick({ button: 0 }), true);
  assert.equal(isPlainClick({ button: 1 }), false, 'clic molette : nouvel onglet');
  for (const key of ['metaKey', 'ctrlKey', 'shiftKey', 'altKey']) {
    assert.equal(isPlainClick({ button: 0, [key]: true }), false, key);
  }
});

test('le hub sait qu’il accueille la roue, par une adresse propre', () => {
  assert.equal(arrivalUrl('https://olycity.fr/'), 'https://olycity.fr/?roue');
  assert.equal(arrivalUrl('https://olycity.fr/#x'), 'https://olycity.fr/?roue#x');
});

test('câblage : lien, angle de la roue et initialisation', () => {
  const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
  assert.match(read('../index.html'), /<a class="brand" href="https:\/\/olycity\.fr"/);
  assert.match(read('../js/interactions.js'), /canvas\.wheelAngle = angle;/,
    'sans l’angle, la roue sauterait au moment où la copie la remplace');
  const main = read('../js/main.js');
  assert.match(main, /import \{ initHubTransition \} from '\.\/hub-transition\.mjs/);
  assert.match(main, /initWheelLogos\(\);\r?\n\s*initHubTransition\(\);/);
  const module = read('../js/hub-transition.mjs');
  assert.match(module, /prefers-reduced-motion: reduce/, 'mouvement réduit : lien normal');
  assert.match(module, /addEventListener\('pageshow'/, 'retour arrière : la page ne reste pas masquée');
  assert.match(module, /replace\(\/<defs>/, 'la feuille de style du SVG n’est pas injectée dans le tracker');
});

test('restauration : annule le fondu persistant et retire les copies sans toucher aux autres animations', () => {
  let cancelled = 0;
  let removed = 0;
  const canvas = { style: { opacity: '0' } };
  const nodes = [{ remove() { removed++; } }, { remove() { removed++; } }];
  restoreHubTransition(canvas, nodes, { cancel() { cancelled++; } });
  assert.equal(cancelled, 1);
  assert.equal(removed, 2);
  assert.equal(nodes.length, 0);
  assert.equal(canvas.style.opacity, '');
  restoreHubTransition(canvas, nodes, null);
  assert.equal(removed, 2, 'restaurer deux fois est sans effet secondaire');
});
