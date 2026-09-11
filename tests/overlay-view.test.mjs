import assert from 'node:assert/strict';
import {
  isLiveSession, groupActiveGames, isAgentSelect, memberForSession,
  displayNameFor, openBets, countdownLabel, escapeHtml, matchSkins,
  modeLabelFor, hasTeams,
} from '../js/overlay-utils.mjs';

const NOW = 1_700_000_000_000;
const min = n => n * 60_000;

// ─── Ce qui compte comme « en cours » ────────────────────────────────────────
// Une session que le script n'a pas rafraîchie depuis longtemps est un
// résidu : l'afficher ferait croire à une game en cours alors que le PC est
// éteint depuis une heure.
assert.equal(isLiveSession({ active: true, ts: NOW - min(2) }, NOW), true);
assert.equal(isLiveSession({ active: true, ts: NOW - min(30) }, NOW), false, 'session périmée');
assert.equal(isLiveSession({ active: false, ts: NOW }, NOW), false);
assert.equal(isLiveSession({ active: true }, NOW), false, 'sans horodatage, on ne peut rien affirmer');
assert.equal(isLiveSession(null, NOW), false);

// ─── Un stack est UNE partie, pas deux ───────────────────────────────────────
const stack = {
  'mathis#oly': { active: true, ts: NOW - min(1), matchId: 'M1', map: 'Split', mode: 'competitive', playerName: 'Mathis#OLY' },
  'rayhan#oly': { active: true, ts: NOW - min(1), matchId: 'M1', mode: 'competitive', playerName: 'Rayhan#OLY' },
};
const groups = groupActiveGames(stack, NOW);
assert.equal(groups.length, 1, 'deux joueurs, un seul bloc');
assert.equal(groups[0].sessions.length, 2);
// La carte n'est renseignée que sur une des deux sessions : elle doit remonter.
assert.equal(groups[0].map, 'Split');

// Deux parties distinctes restent distinctes, la plus récente en tête.
const two = groupActiveGames({
  a: { active: true, ts: NOW - min(5), matchId: 'M1', playerName: 'A#1' },
  b: { active: true, ts: NOW - min(1), matchId: 'M2', playerName: 'B#1' },
}, NOW);
assert.deepEqual(two.map(group => group.matchId), ['M2', 'M1']);

// Sans matchId, deux sessions ne doivent PAS être fusionnées : rien ne dit
// qu'elles sont dans la même partie.
const noMatch = groupActiveGames({
  a: { active: true, ts: NOW, playerName: 'A#1' },
  b: { active: true, ts: NOW, playerName: 'B#1' },
}, NOW);
assert.equal(noMatch.length, 2, 'sans identifiant, aucun regroupement hasardeux');

assert.deepEqual(groupActiveGames({}, NOW), []);
assert.deepEqual(groupActiveGames(null, NOW), []);

// ─── Agent Select ────────────────────────────────────────────────────────────
assert.equal(isAgentSelect({ mode: 'agent-select' }), true);
assert.equal(isAgentSelect({ mode: 'competitive', sessions: [{ phase: 'pregame' }] }), true);
assert.equal(isAgentSelect({ mode: 'competitive', sessions: [{}] }), false);
assert.equal(isAgentSelect(null), false);

// ─── Rattachement au roster ──────────────────────────────────────────────────
// Le pseudo Riot change, le compte non : c'est tout le problème résolu par
// l'identité à l'installation, et la vue doit en profiter.
const roster = [
  { id: 'mathis', name: 'Mathis', riot: { name: 'Motivex500', tag: 'EUW' },
    smurfs: [{ name: 'M A I R', tag: 'LGND' }] },
  { id: 'nico', name: 'Nico', riot: { name: 'Drew A Picasso', tag: 'XOOO' } },
];
assert.equal(memberForSession({ playerName: 'Motivex500#EUW' }, roster)?.name, 'Mathis');
assert.equal(memberForSession({ playerName: 'M A I R#LGND' }, roster)?.name, 'Mathis',
  'un smurf mène au même membre');
