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
const layout = fs.readFileSync(new URL('../css/layout.css', import.meta.url), 'utf8');
const components = fs.readFileSync(new URL('../css/components.css', import.meta.url), 'utf8');
const responsive = fs.readFileSync(new URL('../css/responsive.css', import.meta.url), 'utf8');
const coopStyles = fs.readFileSync(new URL('../css/coop-games.css', import.meta.url), 'utf8');
const presence = fs.readFileSync(new URL('../js/presence.js', import.meta.url), 'utf8');
const coopPage = fs.readFileSync(new URL('../js/coop-games-page.mjs', import.meta.url), 'utf8');

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

test('le bandeau live ne prétend pas afficher un score indisponible en direct', () => {
  assert.match(page, /id="live-header"/);
  assert.doesNotMatch(page, /id="live-score/);
  assert.doesNotMatch(interactions, /getElementById\('live-score/);
  assert.doesNotMatch(layout, /\.live-score/);
});

test('profile selection is accessible, stable and does not reload the site', () => {
  assert.match(page, /id="profile-picker"[\s\S]*role="dialog"[\s\S]*aria-modal="true"/);
  assert.match(page, /<button class="profile-indicator"/);
  assert.match(main, /localStorage\.setItem\('olycity-member-id', profile\.id\)/);
  assert.match(main, /k !== 'olycity-member-id'/);
  assert.match(main, /window\._changePresence\?\.\(profile\.name\)/);
  assert.doesNotMatch(main, /setTimeout\(\(\) => location\.reload\(\), 300\)/);
  assert.match(components, /\.profile-grid[\s\S]*grid-template-columns/);
  assert.match(components, /\.profile-guest-btn/);
  assert.match(presence, /sessionRef\?\.set/);
  assert.match(presence, /const previousRef = sessionRef/);
});

test('mobile navigation keeps sections scrollable with touch-sized controls', () => {
  assert.match(responsive, /\.page-nav\s*\{[\s\S]*overflow-x:\s*auto/);
  assert.match(responsive, /\.page-nav-btn\s*\{[\s\S]*min-height:\s*44px/);
  assert.match(responsive, /\.game-switch-btn, \.profile-indicator\s*\{\s*min-height:\s*44px/);
  assert.match(main, /nav\.scrollTo\(\{ left:Math\.max\(0, left\)/);
  assert.match(main, /navBtn\.setAttribute\('aria-current', 'page'\)/);
  assert.match(coopStyles, /\.coop-card-actions button,\.coop-card-actions a\{display:flex;min-height:44px/);
});

test('mobile composition cards stay compact without hiding their details', () => {
  assert.match(render, /class="comp-mobile-details"/);
  assert.match(responsive, /\.agents-grid\s*\{[\s\S]*grid-template-columns:\s*repeat\(6,minmax\(0,1fr\)\)/);
  assert.match(responsive, /\.comp-mobile-details\[open\]\s*\+\s*\.comp-bottom\s*\{\s*display:\s*grid/);
  assert.match(responsive, /\.comp-tabs\s*\{[\s\S]*overflow-x:\s*auto/);
  assert.match(main, /const tabs = btn\.closest\('\.comp-tabs'\)/);
});

test('coop games expose explicit categories and cache-safe search modules', () => {
  assert.match(page, /data-coop-status="open"/);
  assert.match(page, /id="coop-genre"/);
  assert.match(page, /<option value="recent" selected>Les derniers ajoutés<\/option>/);
  assert.doesNotMatch(page, /id="coop-status-filter"/);
  assert.doesNotMatch(coopPage, /coop-status-cycle|nextCoopStatus/);
  assert.match(coopPage, /data-action="set-status"/);
  assert.match(coopPage, /coop-games-utils\.mjs\?v=20260823-coop-steam-reviews/);
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
