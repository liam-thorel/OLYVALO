const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rules = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'database.rules.json'), 'utf8')).rules;

/**
 * Évaluateur du sous-ensemble de règles utilisé ici : `.write` en cascade
 * (accordé sur un ancêtre ⇒ accordé en dessous) et priorité d'une clé nommée
 * sur un joker $variable — c'est la sémantique de Firebase RTDB.
 */
function effectiveWrite(fullPath) {
  let node = rules;
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

const allowed = p => effectiveWrite(p) === true;
const needsAuth = p => effectiveWrite(p) === 'auth !== null';
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

console.log('database-rules: écritures légitimes préservées, effacements de masse bloqués');
