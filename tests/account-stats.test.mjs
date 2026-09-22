import assert from 'node:assert/strict';
import { statsKey, readStats, writeStats, selectedAccount, toggleSelection, needsSync,
  firebasePath, publishable, remoteStats, mergeStores } from '../js/account-stats.mjs';

const main = { riotId: 'Wong Chi Ming#2046', puuid: 'facae061', isMain: true };
const smurf = { riotId: 'Xi Jinping#5378', puuid: '7624d420', isMain: false };
const sansPuuid = { riotId: 'RayBaz#OLY', puuid: '', isMain: true };

// ─── La clé est le PUUID ─────────────────────────────────────────────────────
assert.equal(statsKey(main), 'puuid:facae061');
assert.equal(statsKey({ ...main, riotId: 'FakePlasticTrees#1706' }), 'puuid:facae061',
  'un renommage ne déplace pas les stats : le PUUID ne bouge pas');
assert.equal(statsKey(sansPuuid), 'riot:raybaz#oly', 'sans PUUID, le Riot ID — c’est tout ce qu’on a');
assert.equal(statsKey({ riotId: 'RayBaz#OLY' }), statsKey({ riotId: 'raybaz#oly' }), 'la casse ne crée pas deux comptes');
assert.equal(statsKey({}), '', 'un compte sans identité n’est rangeable nulle part');
assert.notEqual(statsKey({ puuid: 'abc' }), statsKey({ riotId: 'abc' }),
  'un Riot ID qui ressemble à un PUUID ne doit pas écraser celui d’un autre compte');

// ─── Un compte n'écrase plus l'autre ─────────────────────────────────────────
// Rangées sous le nom du membre, les stats du smurf remplaçaient celles du
// main : synchroniser l'un effaçait l'autre.
let store = {};
store = writeStats(store, main, { rank: 'Immortel 1', syncedAt: 10 });
store = writeStats(store, smurf, { rank: 'Or 2', syncedAt: 20 });
assert.equal(readStats(store, main).rank, 'Immortel 1');
assert.equal(readStats(store, smurf).rank, 'Or 2', 'les deux coexistent');

// Le magasin précédent n'est pas modifié : il est partagé avec le rendu.
const avant = writeStats({}, main, { rank: 'Fer 1' });
const apres = writeStats(avant, smurf, { rank: 'Or 2' });
assert.equal(Object.keys(avant).length, 1, 'écrire ne mute pas le magasin d’avant');
assert.equal(Object.keys(apres).length, 2);
assert.equal(writeStats(store, {}, { rank: 'x' }), store, 'un compte sans clé n’écrit rien');

// ─── Les synchros déjà faites ne sont pas jetées ─────────────────────────────
// Une synchro paginée par joueur sur une clé limitée en débit : les
// redemander à tout le monde pour un changement de format serait gratuit.
const legacy = { Liam: { rank: 'Ascendant 2', syncedAt: 5 } };
assert.equal(readStats({}, main, { legacy, memberName: 'Liam' }).rank, 'Ascendant 2',
  'l’ancien format décrit le compte principal');
assert.equal(readStats({}, smurf, { legacy, memberName: 'Liam' }), null,
  'l’attribuer au smurf lui prêterait le rang de quelqu’un d’autre');
assert.equal(readStats(store, main, { legacy, memberName: 'Liam' }).rank, 'Immortel 1',
  'une vraie synchro par PUUID prime sur l’ancien format');
assert.equal(readStats({}, main, { legacy, memberName: 'Inconnu' }), null);

// ─── Sélection ───────────────────────────────────────────────────────────────
const comptes = [main, smurf];
assert.equal(selectedAccount(comptes, ''), main, 'par défaut, le compte principal');
assert.equal(selectedAccount(comptes, statsKey(smurf)), smurf);
assert.equal(selectedAccount(comptes, 'puuid:disparu'), main,
  'un smurf masqué entre-temps ne doit pas laisser une carte vide');
assert.equal(selectedAccount([], 'peu importe'), null);

// Recliquer sur le compte affiché ramène au principal — le geste attendu pour
// « revenir », sans bouton de retour à expliquer.
assert.equal(toggleSelection('', 'puuid:7624d420'), 'puuid:7624d420');
assert.equal(toggleSelection('puuid:7624d420', 'puuid:7624d420'), '', 'reclic = retour au main');
assert.equal(toggleSelection('puuid:7624d420', 'puuid:autre'), 'puuid:autre', 'on passe d’un smurf à l’autre');
assert.equal(toggleSelection('puuid:7624d420', ''), '', 'un clic sans compte ne bloque pas la carte');

