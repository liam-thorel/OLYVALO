const assert = require('node:assert/strict');
const Module = require('node:module');

const deleted = [];
const original = Module._load;
Module._load = function stub(request, parent, isMain) {
  if (request === './config.js') return { FIREBASE_URL: 'x' };
  if (request === './firebase.js') {
    return {
      fbGet: async () => null,
      fbPut: async () => true,
      fbDelete: async path => { deleted.push(path); return true; },
    };
  }
  if (request === './odds.js') return { estimateOdds: async () => ({}) };
  if (request === './wallet.js') return { debit: async () => true, credit: async () => {}, recordBetOutcome: async () => 0 };
  return original(request, parent, isMain);
};
const betting = require('../discord-bot/betting.js');
Module._load = original;

const { purgeExpiredRounds, isExpired, ROUND_RETENTION_MS, resetPurgeClock } = betting.__test;
const now = 1_700_000_000_000;
const old = now - ROUND_RETENTION_MS - 1;
const recent = now - 1000;

// ─── Ce qui est expiré, et ce qui ne l'est pas ───────────────────────────────
assert.equal(isExpired({ status: 'resolved', resolvedAt: old }, now), true);
assert.equal(isExpired({ status: 'cancelled', resolvedAt: old }, now), true);
assert.equal(isExpired({ status: 'resolved', resolvedAt: recent }, now), false, 'récent = conservé pour /mybets');

// Un round encore ouvert ne doit JAMAIS être purgé, même très ancien : le bot a
// pu redémarrer et la game être toujours en cours.
assert.equal(isExpired({ status: 'open', openedAt: old }, now), false);

// Round fermé mais jamais résolu (game dodgée, bot arrêté) : il doit finir par
// partir, sinon il resterait pour toujours.
assert.equal(isExpired({ status: 'closed', closesAt: old }, now), true);
// Sans aucun horodatage exploitable, on ne supprime pas à l'aveugle.
assert.equal(isExpired({ status: 'resolved' }, now), false);
assert.equal(isExpired(null, now), false);

// ─── La purge ────────────────────────────────────────────────────────────────
resetPurgeClock();
deleted.length = 0;
const expired = purgeExpiredRounds({
  vieux1: { status: 'resolved', resolvedAt: old },
  vieux2: { status: 'cancelled', resolvedAt: old },
  recent: { status: 'resolved', resolvedAt: recent },
  ouvert: { status: 'open', openedAt: old },
}, now);

assert.deepEqual(expired.sort(), ['vieux1', 'vieux2']);
assert.deepEqual(deleted.sort(), ['betting/rounds/vieux1', 'betting/rounds/vieux2']);

// ─── Étranglement : pas une purge à chaque fin de game ──────────────────────
deleted.length = 0;
const again = purgeExpiredRounds({ autre: { status: 'resolved', resolvedAt: old } }, now + 1000);
assert.deepEqual(again, [], 'la purge ne doit pas retourner dans l’intervalle');
assert.deepEqual(deleted, [], 'aucune suppression supplémentaire');

// ... mais elle repart une fois l'intervalle écoulé.
const later = purgeExpiredRounds({ autre: { status: 'resolved', resolvedAt: old } }, now + 7 * 60 * 60 * 1000);
assert.deepEqual(later, ['autre']);

// ─── Entrées vides ───────────────────────────────────────────────────────────
resetPurgeClock();
assert.deepEqual(purgeExpiredRounds(null, now), []);
resetPurgeClock();
assert.deepEqual(purgeExpiredRounds({}, now), []);

console.log('betting-purge: rétention, protection des rounds ouverts et étranglement validés');
