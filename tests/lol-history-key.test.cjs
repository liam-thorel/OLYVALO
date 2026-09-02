const assert = require('node:assert/strict');
const { lolHistoryKey, safeFirebaseKey } = require('../live/lol-watcher.js');

// L'historique LoL était écrit sous live/lolHistory/{matchId}. Quand deux
// membres du roster jouaient la MÊME game, le second écrasait le premier :
// pas un doublon, une perte — la game disparaissait de l'historique de l'un
// des deux, avec son champion, son KDA et son résultat.

// ─── Le cas qui perdait des données ─────────────────────────────────────────
const a = lolHistoryKey('EUW1_7412', 'Motivex500#EUW', 1000);
const b = lolHistoryKey('EUW1_7412', 'Skybreacoeur#EUW', 1000);
assert.notEqual(a, b, 'deux joueurs dans la même game doivent avoir deux clés');
assert.match(a, /EUW1_7412/, 'le matchId reste identifiable dans la clé');
assert.match(b, /EUW1_7412/);

// ─── Ce qui doit rester stable ──────────────────────────────────────────────
// Même joueur, même game, deux appels : la même clé. Sinon une game réécrite
// (rapport corrigé, relance du script) créerait un doublon.
assert.equal(lolHistoryKey('EUW1_7412', 'Motivex500#EUW', 1000),
  lolHistoryKey('EUW1_7412', 'Motivex500#EUW', 9999),
  'l’horodatage n’entre pas dans la clé quand le matchId est connu');

// Deux games différentes du même joueur restent distinctes.
assert.notEqual(lolHistoryKey('EUW1_1', 'Motivex500#EUW', 1000),
  lolHistoryKey('EUW1_2', 'Motivex500#EUW', 1000));

// ─── Caractères interdits par Firebase ──────────────────────────────────────
// Un Riot ID contient toujours un '#', que Firebase refuse dans une clé.
// Sans échappement, l'écriture échouerait et la game serait perdue autrement.
for (const forbidden of ['.', '#', '$', '[', ']', '/']) {
  const key = lolHistoryKey('EUW1_1', `Jo${forbidden}ueur#EUW`, 1000);
  assert.doesNotMatch(key, /[.#$[\]/]/, `« ${forbidden} » doit être échappé`);
}
assert.equal(lolHistoryKey('EUW1_7412', 'Motivex500#EUW', 1000), 'EUW1_7412-Motivex500_EUW');

// ─── Replis ─────────────────────────────────────────────────────────────────
// Sans matchId (rapport de fin incomplet), l'horodatage de début prend le
// relais — il reste propre à cette partie sur ce poste.
assert.equal(lolHistoryKey('', 'Motivex500#EUW', 1000), '1000-Motivex500_EUW');
assert.equal(lolHistoryKey(null, 'Motivex500#EUW', 1000), '1000-Motivex500_EUW');

// Sans nom de joueur exploitable, on retombe sur l'ancienne clé : mieux vaut
// le risque d'écrasement que des entrées « match-undefined » indistinctes.
assert.equal(lolHistoryKey('EUW1_7412', '', 1000), 'EUW1_7412');
assert.equal(lolHistoryKey('EUW1_7412', null, 1000), 'EUW1_7412');
assert.equal(lolHistoryKey('EUW1_7412', undefined, 1000), 'EUW1_7412');

// Aucune clé ne doit jamais être vide : Firebase refuserait l'écriture.
for (const args of [['', '', 0], [null, null, null], [undefined, undefined, undefined]]) {
  const key = lolHistoryKey(...args);
  assert.ok(key.length > 0, `clé vide pour ${JSON.stringify(args)}`);
  assert.doesNotMatch(key, /[.#$[\]/]/);
}

// ─── Compatibilité avec les entrées déjà écrites ────────────────────────────
// Les anciennes clés valent toujours : la lecture filtre sur playerName, pas
// sur le format de la clé. Rien à migrer, et pendant le déploiement un poste
// resté sur l'ancienne version n'écrase plus celui qui est à jour.
assert.equal(safeFirebaseKey('EUW1_7412'), 'EUW1_7412');
assert.notEqual(lolHistoryKey('EUW1_7412', 'Motivex500#EUW', 1000), safeFirebaseKey('EUW1_7412'));

console.log('lol-history-key: deux joueurs d’une même game ne s’écrasent plus');
