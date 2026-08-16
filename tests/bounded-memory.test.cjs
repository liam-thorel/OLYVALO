const assert = require('node:assert/strict');
const { createBoundedSet, createExpiringMap } = require('../discord-bot/bounded-memory.js');

// ─── Set borné ───────────────────────────────────────────────────────────────
const seen = createBoundedSet(3);
['a', 'b', 'c'].forEach(id => seen.add(id));
assert.equal(seen.size, 3);
assert.ok(seen.has('a'));

seen.add('d');
assert.equal(seen.size, 3, 'la taille ne dépasse jamais la limite');
assert.equal(seen.has('a'), false, 'la plus ancienne entrée est évincée');
assert.ok(seen.has('d'));

// Réinsérer une entrée encore utile la protège de l'éviction : une game
// toujours en cours ne doit pas être oubliée à cause de games plus récentes.
seen.add('b');          // b redevient la plus récente
seen.add('e');          // évince c, pas b
assert.ok(seen.has('b'), 'une entrée rafraîchie survit');
assert.equal(seen.has('c'), false);

// Le bot tourne des mois : la borne doit tenir sur un volume réaliste.
const big = createBoundedSet(500);
for (let i = 0; i < 50_000; i += 1) big.add(`match-${i}`);
assert.equal(big.size, 500, '50 000 games ne doivent pas faire grossir la mémoire');
assert.ok(big.has('match-49999'), 'les games récentes restent connues');

// ─── Map à expiration ────────────────────────────────────────────────────────
const WINDOW = 20 * 60 * 1000;
const recent = createExpiringMap(WINDOW);
const t0 = 1_000_000;

assert.equal(recent.seenRecently('Liam,Nico', t0), false, 'premier passage : pas encore vu');
assert.equal(recent.seenRecently('Liam,Nico', t0 + 1000), true, 'doublon dans la fenêtre : bloqué');
assert.equal(recent.seenRecently('Liam,Nico', t0 + WINDOW - 1), true, 'toujours dans la fenêtre');
assert.equal(recent.seenRecently('Liam,Nico', t0 + WINDOW + 1), false,
  'passée la fenêtre, une nouvelle game doit être notifiée');

// Les entrées périmées sont réellement retirées, pas seulement ignorées.
const expiring = createExpiringMap(1000);
for (let i = 0; i < 1000; i += 1) expiring.seenRecently(`groupe-${i}`, t0);
assert.equal(expiring.size, 1000);
expiring.seenRecently('déclencheur', t0 + 5000);
assert.equal(expiring.size, 1, 'la purge élimine tout ce qui a dépassé la fenêtre');

// Des groupes différents ne se gênent pas.
const groups = createExpiringMap(WINDOW);
assert.equal(groups.seenRecently('Liam', t0), false);
assert.equal(groups.seenRecently('Nico', t0), false);
assert.equal(groups.seenRecently('Liam', t0 + 10), true);

console.log('bounded-memory: éviction, rafraîchissement et expiration validés');
