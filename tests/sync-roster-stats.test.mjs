import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { accountsToSync, isFatal, shouldAbandon, MAX_ECHECS_IDENTIQUES } from '../tools/sync-roster-stats.mjs';
import { useApiKey, resolveApiKey, storedKey, forgetCachedKey } from '../js/henrik-key.mjs';

/**
 * Synchronisation planifiée : la clé ne sort jamais d'Actions.
 *
 * Le site est public et statique, le dépôt aussi. Une clé livrée avec le
 * bundle est lisible dans les DevTools par n'importe quel visiteur, et une clé
 * ramassée épuise le quota du roster.
 */

// ─── Les mains d'abord ───────────────────────────────────────────────────────
// Si le quota s'épuise en route, mieux vaut avoir rafraîchi les cinq comptes
// principaux que trois smurfs.
const roster = JSON.parse(readFileSync(new URL('../data/roster.json', import.meta.url), 'utf8'));
const comptes = accountsToSync(roster, null);
const premierSmurf = comptes.findIndex(account => !account.isMain);
assert.ok(premierSmurf > 0, 'le jeu de données doit contenir des smurfs, sinon l’ordre ne prouve rien');
assert.ok(comptes.slice(0, premierSmurf).every(account => account.isMain),
  'aucun smurf avant le dernier compte principal');
assert.ok(comptes.slice(premierSmurf).every(account => !account.isMain));

// La région suit le joueur : une mauvaise région renverrait 404.
assert.ok(comptes.every(account => account.region), 'chaque compte porte sa région');
assert.ok(comptes.every(account => account.member), 'et le membre auquel il appartient');

// Un compte sans Riot ID exploitable est écarté : l'API n'aurait rien à
// interroger, et l'appel consommerait le quota pour un 404 certain.
const bancal = accountsToSync([{ name: 'X', riot: { name: 'SansTag' } }], null);
assert.deepEqual(bancal, [], 'un nom sans tag et sans PUUID ne s’interroge pas');
// Sauf s'il a un PUUID : c'est alors lui qui sert, le pseudo ne compte pas.
const parPuuid = accountsToSync([{ name: 'X', riot: { name: 'SansTag', puuid: 'p-x' } }], null);
assert.equal(parPuuid.length, 1);
assert.deepEqual(accountsToSync([], null), []);
assert.deepEqual(accountsToSync(null, null), []);

// Les comptes enregistrés dans l'admin comptent aussi.
const avecAdmin = accountsToSync(
  [{ name: 'Nico', riot: { name: 'A', tag: '1', puuid: 'p-a' } }],
  { accounts: { nico: { x: { name: 'B', tag: '2', puuid: 'p-b' } } } },
);
assert.deepEqual(avecAdmin.map(a => a.riotId), ['A#1', 'B#2']);

// ─── S'arrêter quand la suite échouera pareil ────────────────────────────────
// Trente appels pour rien useraient le quota d'une clé qui marche encore.
assert.equal(isFatal('NO_API_KEY'), true);
assert.equal(isFatal('AUTH_REQUIRED'), true);
// Un compte privé ou introuvable n'est pas fatal : les autres doivent passer.
['COMPTE_PRIVE', 'NOT_FOUND', 'NETWORK', 'RATE_LIMIT'].forEach(message => {
  assert.equal(isFatal(message), false, `${message} ne doit pas interrompre la tournée`);
});

// ─── Huit échecs identiques ne sont pas huit problèmes ──────────────────────
// Ils en décrivent UN seul, commun à tous : clé refusée, hôte injoignable, API
// en panne. Continuer brûle le quota d'une clé limitée, quatre fois par jour,
// et noie la cause réelle sous « 8 comptes privés ».
assert.equal(shouldAbandon(0), false);
assert.equal(shouldAbandon(1), false, 'un compte peut légitimement échouer seul');
assert.equal(shouldAbandon(2), false);
assert.equal(shouldAbandon(MAX_ECHECS_IDENTIQUES), true);
assert.ok(MAX_ECHECS_IDENTIQUES >= 2 && MAX_ECHECS_IDENTIQUES <= 5,
  'trop bas on abandonne sur un hasard, trop haut on brûle le quota pour rien');

// ─── La clé injectée ne vient pas du navigateur ──────────────────────────────
// Le jeu d'essai n'imite volontairement PAS le format `HDEV-…` : le garde-fou
// de tests/henrik-key.test.mjs balaie tout le dépôt à la recherche d'une clé
// en clair, et ne peut pas distinguer une fausse d'une vraie. C'est le bon
// défaut — mieux vaut un test à renommer qu'une clé publiée.
forgetCachedKey();
assert.equal(await resolveApiKey(), '', 'rien par défaut hors navigateur');
useApiKey('cle-de-test-sans-format-reel');
assert.equal(await resolveApiKey(), 'cle-de-test-sans-format-reel');
assert.equal(storedKey(), '', 'le localStorage du navigateur n’est jamais touché');
// Elle prime sur tout : dans Actions il n'y a ni localStorage ni config.js.
useApiKey('  entouree-d-espaces  ');
assert.equal(await resolveApiKey(), 'entouree-d-espaces');
forgetCachedKey();
assert.equal(await resolveApiKey(), '', 'oublier la clé l’oublie vraiment');

console.log('sync-roster-stats: mains d’abord, arrêt sur erreur fatale, clé jamais exposée');
