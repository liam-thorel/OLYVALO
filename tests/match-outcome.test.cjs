const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { teamOutcome } = require('../live/match-outcome.js');

test('une égalité n’est pas une défaite', () => {
  // Le cas signalé : vote d'égalité en prolongation. Riot ne marque aucune
  // équipe gagnante — l'ancien calcul en faisait une défaite, et les paris
  // étaient tranchés comme tels au lieu d'être remboursés.
  const nul = [{ teamId: 'Blue', won: false, roundsWon: 15 }, { teamId: 'Red', won: false, roundsWon: 15 }];
  assert.equal(teamOutcome('Blue', nul), 'draw');
  assert.equal(teamOutcome('Red', nul), 'draw');
});

test('victoire et défaite restent ce qu’elles sont', () => {
  const teams = [{ teamId: 'Blue', won: true, roundsWon: 13 }, { teamId: 'Red', won: false, roundsWon: 9 }];
  assert.equal(teamOutcome('Blue', teams), 'win');
  assert.equal(teamOutcome('Red', teams), 'loss');
});

test('une reddition à score égal a un vainqueur : ce n’est pas une égalité', () => {
  // C'est pour ça qu'on ne se fie pas au score : 6-6 puis reddition, l'équipe
  // qui a abandonné a perdu, et les paris doivent être tranchés.
  const reddition = [{ teamId: 'Blue', won: false, roundsWon: 6 }, { teamId: 'Red', won: true, roundsWon: 6 }];
  assert.equal(teamOutcome('Blue', reddition), 'loss');
  assert.equal(teamOutcome('Red', reddition), 'win');
});

test('sans les deux équipes, on ne conclut pas à une égalité', () => {
  assert.equal(teamOutcome('Blue', [{ teamId: 'Blue', won: false }]), 'loss',
    'une seule équipe connue : l’absence de vainqueur ne prouve rien');
  assert.equal(teamOutcome('Blue', []), null, 'équipe introuvable : on laisse le score local décider');
  assert.equal(teamOutcome(null, null), null);
});

test('le script publie bien l’issue calculée ainsi', () => {
  const script = fs.readFileSync(path.join(__dirname, '..', 'live', 'index.js'), 'utf8');
  assert.match(script, /result: isDeathmatch \? 'completed' : teamOutcome\(selfTeamId, rawTeams\) \|\| snapshot\.result,/);
  assert.doesNotMatch(script, /selfTeam\.won \? 'win' : 'loss'/, 'l’ancien calcul ne doit pas revenir');
});
