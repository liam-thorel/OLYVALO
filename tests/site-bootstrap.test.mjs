import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const main = fs.readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');
const gameMode = fs.readFileSync(new URL('../js/game-mode.mjs', import.meta.url), 'utf8');
const homeDashboard = fs.readFileSync(new URL('../js/home-dashboard.mjs', import.meta.url), 'utf8');
const homeGroup = fs.readFileSync(new URL('../js/home-group.mjs', import.meta.url), 'utf8');
const pwaInstall = fs.readFileSync(new URL('../js/pwa-install.mjs', import.meta.url), 'utf8');
const interactions = fs.readFileSync(new URL('../js/interactions.js', import.meta.url), 'utf8');
const render = fs.readFileSync(new URL('../js/render.js', import.meta.url), 'utf8');
const lolRoster = fs.readFileSync(new URL('../js/lol-roster.mjs', import.meta.url), 'utf8');
const lolPages = fs.readFileSync(new URL('../js/lol-pages.mjs', import.meta.url), 'utf8');
const page = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const liveDataStore = fs.readFileSync(new URL('../js/live-data-store.mjs', import.meta.url), 'utf8');
const historyPager = fs.readFileSync(new URL('../js/history-pager.mjs', import.meta.url), 'utf8');
const layout = fs.readFileSync(new URL('../css/layout.css', import.meta.url), 'utf8');
const components = fs.readFileSync(new URL('../css/components.css', import.meta.url), 'utf8');
const responsive = fs.readFileSync(new URL('../css/responsive.css', import.meta.url), 'utf8');
const coopStyles = fs.readFileSync(new URL('../css/coop-games.css', import.meta.url), 'utf8');
const lolStyles = fs.readFileSync(new URL('../css/lol-mode.css', import.meta.url), 'utf8');
const homeStyles = fs.readFileSync(new URL('../css/home.css', import.meta.url), 'utf8');
const designSystem = fs.readFileSync(new URL('../css/design-system.css', import.meta.url), 'utf8');
const presence = fs.readFileSync(new URL('../js/presence.js', import.meta.url), 'utf8');
const coopPage = fs.readFileSync(new URL('../js/coop-games-page.mjs', import.meta.url), 'utf8');