// ─── Quand resynchroniser ────────────────────────────────────────────────────
const MAINTENANT = 1_000_000_000;
assert.equal(needsSync(null, MAINTENANT), true, 'jamais synchronisé');
assert.equal(needsSync({ syncedAt: MAINTENANT - 60_000 }, MAINTENANT), false,
  'un aller-retour entre deux comptes ne doit pas brûler le quota');
assert.equal(needsSync({ syncedAt: MAINTENANT - 30 * 60_000 }, MAINTENANT), true);
assert.equal(needsSync({ syncedAt: 0 }, MAINTENANT), true);

// ─── Partage entre le navigateur et l'overlay ───────────────────────────────
// Les stats vivaient dans le localStorage, propre à chaque navigateur. Le site
// et l'overlay en avaient donc DEUX copies qui ne se parlaient jamais :
// l'overlay affichait des stats vieilles de cinq jours et un pseudo périmé,
// sans pouvoir se rattraper faute de clé API.

// Les clés Firebase interdisent . # $ [ ] / — or une clé de repli en contient.
assert.equal(firebasePath('puuid:facae061'), 'puuid:facae061');
assert.equal(firebasePath('riot:raybaz#oly'), 'riot:raybaz_oly');
assert.doesNotMatch(firebasePath('riot:a.b#c$d[e]f/g'), /[.#$[\]/]/);

// La transformation n'est pas réversible : la clé canonique voyage DANS
// l'enregistrement, et c'est elle qui sert à reclasser au retour.
const aPublier = publishable(main, { rank: 'Immortel 1', syncedAt: 1000, riotId: 'FakePlasticTrees#1706' });
assert.equal(aPublier.key, 'puuid:facae061');
assert.equal(aPublier.riotId, 'FakePlasticTrees#1706');
assert.equal(aPublier.rank, 'Immortel 1');
assert.equal(publishable(main, { rank: 'x' }), null, 'sans date de synchro, rien à publier');
assert.equal(publishable({}, { syncedAt: 1 }), null, 'sans identité non plus');

// Ce qui revient de la base, ouverte en écriture, est validé.
const distant = remoteStats({
  'puuid:facae061': { key: 'puuid:facae061', rank: 'Radiant', syncedAt: 5000 },
  'sans-cle': { rank: 'Fer 1', syncedAt: 9000 },
  'sans-date': { key: 'puuid:autre', rank: 'Fer 1' },
  'pas-un-objet': 'bonjour',
  'date-illisible': { key: 'puuid:x', syncedAt: 'hier' },
});
assert.deepEqual(Object.keys(distant), ['puuid:facae061'], 'seul un enregistrement rangeable et datable survit');
assert.deepEqual(remoteStats(null), {});

// ─── La plus fraîche gagne, compte par compte ───────────────────────────────
// Comparer les dates plutôt que préférer une source par principe : le local
// peut être plus récent (synchro à l'instant), le distant aussi (quelqu'un
// d'autre a synchronisé).
const fusion = mergeStores(
  { 'puuid:a': { rank: 'local-vieux', syncedAt: 100 }, 'puuid:b': { rank: 'local-frais', syncedAt: 900 } },
  { 'puuid:a': { rank: 'distant-frais', syncedAt: 500 }, 'puuid:b': { rank: 'distant-vieux', syncedAt: 200 },
    'puuid:c': { rank: 'connu-de-lui-seul', syncedAt: 300 } },
);
assert.equal(fusion['puuid:a'].rank, 'distant-frais', 'le distant plus récent l’emporte');
assert.equal(fusion['puuid:b'].rank, 'local-frais', 'et le local aussi, quand c’est lui le plus récent');
assert.equal(fusion['puuid:c'].rank, 'connu-de-lui-seul', 'un compte synchronisé par un autre apparaît');

// Le magasin d'origine n'est pas modifié : il est partagé avec le rendu.
const avantFusion = { 'puuid:a': { syncedAt: 1 } };
mergeStores(avantFusion, { 'puuid:a': { syncedAt: 2 } });
assert.equal(avantFusion['puuid:a'].syncedAt, 1);
assert.deepEqual(mergeStores({}, {}), {});
assert.deepEqual(Object.keys(mergeStores({ x: { syncedAt: 1 } }, {})), ['x'], 'sans distant, le local suffit');

console.log('account-stats: un compte par PUUID, le smurf n’écrase plus le main');
console.log('account-stats: navigateur et overlay partagent la synchro la plus fraîche');
