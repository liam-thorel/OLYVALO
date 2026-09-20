import assert from 'node:assert/strict';
import { riotIdOf, memberKey, rosterAccounts, cardStatus, isStale } from '../js/roster-card-utils.mjs';

// ─── Riot ID ─────────────────────────────────────────────────────────────────
assert.equal(riotIdOf({ name: 'RayBaz', tag: 'OLY' }), 'RayBaz#OLY');
assert.equal(riotIdOf({ name: 'RayBaz' }), 'RayBaz', 'sans tag, le nom seul — jamais « RayBaz# »');
assert.equal(riotIdOf({ name: '  Wong Chi Ming ', tag: ' 2046 ' }), 'Wong Chi Ming#2046');
assert.equal(riotIdOf(null), '');
assert.equal(riotIdOf({ tag: 'OLY' }), '', 'un tag sans nom ne fait pas un compte');

assert.equal(memberKey('Noé'), 'noe', 'même translittération que member-profiles.mjs');

// ─── Comptes : roster.json ET admin ──────────────────────────────────────────
// Le dépôt déclare le compte principal et les smurfs connus ; l'admin en
// enregistre d'autres. N'en lire qu'une source rendait invisible la moitié des
// comptes — exactement le bug qu'avaient les courbes.
const nico = {
  name: 'Nico',
  riot: { name: 'Drew A Picasso', tag: 'XOOO', puuid: 'puuid-main' },
  smurfs: [{ name: 'OG ANUNOBY', tag: 'OLY', puuid: 'puuid-smurf' }],
};

const seuls = rosterAccounts(nico, null);
assert.deepEqual(seuls.map(a => a.riotId), ['Drew A Picasso#XOOO', 'OG ANUNOBY#OLY']);
assert.deepEqual(seuls.map(a => a.isMain), [true, false], 'le premier compte est le principal');
assert.equal(seuls[1].source, 'roster');

const avecAdmin = rosterAccounts(nico, {
  accounts: { nico: { a: { name: 'Nico Le Troisieme', tag: 'EUW', puuid: 'puuid-3' } } },
});
assert.deepEqual(avecAdmin.map(a => a.riotId),
  ['Drew A Picasso#XOOO', 'OG ANUNOBY#OLY', 'Nico Le Troisieme#EUW']);
assert.equal(avecAdmin[2].source, 'admin', 'sa provenance reste identifiable');

// Un compte déjà déclaré dans le dépôt n'est pas dupliqué par l'admin ; en
// revanche l'admin COMPLÈTE son puuid, absent de toutes les lignes d'avant la
// migration.
const sansPuuid = rosterAccounts(
  { name: 'Nico', riot: { name: 'Drew A Picasso', tag: 'XOOO' } },
  { accounts: { nico: { a: { name: 'drew a picasso', tag: 'xooo', puuid: 'puuid-rempli' } } } },
);
assert.equal(sansPuuid.length, 1, 'la casse ne crée pas un doublon');
assert.equal(sansPuuid[0].puuid, 'puuid-rempli', 'le puuid de l’admin complète la ligne du dépôt');

// `hidden` retire un compte du roster vivant : on ne peut pas effacer une
// ligne du dépôt depuis le site, mais on peut cesser de l'afficher.
const masque = rosterAccounts(nico, {
  accounts: { nico: { a: { name: 'OG ANUNOBY', tag: 'OLY', hidden: true } } },
});
assert.deepEqual(masque.map(a => a.riotId), ['Drew A Picasso#XOOO'], 'le smurf masqué disparaît');

// `role: 'main'` passe le compte en tête — sinon le réglage de l'admin
// resterait sans effet sur l'écran.
const promu = rosterAccounts(nico, {
  accounts: { nico: { a: { name: 'OG ANUNOBY', tag: 'OLY', role: 'main' } } },
});
assert.equal(promu[0].riotId, 'OG ANUNOBY#OLY');
assert.deepEqual(promu.map(a => a.isMain), [true, false], 'un seul principal à la fois');

assert.deepEqual(rosterAccounts({ name: 'Vide' }, null), [], 'aucun compte déclaré : rien');

console.log('roster-card-utils: comptes fusionnés depuis le dépôt et l’admin');

// ─── Pourquoi la carte est muette ────────────────────────────────────────────
// Quatre causes, quatre gestes différents. Les confondre sous un trou
// silencieux envoie chercher au mauvais endroit.
assert.equal(cardStatus({ syncedAt: 1, rank: 'Ascendant 2' }), null,
  'une carte qui a de quoi se remplir n’affiche aucun bandeau');

assert.equal(cardStatus({}, { hasRiot: false }).kind, 'unlinked');
assert.match(cardStatus({}, { hasRiot: false }).hint, /Attribution/, 'elle dit où aller');

assert.equal(cardStatus({}, { hasApiKey: false }).kind, 'no-key');
assert.equal(cardStatus({}, { hasApiKey: true }).kind, 'never-synced');
assert.notEqual(cardStatus({}, { hasApiKey: false }).hint, cardStatus({}, { hasApiKey: true }).hint,
  'sans clé, le geste n’est pas le même qu’avec');

assert.equal(cardStatus({ syncedAt: 42 }).kind, 'unranked',
  'synchronisé mais sans rang : c’est le profil ou l’acte, pas la synchro');

// ─── Fraîcheur ───────────────────────────────────────────────────────────────
const MAINTENANT = Date.UTC(2026, 8, 20);
assert.equal(isStale(MAINTENANT - 2 * 86_400_000, MAINTENANT), false);
assert.equal(isStale(MAINTENANT - 9 * 86_400_000, MAINTENANT), true);
assert.equal(isStale(0, MAINTENANT), false, 'jamais synchronisé n’est pas « périmé » : c’est un autre message');
assert.equal(isStale(null, MAINTENANT), false);

console.log('roster-card-utils: causes distinctes d’une carte muette');
