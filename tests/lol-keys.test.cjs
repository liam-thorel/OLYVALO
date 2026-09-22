const assert = require('node:assert/strict');
const { safeFirebaseKey, lolAccountKey, legacyKeyToDrop } = require('../live/lol-keys.js');
const { lolHistoryKey } = require('../live/lol-watcher.js');

// ─── Caractères interdits par Firebase ───────────────────────────────────────
assert.equal(safeFirebaseKey('RayBaz#OLY'), 'RayBaz_OLY');
assert.equal(safeFirebaseKey('a.b#c$d[e]f/g'), 'a_b_c_d_e_f_g');

// ─── La clé est le PUUID ─────────────────────────────────────────────────────
// Une clé dérivée du pseudo produisait une NOUVELLE entrée à chaque renommage,
// l'ancienne restant en place pour toujours — figée à son état d'avant, et
// porteuse du même PUUID, donc candidate à être retenue par la lecture.
const compte = { puuid: 'facae061-6042-55eb-b88a-14d58be02fe3', playerName: 'FakePlasticTrees#1706' };
assert.equal(lolAccountKey(compte), 'facae061-6042-55eb-b88a-14d58be02fe3');
assert.equal(lolAccountKey({ ...compte, playerName: 'ToutAutreChose#0001' }), lolAccountKey(compte),
  'un renommage écrit au MÊME endroit');

// Repli sur le Riot ID : le LCU peut répondre sans PUUID dans les toutes
// premières secondes après le lancement du client.
assert.equal(lolAccountKey({ playerName: 'RayBaz#OLY' }), 'RayBaz_OLY');
// Écrire sous une clé vide écraserait l'entrée d'un autre joueur.
assert.equal(lolAccountKey({}), '');
assert.equal(lolAccountKey({ puuid: '   ' }), '', 'un PUUID blanc n’est pas un PUUID');

// ─── Ménage de l'ancienne clé ────────────────────────────────────────────────
// Sans lui, l'entrée indexée sur le pseudo resterait indéfiniment : un client
// « connecté » fantôme dans le tableau de bord admin.
assert.equal(legacyKeyToDrop(compte), 'FakePlasticTrees_1706');
// Rien à effacer quand il n'y a pas de PUUID : les deux clés coïncident, et le
// script effacerait ce qu'il vient d'écrire.
assert.equal(legacyKeyToDrop({ playerName: 'RayBaz#OLY' }), '');
assert.equal(legacyKeyToDrop({ puuid: 'p' }), '', 'sans pseudo, aucune ancienne clé à connaître');
assert.notEqual(legacyKeyToDrop(compte), lolAccountKey(compte), 'on n’efface jamais la clé courante');

// ─── L'historique garde ses clés ─────────────────────────────────────────────
// Ses entrées sont IMMUABLES : une fois écrite, une partie ne change plus, et
// un renommage ultérieur ne la touche pas. Il n'y a donc aucun doublon à
// éviter, et changer le format risquerait d'écrire deux fois la même partie
// pendant la transition. Le champ `puuid` à l'intérieur fait l'identification.
assert.equal(lolHistoryKey('EUW1_123', 'RayBaz#OLY', 0), 'EUW1_123-RayBaz_OLY');
assert.doesNotMatch(lolHistoryKey('EUW1_123', 'RayBaz#OLY', 0), /facae061/);
// Deux joueurs du roster dans la MÊME game gardent deux entrées distinctes.
assert.notEqual(lolHistoryKey('EUW1_123', 'RayBaz#OLY', 0), lolHistoryKey('EUW1_123', 'phileas fogg#OLY', 0));

console.log('lol-keys: les nœuds vivants sont clétés par PUUID, l’historique garde les siennes');
