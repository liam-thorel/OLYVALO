const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const rules = JSON.parse(fs.readFileSync(path.join(root, 'database.rules.json'), 'utf8')).rules;

// Le niveau 1 est publié tel quel par l'administrateur Firebase depuis
// FIREBASE-SETUP.md, sans passer par le dépôt : on le vérifie donc à la source.
const setupDoc = fs.readFileSync(path.join(root, 'FIREBASE-SETUP.md'), 'utf8');
const level1 = JSON.parse(/```json\n(\{\n  "rules"[\s\S]*?\n\})\n```/.exec(setupDoc)[1]).rules;

/**
 * Évaluateur du sous-ensemble de règles utilisé ici : `.write` en cascade
 * (accordé sur un ancêtre ⇒ accordé en dessous) et priorité d'une clé nommée
 * sur un joker $variable — c'est la sémantique de Firebase RTDB.
 */
function effectiveWrite(fullPath, tree = rules) {
  let node = tree;
  let granted = node['.write'];
  for (const segment of fullPath.split('/').filter(Boolean)) {
    if (!node || typeof node !== 'object') break;
    const child = Object.prototype.hasOwnProperty.call(node, segment)
      ? node[segment]
      : node[Object.keys(node).find(k => k.startsWith('$'))];
    if (!child) return granted;             // aucune règle plus profonde
    node = child;
    if (node['.write'] !== undefined) granted = node['.write'];
  }
  return granted;
}

const allowed = (p, tree) => effectiveWrite(p, tree) === true;
const needsAuth = p => effectiveWrite(p) === 'auth !== null';
const deniedIn = (p, tree) => { const w = effectiveWrite(p, tree); return w === false || w === undefined; };
const denied = p => effectiveWrite(p) === false || effectiveWrite(p) === undefined;

// ─── Écritures des scripts des joueurs (distribués : doivent rester ouvertes) ──
[
  'live/sessions/abc-123',
  'live/sessions/abc-123/result',
  'live/sessions/abc-123/score',
  'live/sessions/abc-123/lastKill',
  'live/clients/abc-123',
  'live/lolSessions/Player_EUW',
  'live/lolClients/Player_EUW',
  'live/lolProfiles/Player_EUW',
  'live/lolHistory/456',
  'live/history/match-1/reports/puuid-1',
  'historyIndex/valorant/match-1/ts',
  'historyIndex/valorant/match-1/reports/puuid-1',
  'historyIndex/lol/456',
  'rosterOverlay/accounts/nico/puuid-1',
].forEach(p => assert.ok(allowed(p), `le script live doit pouvoir écrire ${p}`));

// ─── Écritures des navigateurs (aucun secret possible : ouvertes) ─────────────
[
  'live/curse',                       // écrit au niveau de la collection
  'sessions/Nico/ab12cd',             // présence
  'active/Nico/ab12cd',               // présence du dessin
  'drawings/Ascent',                  // trait ajouté / carte effacée
  'drawings/Ascent/trait-1',
  'rosterOverlay/members/logan',
  'rosterOverlay/hiddenMembers/noe',
  'rosterOverlay/ignoredAccounts/xyz',
  'rosterOverlay/accounts/nico/pushid/games',
  'discovered/Player_EUW',            // supprimé depuis #admin
].forEach(p => assert.ok(allowed(p), `le site doit pouvoir écrire ${p}`));

// ─── Écritures réservées au bot (machine privée : authentifiées) ─────────────
[
  'betting/wallets/1234',
  'betting/rounds/valorant_m1_c1',
  'betting/rounds/valorant_m1_c1/bets/1234',
  'betting/weekly',
  'betting/daily',
  'discordConfig/trackers',
  'discordConfig/trackers/pushid',
  'discordConfig/leaderboardChannelId',
  'discordConfig/leaderboardMessageIds/valorant',
  'discordConfig/recapChannelId',
  'rankTracking/weekly/valorant/nico',
  'valorantAwards/thirtyBomb/1234',
].forEach(p => assert.ok(needsAuth(p), `${p} doit exiger une authentification`));

// ─── Ce que les règles doivent EMPÊCHER ──────────────────────────────────────
assert.ok(denied(''), 'la racine ne doit pas être écrasable (DELETE / = perte totale)');
assert.ok(denied('live'), 'on ne doit pas pouvoir écraser toute la collection live');
assert.ok(denied('live/sessions'), 'on ne doit pas pouvoir effacer toutes les sessions d’un coup');
assert.ok(denied('sessions'), 'on ne doit pas pouvoir effacer toutes les présences');
assert.ok(denied('drawings'), 'on ne doit pas pouvoir effacer tous les dessins');
assert.ok(denied('rosterOverlay'), 'on ne doit pas pouvoir effacer tout le roster');
assert.ok(denied('historyIndex'), 'on ne doit pas pouvoir effacer tout l’historique');
assert.ok(denied('discovered'), 'on ne doit pas pouvoir effacer toute la découverte');

// Le point le plus sensible : l'économie de points.
assert.ok(!allowed('betting'), 'betting ne doit jamais être ouvert en écriture anonyme');
assert.ok(!allowed('betting/wallets'), 'les portefeuilles ne doivent pas être videtables anonymement');
assert.ok(!allowed('betting/wallets/1234'), 'un solde ne doit pas être modifiable anonymement');

// La lecture reste publique : le site n'a aucune authentification.
assert.equal(rules['.read'], true, 'le site lit tout sans authentification');

// ─── Le niveau 1 du document de passation ────────────────────────────────────
// Il ne verrouille pas encore l'économie de points (pas de secret côté bot),
// mais il DOIT déjà rendre tout effacement de masse impossible, et ne casser
// aucune écriture existante — y compris celles du bot, non authentifié à ce stade.
['', 'live', 'live/sessions', 'sessions', 'drawings', 'rosterOverlay', 'historyIndex', 'discovered']
  .forEach(p => assert.ok(deniedIn(p, level1), `niveau 1 : ${p || '/'} doit rester non écrasable`));

[
  'live/sessions/abc-123', 'live/sessions/abc-123/result', 'live/clients/abc',
  'live/curse', 'live/lolSessions/x', 'historyIndex/valorant/m1/ts',
  'rosterOverlay/accounts/nico/puuid-1', 'rosterOverlay/members/logan',
  'sessions/Nico/ab12', 'active/Nico/ab12', 'drawings/Ascent', 'discovered/x',
  // le bot n'est pas encore authentifié au niveau 1 : ses écritures doivent passer
  'betting/wallets/1234', 'betting/rounds/r1/bets/1', 'discordConfig/trackers',
  'rankTracking/weekly/valorant/nico', 'valorantAwards/thirtyBomb/1',
].forEach(p => assert.ok(allowed(p, level1), `niveau 1 : ${p} doit rester écrivable`));

// Et le niveau 2 doit être exactement le niveau 1, aux quatre chemins près.
const lockedInLevel2 = Object.keys(rules).filter(k => rules[k]?.['.write'] === 'auth !== null');
assert.deepEqual(lockedInLevel2.sort(), ['betting', 'discordConfig', 'rankTracking', 'valorantAwards']);

console.log('database-rules: niveaux 1 et 2 vérifiés — écritures préservées, effacements de masse bloqués');
