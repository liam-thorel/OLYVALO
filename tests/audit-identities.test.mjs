import assert from 'node:assert/strict';
import { harvestPuuids, lastSeen, accountsOf } from '../tools/audit-identities.mjs';

// ─── Retrouver un puuid dans ce que les scripts ont déjà publié ──────────────
const history = {
  m1: { reports: { r: {
    ts: 1_000, player: 'Wong Chi Ming#2046', playerPuuid: 'puuid-liam',
    players: [
      { name: 'Wong Chi Ming#2046', puuid: 'puuid-liam' },
      { name: 'RayBaz#OLY', puuid: 'puuid-rayhan' },
    ],
  } } },
  // Entrée à l'ancienne forme, champs à plat : elle compte aussi.
  m2: { map: 'Ascent', ts: 2_000, players: [{ name: 'M A I R#LGND', puuid: 'puuid-mathis' }] },
};

const trouves = harvestPuuids({ history, discovered: { d: { playerName: 'Noe#OLY', puuid: 'puuid-noe' } } });
assert.deepEqual([...trouves.get('wong chi ming#2046')], ['puuid-liam']);
assert.deepEqual([...trouves.get('raybaz#oly')], ['puuid-rayhan']);
assert.deepEqual([...trouves.get('m a i r#lgnd')], ['puuid-mathis'], 'ancienne forme lue aussi');
assert.deepEqual([...trouves.get('noe#oly')], ['puuid-noe'], 'les comptes découverts comptent');

// Un nom sans tag n'est pas un Riot ID : on ne l'indexe pas, sinon deux
// joueurs au même pseudo seraient confondus.
assert.equal(trouves.has('sanstag'), false);

// Deux puuids pour un même nom = deux comptes ont porté ce pseudo. L'outil
// doit le SIGNALER, pas en choisir un.
const ambigu = harvestPuuids({ history: {
  a: { reports: { r: { players: [{ name: 'Repris#EUW', puuid: 'p1' }] } } },
  b: { reports: { r: { players: [{ name: 'Repris#EUW', puuid: 'p2' }] } } },
} });
assert.equal(ambigu.get('repris#euw').size, 2, 'l’ambiguïté est conservée, pas tranchée');

// ─── Dernière activité ───────────────────────────────────────────────────────
const vus = lastSeen({ history, lolHistory: { x: { playerName: 'RayBaz#OLY', ts: 9_000 } } });
assert.equal(vus.get('wong chi ming#2046'), 1_000);
assert.equal(vus.get('raybaz#oly'), 9_000, 'la date la plus récente gagne, tous jeux confondus');
assert.equal(vus.has('inconnu#1'), false);

// ─── Inventaire des comptes déclarés ─────────────────────────────────────────
const rows = accountsOf(
  [{ name: 'Liam', riot: { name: 'Wong Chi Ming', tag: '2046' }, smurfs: [{ name: 'Xi Jinping', tag: '5378' }] }],
  { accounts: { liam: { k1: { name: 'Nouveau', tag: 'OLY', puuid: 'puuid-liam' } } } },
);
assert.equal(rows.length, 3, 'les deux sources sont inventoriées');
assert.equal(rows.filter(r => r.source === 'roster.json').length, 2);
const depuisAdmin = rows.find(r => r.source === 'rosterOverlay');
assert.equal(depuisAdmin.puuid, 'puuid-liam');
assert.equal(depuisAdmin.key, 'k1', 'la clé est gardée : c’est elle qu’on écrira');
assert.equal(depuisAdmin.member, 'Liam', 'le memberId est résolu vers un nom lisible');

// Un compte sans nom n'est pas un compte.
assert.equal(accountsOf([], { accounts: { liam: { k: { tag: 'OLY' } } } }).length, 0);
assert.deepEqual(accountsOf(null, null), []);

console.log('audit-identities: récolte des puuids, dernière activité et inventaire validés');