test('shared state does not import the versioned entry module twice', () => {
  assert.match(main, /from '\.\/state\.mjs/);
  assert.doesNotMatch(interactions, /from '\.\/main\.js/);
  assert.doesNotMatch(render, /from '\.\/main\.js/);
  assert.match(lolRoster, /from '\.\/state\.mjs\?v=20260806-lol-roster'/);
});

test('League roster panels are mounted without duplicating detailed ranks on home', () => {
  assert.doesNotMatch(page, /id="lol-home-ranks"/);
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

test('OLYCITY is the product brand while games remain contextual modes', () => {
  assert.match(page, /<title>OLYCITY<\/title>/);
  assert.match(page, /name="application-name" content="OLYCITY"/);
  assert.doesNotMatch(page, /id="brand-subtitle"|id="hero-subtitle"/);
  assert.doesNotMatch(gameMode, /setText\('(?:brand|hero)-subtitle'/);
  assert.match(gameMode, /primary\.textContent = '● Voir le Live'/);
});

test('home is one live priority, three visual worlds and a compact member strip', () => {
  assert.match(page, /id="home-now-card"/);
  assert.match(page, /data-home-world="valorant"/);
  assert.match(page, /data-home-world="lol"/);
  assert.match(page, /data-home-world="coop"/);
  assert.match(page, /data-home-world="valorant" data-home-page="maps"/);
  assert.match(page, /data-home-world="lol" data-home-page="roster"/);
  assert.match(homeDashboard, /addEventListener\('click', handleWorldClick\)/);
  assert.match(main, /import \{ getGameMode, initGameMode, setGameMode \} from '\.\/game-mode\.mjs/);
  assert.match(homeStyles, /valorant-keyart\.webp/);
  assert.match(homeStyles, /league-champions-group\.webp/);
  assert.match(homeStyles, /peak-keyart\.webp/);
  assert.match(page, /home\.css\?v=20260824-balanced-app/);
  assert.match(page, /design-system\.css\?v=20260824-balanced-app/);
  assert.match(page, /id="home-member-faces"/);
  assert.match(homeStyles, /\.home-member-face\.online\{border-color:#4bd07b/);
  assert.doesNotMatch(page, /Agents prioritaires|id="stier-row"|id="mini-roster"/);
  assert.match(main, /initHomeDashboard\(/);
  assert.match(homeDashboard, /liveDataStore\.subscribe\(render\)/);
  assert.match(homeStyles, /\.home-world-grid\{display:grid;grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(homeStyles, /@media\(max-width:768px\)/);
  assert.match(page, /id="home-tonight-content"/);
  assert.match(page, /id="home-activity-list"/);
  assert.match(homeGroup, /groupNight\/current/);
  assert.match(main, /initHomeGroup\(state\.MEMBERS\)/);
});

test('profile selection is accessible, stable and does not reload the site', () => {
  assert.match(page, /id="profile-picker"[\s\S]*role="dialog"[\s\S]*aria-modal="true"/);
  assert.match(page, /<button class="profile-indicator"/);
  assert.match(main, /localStorage\.setItem\('olycity-member-id', profile\.id\)/);
  assert.match(main, /'olycity-member-id'/);
  assert.match(main, /window\._changePresence\?\.\(profile\.name\)/);
  assert.doesNotMatch(main, /setTimeout\(\(\) => location\.reload\(\), 300\)/);
  assert.match(components, /\.profile-grid[\s\S]*grid-template-columns/);
  assert.match(components, /\.profile-guest-btn/);
  assert.match(presence, /sessionRef\?\.set/);
  assert.match(presence, /const previousRef = sessionRef/);
});

test('mobile navigation keeps primary sections reachable with a compact more menu', () => {
  assert.match(page, /id="mobile-nav-more-trigger"/);
  assert.match(page, /id="mobile-nav-more-menu" hidden/);
  assert.match(responsive, /\.page-nav\s*\{[\s\S]*position:\s*fixed;[\s\S]*bottom:\s*0/);
  assert.match(responsive, /\.page-nav-btn\s*\{[\s\S]*min-height:\s*54px/);
  assert.match(responsive, /\.page-nav > \.page-nav-btn\[data-page="roster"\][\s\S]*display:\s*none/);
  assert.match(responsive, /\.game-switch-btn, \.profile-indicator\s*\{\s*min-height:\s*44px/);
  assert.match(main, /toggleMobileNavMenu\(\)/);
  assert.match(main, /morePages\.includes\(page\)/);
  assert.match(main, /navBtn\.setAttribute\('aria-current', 'page'\)/);
  assert.match(coopStyles, /\.coop-card-actions button,\.coop-card-actions a\{display:flex;min-height:44px/);
  assert.match(page, /data-page="games" data-nav-scope="shared"/);
  assert.match(designSystem, /:root\[data-game="lol"\] \.page-nav > \.page-nav-btn\[data-page="roster"\][\s\S]*display: flex !important/);
  assert.match(designSystem, /:root\[data-game="lol"\] \.mobile-nav-more-sheet > \[data-mobile-page="roster"\][\s\S]*display: none/);
});

test('mobile composition cards stay compact without hiding their details', () => {
  assert.match(render, /class="comp-mobile-details"/);
  assert.match(responsive, /\.agents-grid\s*\{[\s\S]*grid-template-columns:\s*repeat\(6,minmax\(0,1fr\)\)/);
  assert.match(responsive, /\.comp-mobile-details\[open\]\s*\+\s*\.comp-bottom\s*\{\s*display:\s*grid/);
  assert.match(responsive, /\.comp-tabs\s*\{[\s\S]*overflow-x:\s*auto/);
  assert.match(responsive, /\.lineup-agent-tab, \.map-notes-card summary,[\s\S]*min-height:\s*44px; touch-action:\s*manipulation/);
  assert.match(main, /const tabs = btn\.closest\('\.comp-tabs'\)/);
});

test('maps keep only useful composition and lineup controls', () => {
  assert.match(render, /class="map-notes-card"/);
  assert.match(render, /switchMapTab\('\$\{idx\}','lineups'/);
  assert.doesNotMatch(render, /switchMapTab\([^)]*'(?:draw|notes)'/);
  assert.doesNotMatch(render, /winrate-pill|fav-btn|compare-btn|Efficacité de la comp/);
  assert.doesNotMatch(main, /builder|selectCompare|toggleFav|firebase-draw|callouts\.json/);
  assert.doesNotMatch(page, /page-agents|compare-panel-wrap|firebase-draw/);
  assert.equal(fs.existsSync(new URL('../assets/audio/theme.mp3', import.meta.url)), false);
  assert.equal(fs.existsSync(new URL('../data/callouts.json', import.meta.url)), false);
  assert.equal(fs.existsSync(new URL('../js/firebase-draw.js', import.meta.url)), false);
});

test('mobile data pages keep readable spacing, controls and roster details', () => {
  assert.match(responsive, /#page-history > \.container, #page-betting > \.container/);
  assert.match(responsive, /\.history-load-more-wrap button\s*\{[\s\S]*min-height:\s*46px/);
  assert.match(responsive, /\.live-client-chip\s*\{[\s\S]*min-height:\s*44px/);
  assert.match(responsive, /\.section-inner\s*\{\s*padding:\s*0/);
  assert.match(lolStyles, /\.lol-roster-champion strong\{font-size:10px\}/);
  assert.match(coopStyles, /\.coop-cover\{aspect-ratio:16\/7\}/);
  assert.match(page, /lol-mode\.css\?v=20260824-live-history-density/);
  assert.match(page, /coop-games\.css\?v=20260823-mobile-sections/);
  assert.match(designSystem, /\.history-filter-group\s*\{\s*grid-template-columns:\s*55px minmax\(0,1fr\)/);
  assert.match(designSystem, /\.coop-filter-field:last-child\s*\{\s*flex-basis:\s*100%/);
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

test('startup reveals the shell before optional APIs and supports installation', () => {
  assert.match(page, /window\.setTimeout\([\s\S]*loading-screen[\s\S]*1400/);
  assert.match(main, /await loadData\(\)/);
  assert.doesNotMatch(main, /await Promise\.all\(\[loadData\(\), valorantApi\.load\(\)\]\)/);
  assert.match(main, /olycity-static-data-cache/);
  assert.match(page, /rel="manifest" href="\.\/manifest\.webmanifest"/);
  assert.match(page, /id="pwa-install-band"/);
  assert.match(pwaInstall, /serviceWorker\.register\('\.\/sw\.js'/);
  assert.doesNotMatch(page, /getRegistrations\(\)[\s\S]*unregister/);
});

test('PWA exposes opt-in notifications and admin test controls without touching the bot', () => {
  assert.match(page, /id="home-app-launcher"/);
  assert.match(page, /id="home-app-modal"/);
  assert.match(page, /id="push-notification-band"/);
  assert.match(main, /initPushNotifications/);
  assert.match(fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8'), /addEventListener\('push'/);
  assert.match(fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8'), /self\.registration\.scope/);
  assert.match(fs.readFileSync(new URL('../js\/admin.mjs', import.meta.url), 'utf8'), /admin-test-notification/);
});

test('Live and Coop explain loading, empty and recovery states', () => {
  assert.match(page, /id="live-waiting-title"/);
  assert.match(page, /id="live-waiting-detail"/);
  assert.match(interactions, /waitingTitle\.textContent = summary\.ready/);
  assert.match(coopPage, /coopStateMarkup\(/);
  assert.match(coopPage, /data-coop-retry/);
  assert.match(coopPage, /data-coop-reset/);
});

test('history prioritizes recent matches and reveals secondary data progressively', () => {
  assert.match(interactions, /view:'matches'/);
  assert.match(interactions, /limit:20/);
  assert.match(interactions, /data-history-show-more/);
  assert.match(lolPages, /class="lol-history-recap"/);
  assert.match(page, /class="live-client-details"/);
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
