import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { declaredOwners, declaredElsewhere } from '../js/roster-ownership.mjs';
import { buildLiveIdentityIndex, resolveLiveIdentity } from '../js/live-identities.mjs';
import { rosterAccounts } from '../js/roster-card-utils.mjs';
import { buildMembers } from '../js/rr-curve-utils.mjs';

const require = createRequire(import.meta.url);
const Module = require('node:module');
const botOwnership = require('../discord-bot/roster-ownership.js');
const { accountKind, accountMark } = require('../discord-bot/account-kind.js');

// Le bot exige sa configuration au chargement : on ne garde que l'indexation.
const originalLoad = Module._load;
Module._load = function stubbed(request, parent, isMain) {
  if (request === './config.js') return { ROSTER_URL: 'http://localhost/roster.json' };
  if (request === './firebase.js') return { fbGet: async () => null };
  return originalLoad(request, parent, isMain);
};
const botRoster = require('../discord-bot/roster.js');
Module._load = originalLoad;

const slug = value => String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-+|-+$)/g, '');

// Le cas réel : OG ANUNOBY est le main de Mathis, mais Nico l'a joué depuis
// son PC — le script l'a donc enregistré sous Nico dans Firebase.
const ROSTER = [
  { name: 'Nico', riot: { name: 'Drew A Picasso', tag: 'XOOO', puuid: 'nico-P' }, smurfs: [], lol: { name: 'phileas fogg', tag: 'OLY' } },
  { name: 'Mathis', riot: { name: 'OG ANUNOBY', tag: 'OLY', puuid: 'og-P' }, smurfs: [{ name: 'M A I R', tag: 'LGND', puuid: 'mair-P' }], lol: { name: 'M A I R', tag: 'LGND', puuid: 'mair-P' } },
];
const OVERLAY = {
  accounts: {
    nico: {
      'og-P': { name: 'OG ANUNOBY', tag: 'OLY', puuid: 'og-P', updatedAt: 500, role: 'main' },
      'lol-P': { name: 'phileas fogg', tag: 'OLY', puuid: 'lol-P', games: ['lol'], updatedAt: 100 },
    },
    mathis: { 'og-P': { name: 'OG ANUNOBY', tag: 'OLY', puuid: 'og-P', updatedAt: 400 } },
  },
};

test('un compte déclaré sous un membre n’est jamais attribué à un autre', () => {
  for (const { declaredOwners: owners, declaredElsewhere: elsewhere } of [{ declaredOwners, declaredElsewhere }, botOwnership]) {
    const index = owners(ROSTER, slug);
    assert.equal(elsewhere('nico', { puuid: 'og-P' }, index), true, 'par PUUID');
    assert.equal(elsewhere('nico', { name: 'OG ANUNOBY', tag: 'OLY' }, index), true, 'par Riot ID, sans PUUID');
    assert.equal(elsewhere('nico', { name: 'Nouveau Pseudo', tag: 'X', puuid: 'og-P' }, index), true, 'même renommé');
    assert.equal(elsewhere('mathis', { puuid: 'og-P' }, index), false, 'chez son propriétaire, rien ne change');
    assert.equal(elsewhere('nico', { name: 'Inconnu', tag: 'EUW', puuid: 'x-P' }, index), false, 'un compte non déclaré reste à Firebase');
    assert.equal(elsewhere('mathis', { name: 'phileas fogg', tag: 'OLY' }, index), true, 'le compte LoL déclaré compte aussi');
  }
});

