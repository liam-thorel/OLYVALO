import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Le garde-fou « notes de version » du workflow de release, rejoué tel quel.
 *
 * Il a bloqué le repackaging de la v4.19.0 dès sa première utilisation : le
 * checkout est fait AU TAG, et à ce tag-là le marqueur n'existait pas encore
 * puisqu'il venait d'être introduit. Un marqueur absent ne prouve rien — il
 * fait donc avertir, pas échouer, sinon aucune vieille release ne peut plus
 * être repackagée, ce pour quoi le déclenchement manuel existe précisément.
 *
 * Le test EXTRAIT le script du YAML plutôt que d'en réécrire une copie : une
 * copie diverge, et c'est alors le test qui rassure à tort.
 */
const yaml = readFileSync(new URL('../.github/workflows/release-live.yml', import.meta.url), 'utf8').replace(/\r\n?/g, '\n');
const bash = process.platform === 'win32' ? 'C:\\Program Files\\Git\\bin\\bash.exe' : 'bash';

const bloc = yaml.match(/notes=\$\(sed[\s\S]*?\n          fi\n/);
assert.ok(bloc, 'le garde-fou doit rester repérable dans le workflow');
const script = bloc[0].replace(/^ {10}/gm, '');

const dossier = mkdtempSync(join(tmpdir(), 'olycity-notes-'));
const joue = (contenu, version) => {
  const fichier = join(dossier, 'RELEASE-NOTES.md');
  const fichierShell = fichier.replaceAll('\\', '/');
  writeFileSync(fichier, contenu);
  try {
    const sortie = execFileSync(bash, ['-c', `set -uo pipefail\nversion=${version}\n${script.replace('live/RELEASE-NOTES.md', fichierShell)}`],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { bloque: false, sortie };
  } catch (error) {
    return { bloque: true, sortie: `${error.stdout || ''}${error.stderr || ''}` };
  }
};

// Des notes qui décrivent la version publiée : rien à signaler.
const bon = joue('<!-- version: 4.19.0 -->\nNotes.\n', '4.19.0');
assert.equal(bon.bloque, false);
assert.doesNotMatch(bon.sortie, /::(error|warning)::/, 'aucun bruit quand tout va bien');

// Des notes PÉRIMÉES : c'est la panne qu'on veut empêcher, deux fois survenue.
const perime = joue('<!-- version: 4.18.0 -->\nNotes de la version d’avant.\n', '4.19.0');
assert.equal(perime.bloque, true, 'des notes périmées doivent bloquer la publication');
assert.match(perime.sortie, /::error::.*4\.18\.0.*4\.19\.0/);
// Et le conseil doit être le bon : le tag n'est pas en cause, contrairement à
// ce que disait la première version du garde-fou — elle envoyait supprimer le
// tag ET la release pour un simple oubli de notes.
assert.doesNotMatch(perime.sortie, /supprime la release/, 'ne jamais conseiller de supprimer le tag pour ça');

// Marqueur ABSENT : le cas d'un tag antérieur à son introduction. On avertit.
const absent = joue('Notes sans marqueur, comme à la v4.19.0.\n', '4.19.0');
assert.equal(absent.bloque, false, 'un vieux tag doit rester repackageable');
assert.match(absent.sortie, /::warning::/, 'mais l’absence est signalée');

console.log('release-guard: notes périmées bloquées, marqueur absent seulement signalé');
