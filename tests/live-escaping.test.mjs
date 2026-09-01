import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const interactions = fs.readFileSync(new URL('../js/interactions.js', import.meta.url), 'utf8');

// La page Live rend des données venues de Firebase, dont les écritures sont
// anonymes : tout ce qui en sort et atterrit dans innerHTML est une XSS
// stockée s'il n'est pas échappé.
test('les données Firebase rendues en HTML sont échappées', () => {
  const sinks = [
    ['lastKill.killer', /escapeDiagnosticText\(lastKill\.killer\)/],
    ['lastKill.victim', /escapeDiagnosticText\(lastKill\.victim\)/],
    ['le pseudo du joueur', /escapeDiagnosticText\(p\.name \|\| '—'\)/],
    ['le nom du membre OLYCITY', /escapeDiagnosticText\(member\)/],
    ["le nom d'agent", /escapeDiagnosticText\(fixedAgent \|\| ''\)/],
    ['les noms du sélecteur de sessions', /escapeDiagnosticText\(names\)/],
    ['le nom de map du sélecteur', /escapeDiagnosticText\(map\.toUpperCase\(\)\)/],
  ];
  sinks.forEach(([label, pattern]) =>
    assert.match(interactions, pattern, `${label} doit être échappé`));
});

test('le puuid injecté dans un attribut data est neutralisé', () => {
  // Une apostrophe dans le puuid sortirait de l'attribut data ; l'encodage la
  // rend inoffensive et aucun gestionnaire JavaScript n'est injecté en HTML.
  assert.match(interactions, /data-live-session="\$\{encodeURIComponent\(sessions\[0\]\.puuid\)\}"/);
  assert.doesNotMatch(interactions, /onclick="window\._selectLiveSession/);
  // Et le handler doit décoder, sinon la sélection ne correspondrait plus.
  assert.match(interactions, /decodeURIComponent\(encodedPuuid\)/);
});

test('aucune interpolation brute ne subsiste sur les champs sensibles', () => {
  const forbidden = [
    ['${lastKill.killer}', 'kill feed'],
    ['${lastKill.victim}', 'kill feed'],
    ['${names}</div>', 'sélecteur de sessions'],
  ];
  forbidden.forEach(([snippet, where]) =>
    assert.ok(!interactions.includes(snippet), `interpolation brute restante (${where}) : ${snippet}`));
});

test('la fonction d’échappement couvre les cinq caractères dangereux', () => {
  assert.match(interactions, /escapeDiagnosticText = value => String\(value \|\| ''\)\.replace\(\/\[&<>"'\]\/g/,
    'la classe de caractères ne doit pas être réduite');
  [
    ["'&': '&amp;'", '&'],
    ["'<': '&lt;'", '<'],
    ["'>': '&gt;'", '>'],
    ['\'"\': \'&quot;\'', '"'],
    ['"\'": \'&#39;\'', "'"],
  ].forEach(([mapping, character]) =>
    assert.ok(interactions.includes(mapping), `${character} doit avoir sa substitution`));
});
