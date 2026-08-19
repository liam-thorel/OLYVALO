const assert = require('node:assert/strict');
const { planRestart, MAX_BACKOFF_MS, RAPID_CRASH_WINDOW_MS } = require('../live/restart-policy.js');

const now = 1_000_000;

// ─── Le point qui compte : on relance TOUJOURS ───────────────────────────────
// Quel que soit le scénario, il doit toujours y avoir une relance. Un délai,
// jamais un abandon.
for (const [last, streak] of [[0, 0], [now - 1, 50], [now - 1000, 3], [now - 100000, 0]]) {
  const plan = planRestart(now, last, streak);
  assert.ok(Number.isFinite(plan.delayMs) && plan.delayMs >= 0, 'un délai fini, jamais de renoncement');
}

// ─── Crash isolé : relance immédiate, compteur remis à zéro ─────────────────
const isolated = planRestart(now, now - RAPID_CRASH_WINDOW_MS - 1, 5);
assert.equal(isolated.delayMs, 0, 'un crash espacé repart tout de suite');
assert.equal(isolated.streak, 0, 'et oublie les crashs précédents');

// ─── Tout premier crash ──────────────────────────────────────────────────────
const first = planRestart(now, 0, 0);
assert.equal(first.delayMs, 0);
assert.equal(first.streak, 0);
assert.equal(first.crashTs, now, 'l’horodatage est transmis au process suivant');

// ─── Crashs rapprochés : le délai monte, mais reste borné ───────────────────
let last = now, streak = 0, t = now;
const delays = [];
for (let i = 0; i < 20; i += 1) {
  t += 1000; // un nouveau crash 1 s après le précédent : toujours "rapproché"
  const plan = planRestart(t, last, streak);
  delays.push(plan.delayMs);
  last = plan.crashTs; streak = plan.streak;
}
assert.deepEqual(delays.slice(0, 4), [5000, 10000, 15000, 20000], 'escalade régulière');
assert.ok(delays.every(d => d <= MAX_BACKOFF_MS), 'le délai plafonne');
assert.equal(delays[delays.length - 1], MAX_BACKOFF_MS, 'et atteint bien le plafond');

// À 60 s de plafond, un crash persistant fait au pire une relance par minute :
// jamais une boucle à chaud, jamais un abandon.
assert.equal(MAX_BACKOFF_MS, 60_000);

console.log('restart-policy: relance systématique, backoff borné, série qui s’éteint validés');
