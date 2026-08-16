const assert = require('node:assert/strict');
const {
  shouldProbeProcess, nextProbeDelay, PROCESS_PROBE_BACKOFF_MS, MAX_DEBUG_LOG_BYTES,
} = require('../live/lol-watcher.js');

// ─── L'escalade des délais ───────────────────────────────────────────────────
assert.equal(nextProbeDelay(0), 0, 'la première sonde est immédiate : League déjà lancé doit être vu tout de suite');
assert.equal(nextProbeDelay(1), 15_000);
assert.equal(nextProbeDelay(5), 300_000);
assert.equal(nextProbeDelay(999), 300_000, 'le délai plafonne, il ne grandit pas indéfiniment');
assert.equal(nextProbeDelay(-1), 0, 'un compteur incohérent ne doit pas produire un délai négatif');

// Les délais doivent être croissants, sinon le backoff ne sert à rien.
PROCESS_PROBE_BACKOFF_MS.forEach((delay, index) => {
  if (index > 0) assert.ok(delay > PROCESS_PROBE_BACKOFF_MS[index - 1], 'délais strictement croissants');
});

// ─── La décision de sonder ───────────────────────────────────────────────────
const t0 = 1_000_000;
assert.equal(shouldProbeProcess({ misses: 0, lastProbeAt: 0 }, t0), true, 'jamais sondé = on sonde');
assert.equal(shouldProbeProcess({ misses: 1, lastProbeAt: t0 }, t0 + 1000), false, 'trop tôt après un échec');
assert.equal(shouldProbeProcess({ misses: 1, lastProbeAt: t0 }, t0 + 15_000), true);
assert.equal(shouldProbeProcess({ misses: 4, lastProbeAt: t0 }, t0 + 60_000), false, '4 échecs = 2 min d’attente');
assert.equal(shouldProbeProcess({ misses: 4, lastProbeAt: t0 }, t0 + 120_000), true);
assert.equal(shouldProbeProcess({}, t0), true, 'état vide = on sonde');

// ─── Le gain réel, mesuré ────────────────────────────────────────────────────
// Simulation d'une journée sur un poste où League n'est jamais lancé, au
// rythme réel de pollLolOnce (3 s).
const POLL_MS = 3000;
const DAY_MS = 24 * 60 * 60 * 1000;
let probes = 0;
const state = { misses: 0, lastProbeAt: 0 };
for (let now = 0; now < DAY_MS; now += POLL_MS) {
  if (shouldProbeProcess(state, now)) {
    state.lastProbeAt = now;
    state.misses += 1;
    probes += 1;
  }
}
const before = DAY_MS / POLL_MS; // un powershell.exe par poll
assert.equal(before, 28_800, 'référence : l’ancien comportement');
assert.ok(probes < 300, `le backoff doit ramener bien en dessous de 300 sondes/jour (obtenu : ${probes})`);
console.log(`  powershell.exe par jour sans League : ${before} → ${probes}`);

// ─── Le journal de diagnostic est borné ──────────────────────────────────────
assert.equal(MAX_DEBUG_LOG_BYTES, 1024 * 1024, 'olycity-live.log doit avoir un plafond');

console.log('lol-lockfile-backoff: escalade, plafond et gain mesuré validés');
