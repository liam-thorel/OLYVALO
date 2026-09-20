import assert from 'node:assert/strict';
import { syncEndpoints, currentRiotId, observedPuuid, joinRiotId, wasRenamed } from '../js/henrik-endpoints.mjs';

// ─── Le PUUID d'abord, toujours ──────────────────────────────────────────────
// Un compte renommé répondait 404 sur `name/tag` et sa carte restait vide pour
// toujours. « Wong Chi Ming#2046 » est devenu « FakePlasticTrees#1706 » : le
// dépôt déclare encore l'ancien, le PUUID n'a pas bougé.
const parPuuid = syncEndpoints({ puuid: 'facae061-6042-55eb-b88a-14d58be02fe3', name: 'Wong Chi Ming', tag: '2046', region: 'eu' });
assert.equal(parPuuid.byPuuid, true);
assert.equal(parPuuid.mmr, '/v3/by-puuid/mmr/eu/pc/facae061-6042-55eb-b88a-14d58be02fe3');
assert.equal(parPuuid.matches, '/v4/by-puuid/matches/eu/pc/facae061-6042-55eb-b88a-14d58be02fe3');
assert.equal(parPuuid.account, '/v1/by-puuid/account/facae061-6042-55eb-b88a-14d58be02fe3');
Object.values(parPuuid).filter(value => typeof value === 'string')
  .forEach(path => assert.doesNotMatch(path, /Wong|2046/, 'le pseudo périmé ne doit apparaître dans AUCUN appel'));

// Sans PUUID, le Riot ID sert encore à amorcer — c'est le seul moyen d'en
// obtenir un pour un compte qui n'en a pas.
const parNom = syncEndpoints({ name: 'RayBaz', tag: 'OLY', region: 'eu' });
assert.equal(parNom.byPuuid, false);
assert.equal(parNom.mmr, '/v3/mmr/eu/pc/RayBaz/OLY');
assert.equal(parNom.matches, '/v4/matches/eu/pc/RayBaz/OLY');

// Un nom à espaces ou à dièse casserait l'URL sans encodage.
assert.match(syncEndpoints({ name: 'Drew A Picasso', tag: 'XOOO' }).mmr, /Drew%20A%20Picasso\/XOOO/);
assert.match(syncEndpoints({ puuid: 'a/b c' }).mmr, /a%2Fb%20c/);

// Ni PUUID ni Riot ID complet : rien à interroger, et il faut le dire plutôt
// que de fabriquer une URL qui répondra 404.
assert.equal(syncEndpoints({ name: 'Seul' }), null, 'un nom sans tag ne suffit pas');
assert.equal(syncEndpoints({}), null);
assert.equal(syncEndpoints({ tag: 'OLY' }), null);

// Le PUUID l'emporte même quand les deux sont fournis.
assert.equal(syncEndpoints({ puuid: 'p', name: 'x', tag: 'y' }).byPuuid, true);
// Région par défaut plutôt qu'une URL trouée.
assert.match(syncEndpoints({ puuid: 'p', region: '' }).mmr, /\/eu\/pc\//);

console.log('henrik-endpoints: tout passe par le PUUID dès qu’il est connu');

// ─── Le nom COURANT, jamais celui du dépôt ───────────────────────────────────
const mmr = { data: { account: { name: 'FakePlasticTrees', tag: '1706', puuid: 'facae061' } } };
assert.equal(currentRiotId({ mmr, fallback: 'Wong Chi Ming#2046' }), 'FakePlasticTrees#1706',
  'le pseudo du dépôt ne doit jamais masquer celui que Riot renvoie');
assert.equal(observedPuuid({ mmr }), 'facae061');

// La réponse MMR suffit d'ordinaire : un appel de moins sur une clé limitée.
// Quand elle ne porte pas le compte, l'endpoint account prend le relais.
const account = { data: { name: 'FakePlasticTrees', tag: '1706', puuid: 'facae061' } };
assert.equal(currentRiotId({ mmr: { data: {} }, account, fallback: 'Wong Chi Ming#2046' }), 'FakePlasticTrees#1706');
assert.equal(observedPuuid({ mmr: { data: {} }, account }), 'facae061');

// Dernier recours seulement : si l'API n'a rien dit, mieux vaut l'ancien
// pseudo qu'une carte sans identité.
assert.equal(currentRiotId({ fallback: 'RayBaz#OLY' }), 'RayBaz#OLY');
assert.equal(currentRiotId({}), '');
assert.equal(observedPuuid({ fallback: 'declare' }), 'declare');

// Un nom sans tag reste un identifiant utilisable, pas « nom# ».
assert.equal(joinRiotId('FakePlasticTrees', ''), 'FakePlasticTrees');
assert.equal(joinRiotId('', '1706'), '');
assert.equal(joinRiotId(' Nom ', ' TAG '), 'Nom#TAG');

// ─── Renommage ───────────────────────────────────────────────────────────────
assert.equal(wasRenamed('Wong Chi Ming#2046', 'FakePlasticTrees#1706'), true);
assert.equal(wasRenamed('RayBaz#OLY', 'RayBaz#OLY'), false);
assert.equal(wasRenamed('RayBaz#OLY', 'raybaz#oly'), false,
  'Riot laisse changer la casse : le signaler apprendrait à ignorer le signal');
assert.equal(wasRenamed('', 'FakePlasticTrees#1706'), false, 'rien de déclaré, rien à signaler');
assert.equal(wasRenamed('Wong Chi Ming#2046', ''), false, 'rien d’observé, rien à signaler');

console.log('henrik-endpoints: le Riot ID affiché est celui que Riot renvoie');