test('Live : OG ANUNOBY est Mathis, sauf session publiée par le PC de Nico', () => {
  const index = buildLiveIdentityIndex(ROSTER, OVERLAY);
  assert.equal(resolveLiveIdentity({ puuid: 'og-P', playerName: 'OG ANUNOBY#OLY' }, index).member, 'Mathis',
    'un joueur vu dans la partie');
  assert.equal(resolveLiveIdentity({ playerName: 'OG ANUNOBY#OLY' }, index).member, 'Mathis', 'par Riot ID aussi');
  // La session publiée par un script porte le membre du poste : si Nico joue
  // ce compte chez lui, c'est bien Nico qui joue.
  assert.equal(resolveLiveIdentity({ puuid: 'og-P', memberId: 'nico' }, index).member, 'Nico');
  assert.equal(resolveLiveIdentity({ playerName: 'phileas fogg#OLY' }, index).member, 'Nico', 'compte LoL de Nico');
});

test('roster et Courbes : OG ANUNOBY quitte Nico, même désigné main dans Firebase', () => {
  const nico = rosterAccounts(ROSTER[0], OVERLAY, ROSTER).map(account => account.riotId);
  assert.ok(!nico.includes('OG ANUNOBY#OLY'), nico.join(', '));
  assert.equal(nico[0], 'Drew A Picasso#XOOO', 'son main reste son main');
  const mathis = rosterAccounts(ROSTER[1], OVERLAY, ROSTER);
  assert.equal(mathis[0].riotId, 'OG ANUNOBY#OLY');
  assert.equal(mathis[0].isMain, true);
  // Sans le roster (ancien appel), comportement d'avant.
  assert.ok(rosterAccounts(ROSTER[0], OVERLAY).some(account => account.riotId === 'OG ANUNOBY#OLY'));

  const members = buildMembers(ROSTER, OVERLAY);
  const byName = Object.fromEntries(members.map(member => [member.name, member]));
  assert.ok(!byName.Nico.riotIds.includes('OG ANUNOBY#OLY'), byName.Nico.riotIds.join(', '));
  assert.equal(byName.Mathis.riotIds[0], 'OG ANUNOBY#OLY');
});

test('bot : propriété et main par jeu', () => {
  botRoster.__test.indexRoster(ROSTER, OVERLAY);
  assert.equal(botRoster.memberByPuuid('og-P').name, 'Mathis', 'Firebase ne le rend pas à Nico');
  const nico = botRoster.memberById('nico');
  const mathis = botRoster.memberById('mathis');
  assert.ok(!nico.riotIds.some(id => id.toLowerCase() === 'og anunoby#oly'));
  assert.equal(mathis.mainRiotId, 'OG ANUNOBY#OLY');

  // Le cas signalé : le vrai compte LoL de Nico s'affichait « (smurf) ».
  assert.equal(accountKind(nico, 'phileas fogg#OLY', 'lol'), 'main');
  assert.equal(accountMark(nico, 'phileas fogg#OLY', 'lol'), ' (main)');
  assert.equal(accountKind(nico, 'Drew A Picasso#XOOO', 'valorant'), 'main');
  assert.equal(accountKind(mathis, 'OG ANUNOBY#OLY', 'valorant'), 'main');
  assert.equal(accountKind(mathis, 'M A I R#LGND', 'valorant'), 'smurf');
  assert.equal(accountKind(mathis, 'M A I R#LGND', 'lol'), 'main', 'en LoL, Mathis joue sur M A I R');
  // Sans compte LoL déclaré, le principal Valorant vaut pour les deux jeux.
  assert.equal(accountKind({ riotIds: ['A#1', 'B#2'], mainRiotId: 'A#1' }, 'A#1', 'lol'), 'main');
});

