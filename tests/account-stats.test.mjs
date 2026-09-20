import assert from 'node:assert/strict';
import { statsKey, readStats, writeStats, selectedAccount, toggleSelection, needsSync } from '../js/account-stats.mjs';

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

console.log('account-stats: un compte par PUUID, le smurf n’écrase plus le main');
