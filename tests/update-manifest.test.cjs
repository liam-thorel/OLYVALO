const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const LIVE = path.join(__dirname, '..', 'live');
const manifest = JSON.parse(fs.readFileSync(path.join(LIVE, 'update-manifest.json'), 'utf8'));
const listes = new Set(manifest.files);

/**
 * Tout module require() par le script doit figurer dans le manifeste.
 *
 * Le manifeste est la liste EXHAUSTIVE des fichiers que la mise à jour
 * automatique télécharge. Un fichier neuf oublié ne part pas — et le
 * `require('./lol-keys.js')` du module qui, lui, est bien parti, fait alors
 * planter le script au démarrage. Sur TOUS les postes à la fois, et sans que
 * le poste puisse se réparer : la version suivante ne s'installera pas non
 * plus, puisque le script ne tourne plus pour aller la chercher.
 */
const modules = fs.readdirSync(LIVE).filter(name => name.endsWith('.js'));
const requis = new Set();
modules.forEach(name => {
  const source = fs.readFileSync(path.join(LIVE, name), 'utf8');
  for (const match of source.matchAll(/require\(['"]\.\/([^'"]+)['"]\)/g)) {
    requis.add(match[1].endsWith('.js') ? match[1] : `${match[1]}.js`);
  }
});

// Certains fichiers sont délibérément hors manifeste : ils portent des
// réglages propres au poste et doivent SURVIVRE aux mises à jour.
const LOCAUX = new Set(['identity.js', 'ask-identity.js']);

const oublies = [...requis].filter(name => !listes.has(name) && !LOCAUX.has(name) && fs.existsSync(path.join(LIVE, name)));
assert.deepEqual(oublies, [], `Modules require() mais absents du manifeste :\n${oublies.join('\n')}`);

// L'inverse : un fichier listé mais absent du dépôt ferait échouer le
// téléchargement et annulerait toute la mise à jour.
const fantomes = manifest.files.filter(name => !fs.existsSync(path.join(LIVE, name)));
assert.deepEqual(fantomes, [], `Fichiers listés mais introuvables :\n${fantomes.join('\n')}`);

// Les trois versions doivent coïncider, sinon la mise à jour boucle : le
// manifeste annonce une version que le script installé ne rapporte jamais.
const pkg = JSON.parse(fs.readFileSync(path.join(LIVE, 'package.json'), 'utf8'));
const source = fs.readFileSync(path.join(LIVE, 'index.js'), 'utf8');
const declaree = source.match(/const SCRIPT_VERSION = '([^']+)'/)?.[1];
assert.equal(pkg.version, manifest.version, 'package.json et update-manifest.json divergent');
assert.equal(declaree, manifest.version, 'SCRIPT_VERSION diverge du manifeste');

// Les NOTES de version comptent comme un quatrième emplacement. Elles sont
// parties deux fois en décrivant la version précédente — la v4.18.0 publiée
// avec les notes de la v4.17.11, la v4.19.0 avec celles de la v4.18.0.
// Personne ne s'en aperçoit avant de lire la release, et à ce moment-là elle
// est déjà publiée. Le marqueur rend l'oubli impossible à commettre en
// silence : bumper la version sans toucher aux notes casse ce test.
const notes = fs.readFileSync(path.join(LIVE, 'RELEASE-NOTES.md'), 'utf8');
const marque = notes.match(/^<!-- version: (.+) -->$/m)?.[1];
assert.ok(marque, 'live/RELEASE-NOTES.md doit porter `<!-- version: X -->` en tête');
assert.equal(marque, manifest.version,
  `les notes décrivent la ${marque}, alors que le script est en ${manifest.version}`);
assert.ok(notes.trim().length > 200, 'des notes vides valent une release sans notes');

console.log(`update-manifest: ${manifest.files.length} fichiers, versions alignées sur ${manifest.version}`);
