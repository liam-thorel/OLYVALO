import assert from 'node:assert/strict';
import { puuidByRiotId, matchEntry, historyOf, displayRiotId, mergePlayers, observedPuuids, autoAcceptControl } from '../js/lol-roster-utils.mjs';

const ROSTER = [
  { name: 'Liam', riot: { name: 'Wong Chi Ming', tag: '2046', puuid: 'puuid-liam' },
    smurfs: [{ name: 'Xi Jinping', tag: '5378', puuid: 'puuid-smurf' }] },
  { name: 'Rayhan', riot: { name: 'RayBaz', tag: 'OLY', puuid: 'puuid-ray' } },
  { name: 'SansPuuid', riot: { name: 'Anonyme', tag: 'XXX' } },
];

// ─── Le pont entre les deux jeux ─────────────────────────────────────────────
// Le PUUID d'un compte Riot est le même sous Valorant et sous LoL : un compte
// déclaré côté Valorant retrouve donc le même compte côté LoL.
const index = puuidByRiotId(ROSTER, { accounts: { liam: { a: { name: 'Autre Compte', tag: 'EUW', puuid: 'puuid-admin' } } } });
assert.equal(index.get('wong chi ming#2046'), 'puuid-liam');
assert.equal(index.get('xi jinping#5378'), 'puuid-smurf', 'les smurfs comptent aussi');
assert.equal(index.get('autre compte#euw'), 'puuid-admin', 'et les comptes ajoutés depuis l’admin');
assert.equal(index.get('RayBaz#OLY'.toLowerCase()), 'puuid-ray');
assert.equal(index.has('anonyme#xxx'), false, 'un compte sans PUUID n’entre pas dans l’index');

// ─── Profil : PUUID d'abord, nom en repli ────────────────────────────────────
// Un compte renommé perdait son profil, son rang et son top champions — sans
// la moindre erreur, la carte affichait juste « Non synchronisé ».
const profils = {
  ancienne_cle: { playerName: 'FakePlasticTrees#1706', puuid: 'puuid-liam', rank: { tier: 'DIAMOND' } },
  rayhan: { playerName: 'RayBaz#OLY', puuid: 'puuid-ray', rank: { tier: 'GOLD' } },
};
const renomme = matchEntry(profils, { puuid: 'puuid-liam', riotId: 'Wong Chi Ming#2046' });
assert.ok(renomme, 'le compte est retrouvé par son PUUID, malgré un pseudo déclaré périmé');
assert.equal(renomme.rank.tier, 'DIAMOND', 'et c’est bien SON profil, rang compris');

// Le nom reste utilisable pour les comptes sans PUUID renseigné.
assert.equal(matchEntry(profils, { riotId: 'RayBaz#OLY' }).rank.tier, 'GOLD');
assert.equal(matchEntry(profils, { riotId: 'raybaz#oly' }).rank.tier, 'GOLD', 'la casse ne compte pas');
assert.equal(matchEntry(profils, { puuid: 'puuid-inconnu', riotId: 'RayBaz#OLY' }).rank.tier, 'GOLD',
  'un PUUID sans correspondance retombe sur le nom plutôt que de renvoyer vide');
assert.equal(matchEntry(profils, { riotId: 'Jamais Vu#0000' }), null);
assert.equal(matchEntry(null, { puuid: 'x' }), null);
assert.equal(matchEntry(profils, {}), null, 'sans identité, rien à rapprocher');

// ─── Historique : PUUID ET nom, côte à côte ──────────────────────────────────
// Les entrées d'avant la 4.18 n'ont pas de PUUID et n'en auront jamais :
// personne ne va rétro-remplir des mois d'historique. Les exclure amputerait
// le top champions et le winrate de la saison.
const parties = [
  { playerName: 'Wong Chi Ming#2046', ts: 1 },                       // avant la 4.18
  { playerName: 'FakePlasticTrees#1706', puuid: 'puuid-liam', ts: 2 }, // après
  { playerName: 'RayBaz#OLY', puuid: 'puuid-ray', ts: 3 },
];
const sienne = historyOf(parties, { puuid: 'puuid-liam', riotId: 'Wong Chi Ming#2046' });
assert.deepEqual(sienne.map(p => p.ts), [1, 2], 'les deux formats comptent pour le même joueur');
assert.deepEqual(historyOf(parties, { puuid: 'puuid-ray' }).map(p => p.ts), [3]);
assert.deepEqual(historyOf(parties, {}), [], 'sans identité, aucune partie n’est attribuée');
assert.deepEqual(historyOf(null, { puuid: 'puuid-ray' }), []);