test('bot : le main se reconnaît au PUUID, même renommé', () => {
  // roster.json garde un ancien pseudo ; la partie arrive sous le nouveau.
  botRoster.__test.indexRoster([
    { name: 'Liam', riot: { name: 'Wong Chi Ming', tag: '2046', puuid: 'liam-P' }, smurfs: [{ name: 'Xi Jinping', tag: '5378', puuid: 'smurf-P' }] },
  ], {});
  const liam = botRoster.memberById('liam');
  assert.equal(accountKind(liam, { puuid: 'liam-P', playerName: 'FakePlasticTrees#1706' }), 'main',
    'par le nom, ce main renommé passait pour un smurf');
  assert.equal(accountKind(liam, { puuid: 'smurf-P', playerName: 'Wong Chi Ming#2046' }), 'smurf',
    'et un smurf qui reprendrait l’ancien pseudo du main ne passe pas pour lui');
  assert.equal(accountKind(liam, 'Wong Chi Ming#2046'), 'main', 'sans PUUID, repli sur le nom');

  // Principal LoL déclaré sans PUUID : celui de l'enregistrement du script
  // est repris, et c'est lui qui décide ensuite.
  botRoster.__test.indexRoster([
    { name: 'Nico', riot: { name: 'Drew', tag: 'X', puuid: 'nico-P' }, lol: { name: 'phileas fogg', tag: 'OLY' } },
  ], { accounts: { nico: { a: { name: 'phileas fogg', tag: 'OLY', puuid: 'pf-P' } } } });
  const nico = botRoster.memberById('nico');
  assert.equal(nico.lolMainPuuid, 'pf-P');
  assert.equal(accountKind(nico, { puuid: 'pf-P', playerName: 'Nouveau Nom#OLY' }, 'lol'), 'main', 'renommé, toujours son main LoL');
  assert.equal(accountKind(nico, { puuid: 'nico-P', playerName: 'Drew#X' }, 'lol'), 'smurf');
  assert.equal(accountKind(nico, { puuid: 'nico-P', playerName: 'Drew#X' }, 'valorant'), 'main');
});

test('données réelles : mains et comptes LoL', () => {
  const roster = JSON.parse(readFileSync(new URL('../data/roster.json', import.meta.url), 'utf8'));
  const by = Object.fromEntries(roster.map(member => [member.name, member]));
  const id = account => `${account.name}#${account.tag}`;

  assert.equal(id(by.Mathis.riot), 'OG ANUNOBY#OLY', 'OG ANUNOBY est le main de Mathis');
  assert.ok(!(by.Nico.smurfs || []).some(account => id(account) === 'OG ANUNOBY#OLY'), 'et plus un smurf de Nico');
  assert.notEqual(id(by.Nico.lol), id(by.Nico.riot), 'le main LoL de Nico diffère de son main Valorant');

  // La page LoL a sa propre liste de comptes : elle doit désigner le même
  // compte que roster.json — par PUUID quand les deux le connaissent, le nom
  // n'étant qu'un libellé qui change à chaque renommage.
  const source = readFileSync(new URL('../js/lol-roster.mjs', import.meta.url), 'utf8');
  const players = [...source.matchAll(/\{ name: '([^']+)', riotId: '([^']+)'(?:, puuid: '([^']+)')?/g)]
    .map(([, name, riotId, puuid]) => ({ name, riotId, puuid: puuid || '' }));
  assert.ok(players.length >= 5, 'liste des comptes LoL lisible');
  let comparedByPuuid = 0;
  for (const member of roster) {
    const entry = players.find(player => player.name === member.name);
    if (!entry) continue;
    const lolMain = member.lol || member.riot;
    if (entry.puuid && lolMain.puuid) {
      comparedByPuuid += 1;
      assert.equal(entry.puuid, lolMain.puuid, `${member.name} : la page LoL et roster.json désignent deux comptes`);
    } else {
      assert.equal(entry.riotId.toLowerCase(), id(lolMain).toLowerCase(), `${member.name} : page LoL ${entry.riotId}, roster.json ${id(lolMain)}`);
    }
  }
  assert.ok(comparedByPuuid >= 3, 'la plupart des comptes se comparent par PUUID');

  // Liam : Wong Chi Ming et FakePlasticTrees sont le même compte, renommé.
  // Un seul compte, donc pas de principal LoL séparé.
  assert.equal(id(by.Liam.riot), 'FakePlasticTrees#1706');
  assert.equal(by.Liam.riot.puuid, 'facae061-6042-55eb-b88a-14d58be02fe3');
  assert.equal(by.Liam.lol, undefined);
});
