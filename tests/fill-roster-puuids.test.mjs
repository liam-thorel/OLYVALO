import assert from 'node:assert/strict';
import { collectPuuids, resolvePuuid, fillRoster } from '../tools/fill-roster-puuids.mjs';

const PUUID_A = '11111111-2222-3333-4444-555555555555';
const PUUID_B = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

// ─── Récolte ─────────────────────────────────────────────────────────────────
const found = collectPuuids({
  overlay: { accounts: { liam: { k1: { name: 'Wong Chi Ming', tag: '2046', puuid: PUUID_A } } } },
  history: { m1: { reports: { r: { players: [{ name: 'RayBaz#OLY', puuid: PUUID_B }] } } } },
  lolHistory: { a: { playerName: 'Noe#OLY', puuid: PUUID_A } },
});
assert.equal(resolvePuuid('Wong Chi Ming#2046', found).puuid, PUUID_A);
assert.equal(resolvePuuid('RayBaz#OLY', found).puuid, PUUID_B, 'les rapports de partie comptent aussi');
assert.equal(resolvePuuid('noe#oly', found).puuid, PUUID_A, 'casse ignorée');

// Un pseudo sans tag n'est pas un Riot ID : deux joueurs homonymes seraient
// confondus.
assert.equal(collectPuuids({ lolHistory: { a: { playerName: 'SansTag', puuid: PUUID_A } } }).size, 0);
// Un puuid vide ne s'enregistre pas.
assert.equal(collectPuuids({ lolHistory: { a: { playerName: 'A#1', puuid: '' } } }).size, 0);

// ─── Ambiguïté : on ne tranche pas ───────────────────────────────────────────
// Deux puuids pour un même pseudo = deux comptes ont porté ce nom.
const ambigu = collectPuuids({
  history: {
    m1: { reports: { r: { players: [{ name: 'Repris#EUW', puuid: PUUID_A }] } } },
    m2: { reports: { r: { players: [{ name: 'Repris#EUW', puuid: PUUID_B }] } } },
  },
});
const verdict = resolvePuuid('Repris#EUW', ambigu);
assert.equal(verdict.puuid, '', 'aucun puuid choisi au hasard');
assert.match(verdict.reason, /à trancher à la main/);

// Sauf si l'admin a tranché : c'est un humain qui l'a renseigné, il fait foi.
const arbitre = collectPuuids({
  overlay: { accounts: { liam: { k: { name: 'Repris', tag: 'EUW', puuid: PUUID_A } } } },
  history: { m2: { reports: { r: { players: [{ name: 'Repris#EUW', puuid: PUUID_B }] } } } },
});
assert.equal(resolvePuuid('Repris#EUW', arbitre).puuid, PUUID_A, 'l’admin fait autorité');

assert.match(resolvePuuid('Inconnu#1', found).reason, /introuvable/);

// ─── Écriture dans le roster ─────────────────────────────────────────────────
const { filled, report } = fillRoster([
  { name: 'Liam', role: 'Entry Duelist', mains: ['Omen'], avatar: 'x',
    riot: { name: 'Wong Chi Ming', tag: '2046', region: 'eu' },
    smurfs: [{ name: 'RayBaz', tag: 'OLY' }, { name: 'Jamais Vu', tag: '0000' }] },
], found);

assert.equal(filled[0].riot.puuid, PUUID_A);
assert.equal(filled[0].smurfs[0].puuid, PUUID_B);
assert.equal(filled[0].smurfs[1].puuid, undefined, 'un compte introuvable reste sans puuid');

// Le reste du fichier ne doit pas bouger : c'est lui qui porte l'affichage.
assert.equal(filled[0].role, 'Entry Duelist');
assert.deepEqual(filled[0].mains, ['Omen']);
assert.equal(filled[0].avatar, 'x');
assert.equal(filled[0].riot.region, 'eu', 'la région est conservée');
assert.equal(filled[0].riot.name, 'Wong Chi Ming', 'le pseudo reste — il sert à l’affichage');

assert.equal(report.filter(row => row.status.startsWith('→')).length, 2);
assert.match(report.find(row => row.riotId === 'Jamais Vu#0000').status, /introuvable/);

// Un puuid déjà présent n'est jamais écrasé.
const dejaLa = fillRoster([{ name: 'Liam', riot: { name: 'Wong Chi Ming', tag: '2046', puuid: PUUID_B } }], found);
assert.equal(dejaLa.filled[0].riot.puuid, PUUID_B);
assert.match(dejaLa.report[0].status, /déjà renseigné/);

assert.deepEqual(fillRoster([], found).filled, []);
assert.deepEqual(fillRoster(null, found).filled, []);

console.log('fill-roster-puuids: récolte, arbitrage et écriture non destructive validés');
