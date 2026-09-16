const assert = require('node:assert/strict');
const { splitByAccount, accountLabel, shortAccount } = require('../discord-bot/recap-accounts.js');

// Les récaps fondaient tous les comptes d'un membre en une ligne : le rang
// affiché était celui de la dernière partie jouée, quel que soit le compte, et
// le winrate mélangeait un Ascendant et un Or. Aucun des deux chiffres
// n'appartenait à personne.

const membre = { name: 'Rayhan', riotIds: ['RayBaz#OLY', 'Smurf#EUW'] };
const partie = (account, extra = {}) => ({ account, win: true, ts: 1000, ...extra });

// ─── Découpage ───────────────────────────────────────────────────────────────
let lignes = splitByAccount(membre, [
  partie('RayBaz#OLY'), partie('RayBaz#OLY'), partie('Smurf#EUW'),
]);
assert.equal(lignes.length, 2, 'deux comptes joués = deux lignes');
assert.equal(lignes.find(l => l.account === 'RayBaz#OLY').entries.length, 2);
assert.equal(lignes.find(l => l.account === 'Smurf#EUW').entries.length, 1);

// La casse ne doit pas créer un troisième compte.
lignes = splitByAccount(membre, [partie('RayBaz#OLY'), partie('raybaz#oly')]);
assert.equal(lignes.length, 1, 'même compte, casse différente');
assert.equal(lignes[0].entries.length, 2);

// ─── RR rattaché au bon compte ───────────────────────────────────────────────
const gains = new Map([['raybaz#oly', 79], ['smurf#euw', -20]]);
lignes = splitByAccount(membre, [partie('RayBaz#OLY'), partie('Smurf#EUW')], gains);
assert.equal(lignes.find(l => l.account === 'RayBaz#OLY').delta, 79);
assert.equal(lignes.find(l => l.account === 'Smurf#EUW').delta, -20,
  'le RR du smurf ne doit pas atterrir sur le compte principal');

// Un compte dont le rang a bougé sans partie enregistrée apparaît quand même :
// c'est le cas quand le rapport de fin de partie a manqué.
lignes = splitByAccount(membre, [], new Map([['smurf#euw', 15]]));
assert.equal(lignes.length, 1);
assert.equal(lignes[0].account, 'Smurf#EUW');
assert.equal(lignes[0].entries.length, 0);
assert.equal(lignes[0].delta, 15);

// Un compte sans partie ni RR n'encombre pas le récap.
assert.deepEqual(splitByAccount(membre, [], new Map()), []);

// ─── Entrées d'avant l'ajout du champ ────────────────────────────────────────
// Sans compte identifié, la partie est rattachée au compte principal plutôt
// que perdue.
lignes = splitByAccount(membre, [partie(undefined), partie('')]);
assert.equal(lignes.length, 1);
assert.equal(lignes[0].account, 'RayBaz#OLY');
assert.equal(lignes[0].entries.length, 2);

// ─── Robustesse ──────────────────────────────────────────────────────────────
assert.deepEqual(splitByAccount(membre), []);
assert.deepEqual(splitByAccount(null, []), []);
assert.deepEqual(splitByAccount({}, [partie('')]), [], 'ni compte dans la partie ni roster : rien à rattacher');

// ─── Étiquettes ──────────────────────────────────────────────────────────────
// Un seul compte actif : le nom suffit, préciser alourdirait pour rien.
assert.equal(accountLabel('Rayhan', 'RayBaz#OLY', ['RayBaz#OLY']), 'Rayhan');
assert.equal(accountLabel('Rayhan', 'RayBaz#OLY', []), 'Rayhan');

// Plusieurs comptes : il faut savoir laquelle est laquelle.
const deux = ['RayBaz#OLY', 'Smurf#EUW'];
assert.equal(accountLabel('Rayhan', 'RayBaz#OLY', deux), 'Rayhan (RayBaz)');
assert.equal(accountLabel('Rayhan', 'Smurf#EUW', deux), 'Rayhan (Smurf)');

// Deux comptes dont seul le tag diffère : le tag devient nécessaire, sinon les
// deux lignes seraient étiquetées pareil.
const memeNom = ['RayBaz#OLY', 'RayBaz#EUW'];
assert.equal(accountLabel('Rayhan', 'RayBaz#OLY', memeNom), 'Rayhan (RayBaz#OLY)');
assert.equal(accountLabel('Rayhan', 'RayBaz#EUW', memeNom), 'Rayhan (RayBaz#EUW)');

assert.equal(shortAccount('RayBaz#OLY'), 'RayBaz');
assert.equal(shortAccount('SansTag'), 'SansTag');
assert.equal(shortAccount(''), '');
assert.equal(shortAccount(null), '');

console.log('recap-accounts: chaque compte garde son rang, son RR et son winrate');
