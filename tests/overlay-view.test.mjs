import assert from 'node:assert/strict';
import {
  isLiveSession, groupActiveGames, isAgentSelect, memberForSession,
  displayNameFor, openBets, countdownLabel, escapeHtml,
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

console.log('overlay-view: regroupement des games, rattachement au roster et paris validés');