// ─── Le pseudo affiché est celui qu'on a vu ──────────────────────────────────
assert.equal(displayRiotId({ riotId: 'Wong Chi Ming#2046', puuid: 'puuid-liam' }, profils.ancienne_cle),
  'FakePlasticTrees#1706', 'on affiche le pseudo observé, pas celui du dépôt');
assert.equal(displayRiotId({ riotId: 'RayBaz#OLY', puuid: '' }, { playerName: 'Usurpateur#0000' }), 'RayBaz#OLY',
  'sans PUUID, le nom observé n’est pas une preuve d’identité : on garde le déclaré');
assert.equal(displayRiotId({ riotId: 'RayBaz#OLY', puuid: 'puuid-ray' }, null), 'RayBaz#OLY',
  'rien d’observé : le déclaré fait l’affaire');

// ─── La liste des joueurs se complète, elle ne se remplace pas ───────────────
// Certains comptes LoL ne sont déclarés nulle part ailleurs que dans le code.
const INTEGREE = [
  { name: 'Liam', riotId: 'FakePlasticTrees#1706' },
  { name: 'Logan', riotId: 'Stupefiant#NOXUS', avatar: 'logan.png' },
];
const fusion = mergePlayers(INTEGREE, ROSTER, null);
assert.ok(fusion.some(p => p.name === 'Logan'), 'un compte LoL connu du seul code ne disparaît pas');
assert.ok(fusion.some(p => p.name === 'Rayhan'), 'un joueur du roster absent de la liste est ajouté');
assert.equal(fusion.find(p => p.name === 'Rayhan').puuid, 'puuid-ray');
assert.equal(fusion.find(p => p.name === 'Logan').avatar, 'logan.png', 'ses champs sont conservés');

// Liam figure dans les deux, sous DEUX pseudos différents — le dépôt déclare
// son compte Valorant, la liste son compte LoL. Sans dédoublonnage par membre
// il apparaîtrait deux fois : une carte pleine et une carte vide.
assert.equal(fusion.filter(p => p.name === 'Liam').length, 1, 'un même joueur n’apparaît qu’une fois');
assert.equal(fusion.find(p => p.name === 'Liam').riotId, 'FakePlasticTrees#1706',
  'et c’est son compte LoL qui est retenu, pas son compte Valorant');

// Le PUUID s'apprend tout seul de ce que le script publie : une fois le lien
// connu, le compte devient insensible aux renommages sans saisie manuelle.
const vu = observedPuuids({ x: { playerName: 'FakePlasticTrees#1706', puuid: 'puuid-liam' } });
assert.equal(vu.get('fakeplastictrees#1706'), 'puuid-liam');
const appris = mergePlayers(INTEGREE, ROSTER, null, vu);
assert.equal(appris.find(p => p.name === 'Liam').puuid, 'puuid-liam',
  'le PUUID observé complète une ligne qui n’en déclarait pas');
assert.equal(observedPuuids(null, undefined).size, 0, 'aucune source : aucun lien inventé');

// Un compte du roster sans PUUID ne peut être reconnu que par son nom.
assert.ok(fusion.some(p => p.riotId === 'Anonyme#XXX'), 'il est quand même ajouté');
assert.equal(fusion.find(p => p.riotId === 'Anonyme#XXX').puuid, '');

// ─── Plusieurs entrées pour un même compte : la plus fraîche gagne ──────────
// Il y en a plusieurs pour deux raisons, et aucune ne disparaîtra : un
// renommage d'avant le passage des clés au PUUID a laissé une entrée figée
// sous l'ancien pseudo, et `lolProfiles` a deux écrivains — le client du
// joueur (clé PUUID) et le bouton « Actualiser tout » qui scrape op.gg et n'a
// que le Riot ID.
const doublons = {
  fige: { playerName: 'Ancien#1111', puuid: 'P', rank: { tier: 'BRONZE' }, updatedAt: 1_000 },
  vivant: { playerName: 'Nouveau#2222', puuid: 'P', rank: { tier: 'DIAMOND' }, updatedAt: 9_000 },
};
assert.equal(matchEntry(doublons, { puuid: 'P', riotId: 'Nouveau#2222' }).rank.tier, 'DIAMOND',
  'prendre la première venue affichait un rang vieux de plusieurs mois');
