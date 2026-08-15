const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

const original = Module._load;
Module._load = function stub(request, parent, isMain) {
  if (request === './config.js') return { ROLES_URL: 'http://localhost/roles.json' };
  return original(request, parent, isMain);
};
const { mostPlayedRole, formatRole, FALLBACK_LABELS } = require('../discord-bot/agent-roles.js');
Module._load = original;

// La vraie table du site : le test échouera si un agent en disparaît.
const roles = require(path.join(__dirname, '..', 'data', 'roles.json'));
const table = { roles: roles.roles, labels: roles.labels };
const games = names => names.map(name => ({ champion: { name } }));

// ─── Le rôle dominant ────────────────────────────────────────────────────────
assert.equal(mostPlayedRole(games(['Omen', 'Astra', 'Omen']), table).label, 'Contrôleur');
assert.equal(mostPlayedRole(games(['Sova', 'Fade']), table).label, 'Initiateur');
assert.equal(mostPlayedRole(games(['Killjoy']), table).label, 'Sentinelle');
assert.equal(mostPlayedRole(games(['Reyna', 'Jett']), table).label, 'Duelliste');

// Le rôle majoritaire l'emporte, même si un autre agent est le plus joué
// individuellement (2 contrôleurs différents battent 1 duelliste répété).
const mixed = mostPlayedRole(games(['Jett', 'Jett', 'Omen', 'Astra', 'Viper']), table);
assert.equal(mixed.label, 'Contrôleur');
assert.equal(mixed.games, 3);

// ─── Égalité : le départage doit être déterministe ──────────────────────────
// Un récap ne doit pas changer d'avis selon l'ordre d'arrivée des games.
const tieA = mostPlayedRole(games(['Jett', 'Omen']), table);
const tieB = mostPlayedRole(games(['Omen', 'Jett']), table);
assert.equal(tieA.code, tieB.code, 'même série dans un autre ordre = même rôle');

// ─── Agents inconnus (nouvel agent pas encore dans roles.json) ──────────────
assert.equal(mostPlayedRole(games(['AgentQuiNExistePas']), table), null);
assert.equal(mostPlayedRole([], table), null);
assert.equal(mostPlayedRole(games(['Omen', 'AgentInconnu']), table).label, 'Contrôleur',
  'un agent inconnu ne doit pas masquer les autres');
// Entrées sans agent du tout (rapport de fin de game incomplet).
assert.equal(mostPlayedRole([{}, { champion: null }], table), null);

// ─── Table indisponible (réseau coupé) : pas de rôle, pas de plantage ───────
assert.equal(mostPlayedRole(games(['Omen']), { roles: {}, labels: {} }), null);
assert.equal(mostPlayedRole(games(['Omen']), null), null);
assert.equal(mostPlayedRole(games(['Omen']), undefined), null);

// ─── Mise en forme ──────────────────────────────────────────────────────────
assert.equal(formatRole(mostPlayedRole(games(['Killjoy']), table)), '🛡️ Sentinelle');
assert.equal(formatRole(null), null, 'aucun rôle = ligne omise, pas de texte vide');
assert.equal(formatRole({ label: 'Duelliste', emoji: '' }), 'Duelliste');

// ─── Les libellés de repli couvrent les quatre rôles ────────────────────────
assert.deepEqual(Object.keys(FALLBACK_LABELS).sort(), ['C', 'D', 'I', 'S']);
Object.keys(FALLBACK_LABELS).forEach(code =>
  assert.equal(roles.labels[code], FALLBACK_LABELS[code], `le libellé ${code} doit rester aligné sur le site`));

console.log('agent-roles: rôle dominant, départage déterministe et absence de table validés');
