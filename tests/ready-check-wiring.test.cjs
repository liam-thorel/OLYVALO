const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const watcher = fs.readFileSync(path.join(__dirname, '..', 'live', 'lol-watcher.js'), 'utf8');

test('auto-accept is wired to the ReadyCheck phase and re-reads before acting', () => {
  // Interroger l'endpoint à chaque passage coûterait une requête toutes les
  // 3 s pour rien : le ready check a sa propre phase de gameflow.
  assert.match(watcher, /if \(phase === 'ReadyCheck'\) await surveillerReadyCheck\(\);\s*\n\s*else oublierReadyCheck\(\);/,
    'la surveillance est bornée à la phase, et sortir de la phase annule la minuterie');

  // L'état est RELU juste avant d'accepter. Entre la programmation et le
  // déclenchement il s'écoule une dizaine de secondes : accepter sur la foi de
  // ce qu'on a vu alors remettrait le joueur dans une partie qu'il a déclinée.
  const accepter = watcher.slice(watcher.indexOf('const accepter ='), watcher.indexOf('if (plan.act === \'accept\')'));
  assert.match(accepter, /const encore = await lcuGet\(cachedLock, '\/lol-matchmaking\/v1\/ready-check'\)/);
  assert.ok(accepter.indexOf('readyCheckPlan') < accepter.indexOf('lcuPost'),
    'la décision est reprise AVANT le POST, jamais après');
  const garde = accepter.slice(accepter.indexOf("if (verdict.act !== 'accept')"));
  assert.ok(garde.startsWith("if (verdict.act !== 'accept')"), 'le verdict relu est bien testé');
  assert.ok(garde.indexOf('return;') < garde.indexOf('lcuPost'),
    'un verdict qui a changé sort avant le POST');

  // Une seule minuterie : le poll revoit le même ready check quatre fois en
  // 12 s, ce qui programmerait quatre acceptations.
  assert.match(watcher, /if \(readyCheckArme\) return;/);

  // Le POST est la SEULE écriture vers le client Riot : tout le reste est en
  // lecture, et doit le rester.
  assert.equal((watcher.match(/lcuPost\(/g) || []).length, 2, 'une définition, un seul appel');
  assert.match(watcher, /lcuPost\(cachedLock, '\/lol-matchmaking\/v1\/ready-check\/accept'\)/);

  // Le réglage est relu périodiquement : l'activer depuis l'overlay ne doit pas
  // demander de relancer le script.
  assert.match(watcher, /void relireReglages\(\);/);
  assert.match(watcher, /live\/lolSettings\/\$\{lolAccountKey\(\{ puuid \}\)\}/,
    'le réglage suit le compte par son PUUID, comme le reste');
  assert.match(watcher, /autoAccept = autoAcceptEnabled\(reglages\)/);
});

test('ready check timing accepts near the end of the window, never at once', () => {
  const { readyCheckPlan, TOTAL_SEC, MARGIN_SEC } = require('../live/ready-check.js');

  // Déroulé réel : le poll tourne toutes les 3 s, le ready check dure ~12,5 s.
  // On vérifie qu'à aucun passage précoce l'acceptation ne part.
  const instants = [0, 3, 6, 9, 12];
  const decisions = instants.map(t => readyCheckPlan({ state: 'InProgress', playerResponse: 'None', timer: t }, { enabled: true }));
  assert.deepEqual(decisions.map(d => d.act), ['wait', 'wait', 'wait', 'wait', 'accept'],
    'seul le dernier passage accepte');

  // Et la minuterie programmée au premier passage vise bien la fin.
  const premier = decisions[0];
  const accepteA = premier.delayMs / 1000;
  assert.equal(accepteA, TOTAL_SEC - MARGIN_SEC);
  assert.ok(accepteA > TOTAL_SEC * 0.7,
    `accepter à ${accepteA} s sur ${TOTAL_SEC} laisserait trop peu de temps pour décider soi-même`);
});
