const assert = require('node:assert/strict');
const { readyCheckPlan, autoAcceptEnabled, TOTAL_SEC, MARGIN_SEC } = require('../live/ready-check.js');

const actif = { enabled: true };
const enCours = (timer, reste = {}) => ({ state: 'InProgress', playerResponse: 'None', timer, ...reste });

// ─── Désactivé par défaut ────────────────────────────────────────────────────
// Accepter à la place de quelqu'un qui n'a rien demandé le met dans une partie
// qu'il ne jouera pas : pénalité pour lui, quatre coéquipiers avec un AFK.
assert.equal(readyCheckPlan(enCours(11)).act, 'ignore', 'rien ne se déclenche sans opt-in');
assert.equal(readyCheckPlan(enCours(11), { enabled: false }).reason, 'desactive');

// ─── On attend la FIN du compte à rebours ────────────────────────────────────
// La fenêtre entière reste disponible pour accepter, refuser ou dodge à la
// main : l'automatisme est un filet, pas une décision prise à la place.
const debut = readyCheckPlan(enCours(0), actif);
assert.equal(debut.act, 'wait');
assert.equal(debut.delayMs, Math.round((TOTAL_SEC - MARGIN_SEC) * 1000), 'on patiente jusqu’à la marge');
assert.ok(debut.delayMs > 9000, `accepter en ${debut.delayMs} ms serait un comportement qu’aucun humain n’a`);

assert.equal(readyCheckPlan(enCours(5), actif).act, 'wait');
assert.equal(readyCheckPlan(enCours(9), actif).act, 'wait', 'à 3,5 s restantes on patiente encore');
assert.equal(readyCheckPlan(enCours(9.5), actif).act, 'accept', 'à 3 s restantes, c’est le moment');
assert.equal(readyCheckPlan(enCours(12), actif).act, 'accept');

// La marge doit rester généreuse : la durée n'est pas publiée par l'API, et
// une requête lente ou un client qui rame mange la fin de la fenêtre.
assert.ok(MARGIN_SEC >= 2.5, 'moins de 2,5 s de marge, on rate la fenêtre et la file repart');

// ─── Jamais par-dessus une décision humaine ──────────────────────────────────
// Repasser derrière un REFUS serait le pire bug possible : remettre quelqu'un
// dans une partie qu'il vient de décliner.
assert.equal(readyCheckPlan({ ...enCours(11), playerResponse: 'Declined' }, actif).act, 'ignore');
assert.match(readyCheckPlan({ ...enCours(11), playerResponse: 'Declined' }, actif).reason, /Declined/);
assert.equal(readyCheckPlan({ ...enCours(11), playerResponse: 'Accepted' }, actif).act, 'ignore',
  'déjà accepté à la main : rien à refaire');

// ─── États qui ne sont pas un ready check ────────────────────────────────────
['Invalid', 'EveryoneReady', 'PartyNotReady', 'StrangerNotReady', ''].forEach(state => {
  assert.equal(readyCheckPlan({ state, playerResponse: 'None', timer: 11 }, actif).act, 'ignore', `état ${state}`);
});
assert.equal(readyCheckPlan(null, actif).act, 'ignore');
assert.equal(readyCheckPlan('pas un objet', actif).act, 'ignore');
assert.equal(readyCheckPlan({}, actif).reason, 'etat-inconnu');

// ─── Un timer aberrant ne fait pas accepter tout de suite ────────────────────
// C'est le cas dangereux : une valeur absente lue comme « fin du compte à
// rebours » accepterait dans la seconde, exactement ce qu'on veut éviter.
[undefined, null, NaN, 'douze', -5].forEach(timer => {
  const plan = readyCheckPlan(enCours(timer), actif);
  assert.equal(plan.act, 'wait', `timer=${JSON.stringify(timer)} doit faire patienter`);
  assert.equal(plan.delayMs, Math.round((TOTAL_SEC - MARGIN_SEC) * 1000), 'et repartir de la fenêtre complète');
});

// ─── Le réglage vient de Firebase, ouvert en écriture ────────────────────────
// Tout ce qui en vient est suspect : seul un vrai booléen arme l'automatisme.
assert.equal(autoAcceptEnabled({ autoAccept: true }), true);
[false, 'true', 1, 'oui', {}, [], null, undefined].forEach(valeur => {
  assert.equal(autoAcceptEnabled({ autoAccept: valeur }), false, `autoAccept=${JSON.stringify(valeur)} n’active rien`);
});
assert.equal(autoAcceptEnabled(null), false);
assert.equal(autoAcceptEnabled({}), false, 'aucun réglage = désactivé');

console.log('ready-check: accepté à la fin du compte à rebours, jamais par-dessus un refus');
