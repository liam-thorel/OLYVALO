import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

/**
 * Aucun secret ne doit atteindre le site public.
 *
 * GitHub Pages sert tout ce qui entre dans `_site`, et le dépôt est public :
 * une clé livrée avec le bundle est lisible dans les DevTools par n'importe
 * quel visiteur. Une clé HenrikDev ramassée, c'est le quota du roster qui
 * saute — et HenrikDev peut la révoquer.
 *
 * Le déploiement injectait `secrets.HENRIK_API_KEY` dans `_site/config.js`.
 * Il ne le fait plus : la clé reste dans le secret d'Actions, et c'est la
 * synchronisation planifiée qui s'en sert pour publier dans `rosterStats/`,
 * d'où le site lit sans clé.
 *
 * Ce test existe parce que c'est exactement le genre de ligne qu'on remet
 * « juste pour dépanner », un soir, et qui reste.
 */
const lire = fichier => readFileSync(new URL(`../.github/workflows/${fichier}`, import.meta.url), 'utf8');

const pages = lire('pages.yml');
assert.doesNotMatch(pages, /HENRIK_API_KEY: \$\{\{ secrets\./,
  'le déploiement du site ne doit plus recevoir la clé HenrikDev');
assert.doesNotMatch(pages, /HENRIK_API_KEY: %s/, 'ni l’écrire dans config.js');
// Et le déploiement échoue si elle y repasse, plutôt que de la publier en silence.
assert.match(pages, /! grep -qi 'HENRIK' _site\/config\.js/,
  'un secret qui reviendrait doit faire échouer le déploiement');

// Un seul workflow reçoit la clé, et c'est celui qui ne publie rien sur le site.
const workflows = readdirSync(new URL('../.github/workflows/', import.meta.url)).filter(f => f.endsWith('.yml'));
const porteurs = workflows.filter(f => /secrets\.HENRIK_API_KEY/.test(lire(f)));
assert.deepEqual(porteurs, ['sync-stats.yml'], 'la clé ne circule que dans la synchronisation planifiée');

const sync = lire('sync-stats.yml');
assert.match(sync, /permissions:\s*\n\s*contents: read/, 'aucune écriture sur le dépôt n’est nécessaire');
assert.match(sync, /concurrency:/, 'deux passages simultanés interrogeraient l’API deux fois pour rien');
assert.match(sync, /::error::Secret HENRIK_API_KEY absent/, 'un secret manquant se voit, il ne passe pas en silence');

// Le dépôt étant public, la clé ne doit se trouver nulle part dans les sources.
const suspects = ['js', 'tools', 'data', 'discord-bot'].flatMap(dossier =>
  readdirSync(new URL(`../${dossier}/`, import.meta.url))
    .filter(nom => /\.(mjs|js|json)$/.test(nom))
    .map(nom => [`${dossier}/${nom}`, readFileSync(new URL(`../${dossier}/${nom}`, import.meta.url), 'utf8')]));
const fuites = suspects.filter(([, contenu]) => /HDEV-[A-Za-z0-9]{8}/.test(contenu)).map(([nom]) => nom);
assert.deepEqual(fuites, [], `une clé HenrikDev est commitée :\n${fuites.join('\n')}`);

// La clé injectée ne doit pas pouvoir venir du site : rien n'appelle useApiKey
// dans le code chargé par le navigateur.
const modulesSite = readdirSync(new URL('../js/', import.meta.url)).filter(nom => /\.(mjs|js)$/.test(nom));
const appelants = modulesSite.filter(nom =>
  nom !== 'henrik-key.mjs'
  && /(?<![.\w])useApiKey\s*\(/.test(readFileSync(new URL(`../js/${nom}`, import.meta.url), 'utf8')));
assert.deepEqual(appelants, [], 'useApiKey n’est appelé que par l’outil hors navigateur');

console.log(`no-secret-on-site: ${workflows.length} workflows vérifiés, la clé ne quitte pas Actions`);
