import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * La purge de version vide le localStorage à chaque déploiement, pour qu'un
 * ancien format de données ne fasse pas planter le nouveau code. Elle emportait
 * aussi ce que l'utilisateur avait SAISI : sa clé API HenrikDev, les joueurs
 * ajoutés à la main, son thème.
 *
 * Résultat côté roster : après chaque mise en ligne, toutes les cartes se
 * vidaient d'un coup, sans que rien n'explique pourquoi. On croyait à une
 * panne de l'API.
 *
 * Ce test lit la liste directement dans la source. Une liste de ce genre se
 * re-casse en y ajoutant une clé sans penser à celle-ci.
 */
const source = readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');

const bloc = source.match(/const KEEP_ACROSS_VERSIONS = new Set\(\[([\s\S]*?)\]\);/);
assert.ok(bloc, 'la liste des clés épargnées doit rester repérable dans main.js');
// Les commentaires du bloc contiennent des apostrophes françaises ; les lire
// comme des chaînes décalerait toutes les paires de quotes.
const sansCommentaires = bloc[1].replace(/\/\/[^\n]*/g, '');
const gardees = new Set([...sansCommentaires.matchAll(/'([^']+)'/g)].map(match => match[1]));

// Saisi ou choisi par l'utilisateur : rien ne permet de le reconstruire.
[
  ['olycity-henrik-key', 'la clé API collée à la main'],
  ['olycity-custom-players', 'les joueurs ajoutés depuis la carte « NOUVEAU »'],
  ['olycity-theme', 'le thème choisi'],
  ['olycity-profile', 'le profil sélectionné'],
  ['olycity-player-stats', 'une synchro Henrik complète par joueur'],
].forEach(([cle, pourquoi]) => {
  assert.ok(gardees.has(cle), `${cle} doit survivre au changement de version — ${pourquoi}`);
});

// La purge doit rester une purge : sans elle, un ancien format de cache
// survivrait à la mise à jour censée le remplacer.
assert.ok(/KEEP_ACROSS_VERSIONS\.has\(k\)/.test(source), 'la liste doit bien être celle que la purge consulte');
assert.ok(!gardees.has('olycity-version'), 'la clé de version elle-même est réécrite, pas épargnée');
assert.ok(gardees.size < 20, 'épargner tout reviendrait à supprimer la purge');

console.log('version-purge: la clé API et les joueurs ajoutés survivent au déploiement');
