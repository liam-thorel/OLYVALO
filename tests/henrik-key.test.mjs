import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execSync } from 'node:child_process';

const root = new URL('..', import.meta.url);
const read = file => fs.readFileSync(new URL(file, root), 'utf8');

test('aucune clé API n’est livrée dans le dépôt', () => {
  const tracked = execSync('git ls-files', { cwd: new URL('.', root).pathname }).toString().split('\n');
  assert.equal(tracked.includes('config.js'), false, 'config.js ne doit plus être suivi par git');
  assert.match(read('.gitignore'), /^config\.js$/m, 'config.js doit rester ignoré');

  // Un vrai jeton HenrikDev ne doit apparaître dans aucun fichier suivi.
  // Le gabarit `HDEV-XXXX...` de config.example.js est explicitement toléré.
  const suspects = tracked
    .filter(f => f && /\.(js|mjs|cjs|json|html)$/.test(f))
    .filter(f => fs.existsSync(new URL(f, root)))
    .filter(f => /HDEV-(?!X)[A-Za-z0-9]/.test(read(f)));
  assert.deepEqual(suspects, [], `clé HenrikDev en clair dans : ${suspects.join(', ')}`);
});

test('le site ne casse pas quand config.js est absent', () => {
  const henrik = read('js/henrik.js');
  // Un import statique de config.js ferait échouer le chargement de tout le
  // site sur un déploiement public, où le fichier n'existe pas.
  assert.doesNotMatch(henrik, /^import .* from '\.\.\/config\.js'/m);
  assert.match(read('js/henrik-key.mjs'), /await import\('\.\.\/config\.js'\)/);
  assert.match(read('js/henrik-key.mjs'), /catch/);
});

test('une absence de clé est signalée comme telle, pas comme une clé invalide', () => {
  assert.match(read('js/henrik.js'), /NO_API_KEY/);
  const main = read('js/main.js');
  assert.match(main, /NO_API_KEY: 'Pas de clé API'/);
  assert.match(main, /promptHenrikKey/);
});
