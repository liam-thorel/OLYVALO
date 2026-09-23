import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * D'où viennent les notes attachées à une release.
 *
 * Le checkout est fait AU TAG. Or les notes sont de la prose : elles sont
 * souvent finalisées après coup. La v4.19.0 est ainsi partie avec les notes de
 * la v4.18.0 — le tag avait été posé avant que je les écrive.
 *
 * Règle : les notes du tag font foi QUAND elles portent le bon marqueur ; sinon
 * on va chercher celles de la branche par défaut. Le tag ne peut pas bouger,
 * la prose si.
 */
const yaml = readFileSync(new URL('../.github/workflows/release-live.yml', import.meta.url), 'utf8').replace(/\r\n?/g, '\n');

// Le marqueur du tag décide : il n'est plus question de prendre aveuglément
// `live/RELEASE-NOTES.md` du checkout.
assert.match(yaml, /if \[ "\$\(marque "\$fichier"\)" = "\$version" \]/,
  'les notes du tag ne sont retenues que si leur marqueur correspond');
assert.match(yaml, /github\.event\.repository\.default_branch/,
  'sinon on lit celles de la branche par défaut');
assert.match(yaml, /contents\/live\/RELEASE-NOTES\.md\?ref=\$branche/);
assert.match(yaml, /notes='\$\{\{ steps\.notes\.outputs\.file \}\}'/);

// Plus aucune étape ne pointe en dur sur le fichier du checkout : c'est ce
// codage en dur qui a publié les notes de la 4.18 sur la 4.19.
const televersement = yaml.slice(yaml.indexOf('Téléverser sur la release'));
assert.doesNotMatch(televersement, /--notes-file live\/RELEASE-NOTES\.md/,
  'le téléversement doit utiliser le fichier choisi, pas celui du tag');
assert.equal((televersement.match(/--notes-file "\$notes"/g) || []).length, 2,
  'à la création comme à la correction');

// Réécrire une release déjà publiée ÉCRASE : ça doit rester un geste explicite,
// jamais un effet de bord d'un simple repackaging.
assert.match(yaml, /force_notes:\n\s*description:.*\n\s*type: boolean\n\s*default: false/,
  'l’écrasement est opt-in et par défaut désactivé');
assert.match(yaml, /if \[ -z "\$corps" \] \|\| \[ '\$\{\{ inputs\.force_notes \}\}' = 'true' \]/,
  'sans la case cochée, un corps existant n’est jamais remplacé');

// Le cas sans marqueur nulle part ne doit pas bloquer : c'est celui de toutes
// les releases antérieures à la convention.
assert.match(yaml, /::warning::Aucune version de RELEASE-NOTES\.md ne porte le marqueur/);
assert.doesNotMatch(yaml.slice(yaml.indexOf('Choisir les notes')), /exit 1/,
  'choisir des notes ne doit jamais faire échouer la publication');

console.log('release-notes-source: le tag fait foi s’il est marqué, sinon la branche par défaut');