assert.equal(matchEntry({ b: doublons.vivant, a: doublons.fige }, { puuid: 'P' }).rank.tier, 'DIAMOND',
  'et l’ordre des clés Firebase ne doit rien y changer');

// Même arbitrage sur le repli par nom.
assert.equal(matchEntry({
  vieux: { playerName: 'RayBaz#OLY', rank: { tier: 'SILVER' }, updatedAt: 1 },
  frais: { playerName: 'RayBaz#OLY', rank: { tier: 'GOLD' }, updatedAt: 2 },
}, { riotId: 'RayBaz#OLY' }).rank.tier, 'GOLD');

// Une entrée sans date ne peut pas prouver sa fraîcheur : elle passe derrière.
assert.equal(matchEntry({
  sansDate: { playerName: 'X#1', puuid: 'Q', rank: { tier: 'IRON' } },
  datee: { playerName: 'X#1', puuid: 'Q', rank: { tier: 'GOLD' }, updatedAt: 5 },
}, { puuid: 'Q' }).rank.tier, 'GOLD');
// Mais si c'est tout ce qu'on a, elle vaut mieux que rien.
assert.equal(matchEntry({ seule: { playerName: 'X#1', puuid: 'Q', rank: { tier: 'IRON' } } }, { puuid: 'Q' }).rank.tier, 'IRON');

console.log('lol-roster-utils: identité par PUUID, repli par nom, sans doublon ni disparition');
// ─── Acceptation automatique : uniquement sur sa propre carte ───────────────
// Le réglage fait accepter une partie à la place de quelqu'un. Le laisser
// basculer depuis n'importe quelle carte permettrait de mettre un coéquipier
// dans une game qu'il ne jouera pas — pénalité pour lui, AFK pour les autres.
const moi = { name: 'Liam', puuid: 'puuid-liam' };
assert.deepEqual(autoAcceptControl(moi, { profile: 'Liam' }), { puuid: 'puuid-liam', enabled: false });
assert.equal(autoAcceptControl(moi, { profile: 'Nico' }), null, 'pas de bouton sur la carte d’un autre');
assert.equal(autoAcceptControl(moi, { profile: '' }), null, 'un visiteur en invité ne règle rien');
assert.equal(autoAcceptControl(moi, {}), null);
assert.deepEqual(autoAcceptControl(moi, { profile: '  liam  ' }), { puuid: 'puuid-liam', enabled: false },
  'la casse et les espaces du profil ne comptent pas');

// Sans PUUID, pas de clé sous laquelle le script lirait le réglage : un compte
// renommé le perdrait en silence, ce qui est le pire pour une option qui joue
// à votre place.
assert.equal(autoAcceptControl({ name: 'Liam' }, { profile: 'Liam' }), null);
assert.equal(autoAcceptControl({ name: 'Liam', puuid: '   ' }, { profile: 'Liam' }), null);

// L'état vient de Firebase, ouvert en écriture : seul un vrai booléen allume.
assert.equal(autoAcceptControl(moi, { profile: 'Liam', settings: { 'puuid-liam': { autoAccept: true } } }).enabled, true);
[false, 'true', 1, null, {}].forEach(valeur => {
  assert.equal(autoAcceptControl(moi, { profile: 'Liam', settings: { 'puuid-liam': { autoAccept: valeur } } }).enabled, false,
    `autoAccept=${JSON.stringify(valeur)} n’allume pas le bouton`);
});
assert.equal(autoAcceptControl(moi, { profile: 'Liam', settings: { autre: { autoAccept: true } } }).enabled, false,
  'le réglage d’un autre compte ne s’applique pas');

console.log('lol-roster-utils: entre deux entrées du même compte, la plus fraîche gagne');
console.log('lol-roster-utils: l’acceptation automatique ne se règle que sur sa propre carte');