assert.equal(memberForSession({ playerName: 'motivex500#euw' }, roster)?.name, 'Mathis', 'casse indifférente');
assert.equal(memberForSession({ memberId: 'nico' }, roster)?.name, 'Nico', 'memberId prioritaire');
assert.equal(memberForSession({ playerName: 'Inconnu#XXX' }, roster), null);
assert.equal(memberForSession(null, roster), null);

// Un joueur hors roster reste affiché sous son pseudo plutôt que d'être caché.
assert.equal(displayNameFor({ playerName: 'Motivex500#EUW' }, roster), 'Mathis');
assert.equal(displayNameFor({ playerName: 'Inconnu#XXX' }, roster), 'Inconnu');
assert.equal(displayNameFor({}, roster), 'Inconnu');

// ─── Paris ───────────────────────────────────────────────────────────────────
// Un pari dont la fenêtre est écoulée n'est plus pariable : l'afficher
// inviterait à cliquer dans le vide.
const rounds = {
  ouvert: { status: 'open', closesAt: NOW + min(3), openedAt: NOW - min(2), players: ['Mathis'] },
  ecoule: { status: 'open', closesAt: NOW - min(1), openedAt: NOW - min(6), players: ['Rayhan'] },
  resolu: { status: 'resolved', closesAt: NOW + min(3), openedAt: NOW, players: ['Nico'] },
  annule: { status: 'cancelled', closesAt: NOW + min(3), openedAt: NOW, players: ['Liam'] },
};
const open = openBets(rounds, NOW);
assert.deepEqual(open.map(round => round.key), ['ouvert']);
assert.deepEqual(openBets({}, NOW), []);
assert.deepEqual(openBets(null, NOW), []);

assert.equal(countdownLabel(NOW + 150_000, NOW), '2 min 30');
assert.equal(countdownLabel(NOW + 45_000, NOW), '45 s');
assert.equal(countdownLabel(NOW + 61_000, NOW), '1 min 01', 'les secondes restent sur deux chiffres');
assert.equal(countdownLabel(NOW - 5000, NOW), '0 s', 'jamais de compte à rebours négatif');
assert.equal(countdownLabel(null, NOW), '0 s');

// ─── Échappement ─────────────────────────────────────────────────────────────
// Les pseudos viennent de Riot et de Firebase, que n'importe qui peut écrire :
// ils ne doivent jamais atterrir tels quels dans le HTML.
assert.equal(escapeHtml('<img src=x onerror=alert(1)>'),
  '&lt;img src=x onerror=alert(1)&gt;');
assert.equal(escapeHtml(`"&'`), '&quot;&amp;&#39;');
assert.equal(escapeHtml(null), '');

// ─── Skins des dix joueurs ───────────────────────────────────────────────────
// La sonde a confirmé que les loadouts adverses reviennent : la vue doit les
// montrer, et distinguer les camps sans se tromper.
const withSkins = {
  sessions: [{
    selfTeam: 'ORDER',
    players: [
      { name: 'Mathis#OLY', team: 'ORDER', skins: [{ weapon: 'melee', skin: 'Elderflame Dagger' }] },
      { name: 'Ennemi#EU', team: 'CHAOS', skins: [{ weapon: 'vandal', skin: 'Prime Vandal' }] },
      { name: 'Banal#EU', team: 'CHAOS' },
    ],
  }],
};
const shown = matchSkins(withSkins);
assert.equal(shown.length, 2, 'seuls les joueurs avec un skin notable apparaissent');
assert.equal(shown[0].name, 'Mathis', 'les alliés en premier, sans le tag Riot');
assert.equal(shown[0].ally, true);
assert.equal(shown[1].ally, false, 'l’adversaire est identifié comme tel');

// Sans équipe connue on n'affirme rien plutôt que de ranger tout le monde
// du même côté — un liseré vert sur un ennemi serait pire que pas de liseré.
const noTeam = matchSkins({ sessions: [{ players: [
  { name: 'X#1', team: 'ORDER', skins: [{ weapon: 'melee', skin: 'Reaver' }] },
] }] });
assert.equal(noTeam[0].ally, null);

