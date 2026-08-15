import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const main = fs.readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');
const interactions = fs.readFileSync(new URL('../js/interactions.js', import.meta.url), 'utf8');
const render = fs.readFileSync(new URL('../js/render.js', import.meta.url), 'utf8');
const lolRoster = fs.readFileSync(new URL('../js/lol-roster.mjs', import.meta.url), 'utf8');
const page = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const liveDataStore = fs.readFileSync(new URL('../js/live-data-store.mjs', import.meta.url), 'utf8');
const historyPager = fs.readFileSync(new URL('../js/history-pager.mjs', import.meta.url), 'utf8');

test('shared state does not import the versioned entry module twice', () => {
  assert.match(main, /from '\.\/state\.mjs/);
  assert.doesNotMatch(interactions, /from '\.\/main\.js/);
  assert.doesNotMatch(render, /from '\.\/main\.js/);
  assert.match(lolRoster, /from '\.\/state\.mjs\?v=20260806-lol-roster'/);
});

test('League home and roster panels are mounted by the site', () => {
  assert.match(page, /id="lol-home-ranks"/);
  assert.match(page, /id="lol-roster-grid"/);
  assert.match(page, /id="lol-sync-all-btn"/);
  assert.match(lolRoster, /lolRosterSyncRequest/);
  assert.match(main, /initLolRosterPages\(\)/);
});

test('le bandeau live expose les identifiants interrogés par le JS', () => {
  // Régression : le score de la game n'a jamais été affiché. Le JS le créait à
  // la volée via getElementById('live-header'), mais le bandeau ne portait
  // qu'une CLASSE `live-header` — la condition était donc toujours fausse.
  assert.match(page, /id="live-header"/);
  assert.match(page, /id="live-score"/);
  assert.match(page, /id="live-score-mine"/);
  assert.match(page, /id="live-score-theirs"/);

  // L'élément est désormais déclaré dans le HTML, plus fabriqué en JS.
  assert.doesNotMatch(interactions, /scoreEl\.id = 'live-score'/);

  // Le score de Riot est absolu (Blue/Red) : il doit être réorienté du point de
  // vue de l'observateur, comme le fait la page Historique.
  assert.match(interactions, /selfTeam === 'CHAOS'/);
});

test('saved navigation waits for the application boot to finish', () => {
  assert.doesNotMatch(main, /setTimeout\(\(\) => window\.OLYCITY\?\.nav\(savedPage\)/);
  assert.match(main, /!initHash && validPages\.includes\(savedPage\) \? savedPage : 'home'/);
});

test('history and admin requests cannot stay pending forever', () => {
  const admin = fs.readFileSync(new URL('../js/admin.mjs', import.meta.url), 'utf8');
  const lolPages = fs.readFileSync(new URL('../js/lol-pages.mjs', import.meta.url), 'utf8');
  assert.match(interactions, /valorantHistoryPager\.loadNext/);
  assert.match(interactions, /data-history-load-more/);
  assert.match(lolPages, /lolHistoryPager\.loadNext/);
  assert.match(historyPager, /timeoutMs:8_000/);
  assert.match(historyPager, /timeoutMs:12_000/);
  assert.match(admin, /fetchJsonWithTimeout\(`\$\{FIREBASE_URL\}\/\$\{path\}\.json`/);
});

test('Live and Admin share one realtime Firebase store', () => {
  const admin = fs.readFileSync(new URL('../js/admin.mjs', import.meta.url), 'utf8');
  const lolPages = fs.readFileSync(new URL('../js/lol-pages.mjs', import.meta.url), 'utf8');
  assert.match(liveDataStore, /valorantClients: 'live\/clients'/);
  assert.match(interactions, /liveDataStore\.subscribe/);
  assert.match(lolPages, /liveDataStore\.subscribe/);
  assert.match(admin, /liveDataStore\.subscribe/);
  assert.match(liveDataStore, /new EventSourceImpl\(`\$\{firebaseUrl\}\/live\.json`\)/);
  assert.doesNotMatch(interactions, /new EventSource\(`\$\{FIREBASE_URL\}\/live\/sessions/);
  assert.doesNotMatch(lolPages, /new EventSource\(`\$\{FIREBASE_URL\}\/live\/lolSessions/);
});

test('browser back initializes a page once and Admin reuses cached data', () => {
  const admin = fs.readFileSync(new URL('../js/admin.mjs', import.meta.url), 'utf8');
  assert.equal((main.match(/addEventListener\('popstate'/g) || []).length, 1);
  assert.match(admin, /if \(adminDataLoaded\) \{[\s\S]*?render\(\);[\s\S]*?await loadAll\(\)/);
  assert.match(admin, /if \(overlay !== null\)/);
});
