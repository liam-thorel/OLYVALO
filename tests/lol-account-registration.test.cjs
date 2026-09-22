const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const watcher = fs.readFileSync(path.join(__dirname, '..', 'live', 'lol-watcher.js'), 'utf8');

test('LoL watcher registers the connected identity outside matches', () => {
  assert.match(watcher, /live\/lolClients\/\$\{key\}/);
  assert.match(watcher, /puuid/);
  assert.match(watcher, /games:\s*\['lol'\]/);
  assert.match(watcher, /await publishIdentity\(summonerRes\.data, phase\)/);
  assert.match(watcher, /markClientOffline/);
  assert.match(watcher, /live\/lolProfiles\/\$\{key\}/);
  assert.match(watcher, /fetchSoloQueueProfile/);
  assert.match(watcher, /live\/lolRosterSyncRequest/);
  assert.match(watcher, /ROSTER_ACCOUNTS/);
  assert.match(watcher, /ddragon\.leagueoflegends\.com/);
});

test('LoL nodes are keyed by PUUID, and the renamed account leaves no ghost', () => {
  const { lolAccountKey, legacyKeyToDrop } = require('../live/lol-keys.js');

  // Les trois nœuds vivants passent par le module de clés, et plus aucun ne
  // dérive sa clé du pseudo — c'est ce qui créait une seconde entrée figée à
  // chaque renommage.
  assert.match(watcher, /const key = lolAccountKey\(\{ puuid, playerName \}\)/);
  assert.match(watcher, /live\/lolSessions\/\$\{sessionPath\}/);
  assert.match(watcher, /live\/lolSessions\/\$\{lolAccountKey\(\{ puuid: endedSession\.puuid/);
  assert.doesNotMatch(watcher, /live\/lolSessions\/\$\{safeFirebaseKey\(/,
    'plus aucune session clétée sur le pseudo');

  // Début et fin de partie doivent atterrir au MÊME endroit : sinon une
  // session resterait éternellement « active » aux yeux du bot.
  const enCours = lolAccountKey({ puuid: 'P', playerName: 'Avant#1111' });
  const terminee = lolAccountKey({ puuid: 'P', playerName: 'Apres#2222' });
  assert.equal(enCours, terminee, 'un renommage en cours de session ne coupe pas le fil');

  // Le ménage de l'ancienne clé est fait, pour les clients et les sessions.
  assert.match(watcher, /dropLegacy\('lolClients', legacyKeyToDrop\(\{ puuid, playerName \}\)\)/);
  assert.match(watcher, /dropLegacy\('lolSessions', legacyKeyToDrop\(/);
  assert.doesNotMatch(watcher, /dropLegacy\('lolProfiles'/,
    'lolProfiles a deux écrivains : l’effacer supprimerait ce que « Actualiser tout » vient d’écrire');
  assert.equal(legacyKeyToDrop({ puuid: 'P', playerName: 'Avant#1111' }), 'Avant_1111');

  // Une seule fois : sans garde-fou, la suppression repartait à chaque
  // heartbeat pour un nœud disparu depuis la première.
  assert.match(watcher, /if \(!key \|\| nettoyees\.has\(`\$\{node\}\/\$\{key\}`\)\) return;/);

  // Le profil scrapé depuis op.gg n'a pas de PUUID à sa disposition : sa clé
  // reste le Riot ID, et c'est la lecture qui départage les deux entrées.
  assert.match(watcher, /live\/lolProfiles\/\$\{safeFirebaseKey\(account\.riotId\)\}/);
});