// La session qui porte les dix joueurs n'est pas forcément la première :
// en stack, seule celle du rapporteur les liste.
assert.equal(matchSkins({ sessions: [
  { selfTeam: 'ORDER' },
  { selfTeam: 'ORDER', players: [{ name: 'Y#1', team: 'ORDER', skins: [{ skin: 'Oni' }] }] },
] }).length, 1);

// Rien à montrer ne doit jamais lever d'exception : la section se masque.
for (const empty of [null, undefined, {}, { sessions: [] }, { sessions: [{}] },
                     { sessions: [{ players: [] }] }]) {
  assert.deepEqual(matchSkins(empty), [], `entrée vide : ${JSON.stringify(empty)}`);
}

// ─── Tous les modes de jeu ───────────────────────────────────────────────────
// Le script publie modeLabel et modeFamily pour TOUS les modes. La vue ne doit
// jamais montrer un queueID brut du genre « ggteam » ou « onefa ».
const modes = groupActiveGames({
  a: { active: true, ts: NOW, matchId: 'M1', playerName: 'A#1',
       mode: 'ggteam', modeLabel: 'Intensification', modeFamily: 'arcade' },
}, NOW);
assert.equal(modeLabelFor(modes[0]), 'Intensification');

// Poste resté sur une ancienne version du script : pas de modeLabel publié.
// Un libellé générique vaut mieux que « ggteam » affiché tel quel.
assert.equal(modeLabelFor({ mode: 'ggteam' }), 'En jeu');
assert.equal(modeLabelFor({}), '');
assert.equal(modeLabelFor(null), '');

// ─── Modes sans équipes ──────────────────────────────────────────────────────
// En Deathmatch tout le monde porte la même TeamID. Colorer les joueurs y
// ferait passer les dix adversaires pour des alliés.
assert.equal(hasTeams({ modeFamily: 'free-for-all' }), false, 'Deathmatch : aucun camp');
assert.equal(hasTeams({ modeFamily: 'tactical' }), true);
assert.equal(hasTeams({ modeFamily: 'team-deathmatch' }), true, 'le TDM a bien deux équipes');
assert.equal(hasTeams({ modeFamily: 'arcade' }), true);
// Famille inconnue : on suppose des équipes plutôt que d'effacer l'info.
assert.equal(hasTeams({}), true);
assert.equal(hasTeams(null), true);

const ffa = {
  modeFamily: 'free-for-all',
  sessions: [{ selfTeam: 'NEUTRAL', players: [
    { name: 'Moi#OLY', team: 'NEUTRAL', skins: [{ weapon: 'melee', skin: 'Reaver' }] },
    { name: 'Autre#EU', team: 'NEUTRAL', skins: [{ weapon: 'vandal', skin: 'Oni' }] },
  ] }],
};
const ffaSkins = matchSkins(ffa);
assert.equal(ffaSkins.length, 2, 'les skins restent affichés en Deathmatch');
assert.deepEqual(ffaSkins.map(p => p.ally), [null, null],
  'aucun camp annoncé : ni liseré vert, ni rouge');

// Le même jeu de données dans un mode avec équipes doit, lui, colorer.
const teamed = matchSkins({ ...ffa, modeFamily: 'tactical' });
assert.deepEqual(teamed.map(p => p.ally), [true, true], 'même TeamID = même camp');

// ─── Le libellé survit au regroupement d'un stack ────────────────────────────
// Seule la session du rapporteur porte parfois les métadonnées complètes.
const stackModes = groupActiveGames({
  a: { active: true, ts: NOW, matchId: 'M9', playerName: 'A#1' },
  b: { active: true, ts: NOW, matchId: 'M9', playerName: 'B#1',
       modeLabel: 'Vélocité', modeFamily: 'tactical' },
}, NOW);
assert.equal(stackModes.length, 1);
assert.equal(modeLabelFor(stackModes[0]), 'Vélocité',
  'le libellé remonte depuis la session qui le porte');
assert.equal(hasTeams(stackModes[0]), true);

console.log('overlay-view: regroupement des games, rattachement au roster et paris validés');
