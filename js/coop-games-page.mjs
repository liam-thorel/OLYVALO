import {
  canDeleteCoopGame,
  catalogFields,
  extractSteamAppId,
  filterCoopGames,
  normalizeCoopGame,
  profileKey,
  rankCatalogResults,
  steamCover,
} from './coop-games-utils.mjs?v=20260823-coop-steam-reviews';
import { fetchSteamReviewSummaries, searchGameCatalog } from './coop-game-catalog.mjs?v=20260823-coop-steam-reviews';
import { mergeFirebaseEvent } from './lol-utils.mjs?v=20260810-firebase-connection-fix';
import { fetchJsonWithRetry } from './request-utils.mjs?v=20260825-first-load-recovery';

const FIREBASE_ROOT = 'https://realtime-database-5bb9f-default-rtdb.europe-west1.firebasedatabase.app';
const COOP_GAMES_CACHE_KEY = 'olycity-coop-games-cache-v1';
const SESSION_LABELS = { short: 'Soirée', medium: 'Quelques sessions', long: 'Longue aventure' };
const STATUS_META = {
  open: { label:'À découvrir', section:'À découvrir', description:'Les idées proposées par le groupe.' },
  planned: { label:'Planifié', section:'Planifiés', description:'Les jeux retenus pour une prochaine session.' },
  replay: { label:'À rejouer', section:'À rejouer', description:'Une mise à jour ou une bonne raison d’y retourner.' },
  played: { label:'Terminé', section:'Terminés', description:'Les jeux que le groupe a déjà faits.' },
};
const STATUS_LABELS = Object.fromEntries(Object.entries(STATUS_META).map(([key, value]) => [key, value.label]));
const STATUS_ORDER = ['open', 'planned', 'replay', 'played'];

let games = [];
let rawGames = {};
let roster = [];
let initialized = false;
let stream = null;
let reloadTimer = null;
let loadSequence = 0;
let realtimeRevision = 0;
let catalogSearchTimer = null;
let catalogSearchSequence = 0;
let catalogAbortController = null;
let selectedCatalogGame = null;
let steamReviews = new Map();
let steamReviewIds = '';
let syncNotice = null;
let recoveryAttempts = 0;
let recoveryTimer = null;
const filters = { search: '', players: 0, genre:'all', status: 'all', sort: 'recent' };

const escapeHTML = value => String(value ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#39;');

function readGamesCache() {
  try {
    const cached = JSON.parse(localStorage.getItem(COOP_GAMES_CACHE_KEY) || 'null');
    if (!cached || typeof cached.savedAt !== 'number' || !Array.isArray(cached.games)) return null;
    return {
      savedAt:cached.savedAt,
      games:cached.games.map(game => normalizeCoopGame(String(game?.id || ''), game)).filter(game => game.id),
    };
  } catch { return null; }
}

function writeGamesCache() {
  try {
    localStorage.setItem(COOP_GAMES_CACHE_KEY, JSON.stringify({ savedAt:Date.now(), games }));
  } catch { /* Le stockage peut être désactivé ou plein sur mobile. */ }
}

function syncNoticeMarkup() {
  if (!syncNotice) return '';
  const offline = syncNotice.state === 'offline';
  return `<div class="coop-cache-note is-${offline ? 'offline' : 'syncing'}" role="status"><span></span><strong>${offline ? 'Copie enregistrée' : 'Jeux déjà disponibles'}</strong><small>${offline ? 'Synchronisation indisponible pour le moment' : 'Synchronisation en arrière-plan…'}</small></div>`;
}

function safeHttpsUrl(value, allowedHosts = null) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:') return '';
    if (allowedHosts && !allowedHosts.some(host => url.hostname === host || url.hostname.endsWith(`.${host}`))) return '';
    return url.href;
  } catch {
    return '';
  }
}

async function firebaseRequest(path, options = {}) {
  const { timeoutMs = 8_000, signal, ...fetchOptions } = options;
  const method = String(fetchOptions.method || 'GET').toUpperCase();
  if (method === 'GET') {
    return fetchJsonWithRetry(`${FIREBASE_ROOT}/${path}.json`, {
      timeoutMs,
      signal,
      init:{ ...fetchOptions, cache:'no-store', headers:{ 'Content-Type':'application/json', ...(fetchOptions.headers || {}) } },
    });
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${FIREBASE_ROOT}/${path}.json`, {
      ...fetchOptions,
      signal:signal || controller.signal,
      headers: { 'Content-Type': 'application/json', ...(fetchOptions.headers || {}) },
    });
    if (!response.ok) throw new Error(`Firebase HTTP ${response.status}`);
    return response.status === 204 ? null : response.json();
  } finally { clearTimeout(timeout); }
}

function selectedProfile() {
  const name = localStorage.getItem('olycity-profile') || '';
  const member = roster.find(player => player.name === name);
  return name && member ? { id: member.id || '', name, avatar: member.avatar || '' } : null;
}

function playerRange(game) {
  return game.minPlayers === game.maxPlayers
    ? `${game.minPlayers} joueur${game.minPlayers > 1 ? 's' : ''}`
    : `${game.minPlayers}–${game.maxPlayers} joueurs`;
}

function interestAvatars(game) {
  const people = Object.values(game.interests || {}).sort((a, b) => String(a.name).localeCompare(String(b.name), 'fr'));
  if (!people.length) return '<span class="coop-no-interest">Personne pour l’instant</span>';
  return people.map(person => {
    const member = roster.find(player => player.name === person.name);
    const avatar = safeHttpsUrl(person.avatar || member?.avatar || '');
    const initial = escapeHTML(String(person.name || '?').slice(0, 1).toUpperCase());
    return `<span class="coop-interest-avatar" title="${escapeHTML(person.name)}">
      ${avatar ? `<img src="${escapeHTML(avatar)}" alt="">` : initial}
    </span>`;
  }).join('');
}

function formatReviewCount(value) {
  return new Intl.NumberFormat('fr-FR', { notation:'compact', maximumFractionDigits:1 }).format(Number(value) || 0);
}

function steamReviewMarkup(game) {
  if (!game.steamAppId) return '';
  const review = steamReviews.get(game.steamAppId);
  if (!review) return '<div class="coop-steam-review is-loading"><span>Steam</span><small>Avis en cours…</small></div>';
  if (review.available === false) return '<div class="coop-steam-review is-empty"><span>Steam</span><small>Avis indisponibles</small></div>';
  if (!review.totalReviews) return '<div class="coop-steam-review is-empty"><span>Steam</span><small>Pas encore d’avis</small></div>';
  const percent = Math.max(0, Math.min(100, Number(review.positivePercent) || 0));
  const tone = percent >= 80 ? 'positive' : percent >= 60 ? 'mixed' : 'negative';
  return `<div class="coop-steam-review is-${tone}" title="${escapeHTML(`${review.totalPositive} avis positifs sur ${review.totalReviews}`)}">
    <span>Steam</span><strong>${percent} % positifs</strong><small>${formatReviewCount(review.totalReviews)} avis</small>
  </div>`;
}

function gameCard(game) {
  const profile = selectedProfile();
  const canDelete = canDeleteCoopGame(profile);
  const interested = profile && game.interests?.[profileKey(profile.name)];
  const cover = safeHttpsUrl(game.coverUrl || steamCover(game.steamAppId));
  const steamUrl = safeHttpsUrl(game.steamUrl, ['steampowered.com']);
  const sourceUrl = steamUrl || safeHttpsUrl(game.sourceUrl, ['igdb.com']);
  const sourceLabel = steamUrl ? 'Steam ↗' : sourceUrl ? 'IGDB ↗' : '';
  const tags = game.tags.map(tag => `<span>${escapeHTML(tag)}</span>`).join('');
  const statusOptions = STATUS_ORDER.map(status => `<button type="button" data-action="set-status" data-status="${status}" role="menuitemradio" aria-checked="${game.status === status}">
    <span class="coop-status-option-dot coop-status-${status}"></span><span><strong>${STATUS_META[status].label}</strong><small>${STATUS_META[status].description}</small></span>${game.status === status ? '<b>✓</b>' : ''}
  </button>`).join('');
  return `<article class="coop-game-card" data-game-id="${escapeHTML(game.id)}">
    <div class="coop-cover">
      ${cover ? `<img src="${escapeHTML(cover)}" alt="Jaquette de ${escapeHTML(game.title)}" loading="lazy" onerror="this.hidden=true">` : ''}
      <div class="coop-status-control">
        <button class="coop-status coop-status-${game.status}" type="button" data-action="status-menu" aria-expanded="false">${STATUS_LABELS[game.status]}<span aria-hidden="true">⌄</span></button>
        <div class="coop-status-menu" role="menu" hidden>
          <div>Changer de catégorie</div>${statusOptions}
          ${canDelete ? `<button class="coop-delete-option" type="button" data-action="delete" role="menuitem">
            <span aria-hidden="true">×</span><span><strong>Supprimer le jeu</strong><small>Retire aussi ses votes</small></span>
          </button>` : ''}
        </div>
      </div>
    </div>
    <div class="coop-card-body">
      <div class="coop-card-meta"><span>${playerRange(game)}</span><span>${SESSION_LABELS[game.session]}</span></div>
      <h3>${escapeHTML(game.title)}</h3>
      ${tags ? `<div class="coop-tags">${tags}</div>` : ''}
      ${steamReviewMarkup(game)}
      ${game.replayNote ? `<div class="coop-replay-note"><strong>Nouveau contenu${game.statusBy ? ` · ${escapeHTML(game.statusBy)}` : ''}</strong>${escapeHTML(game.replayNote)}</div>` : ''}
      ${game.note ? `<p>${escapeHTML(game.note)}</p>` : ''}
      <div class="coop-submitter">Proposé par ${escapeHTML(game.submittedBy)}</div>
      <div class="coop-interest-row">
        <div class="coop-interest-list">${interestAvatars(game)}</div>
        <span class="coop-interest-count">${game.interestCount}</span>
      </div>
      <div class="coop-card-actions">
        <button type="button" class="coop-vote-btn${interested ? ' active' : ''}" data-action="vote">
          ${interested ? '✓ Je suis chaud' : '+ Je suis chaud'}
        </button>
        ${game.status === 'played' ? '<button type="button" class="coop-replay-btn" data-action="replay">Signaler du nouveau</button>' : ''}
        ${sourceUrl ? `<a href="${escapeHTML(sourceUrl)}" target="_blank" rel="noopener">${sourceLabel}</a>` : ''}
      </div>
    </div>
  </article>`;
}

function statusCounts(filteredGames) {
  const counts = { all:filteredGames.length, open:0, planned:0, replay:0, played:0 };
  filteredGames.forEach(game => { if (counts[game.status] !== undefined) counts[game.status] += 1; });
  return counts;
}

function renderStatusTabs() {
  const base = filterCoopGames(games, { ...filters, status:'all' });
  const counts = statusCounts(base);
  document.querySelectorAll('[data-coop-status]').forEach(button => {
    const active = button.dataset.coopStatus === filters.status;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
    const count = button.querySelector('[data-status-count]');
    if (count) count.textContent = counts[button.dataset.coopStatus] || 0;
  });
}

function syncGenreOptions() {
  const select = document.getElementById('coop-genre');
  if (!select) return;
  const current = filters.genre;
  const genres = [...new Set(games.flatMap(game => game.tags || []).map(tag => String(tag).trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, 'fr', { sensitivity:'base' }));
  select.innerHTML = `<option value="all">Tous les genres</option>${genres.map(genre => `<option value="${escapeHTML(genre)}">${escapeHTML(genre)}</option>`).join('')}`;
  select.value = [...select.options].some(option => option.value === current) ? current : 'all';
  filters.genre = select.value;
}

function gameSection(status, sectionGames) {
  if (!sectionGames.length) return '';
  const meta = STATUS_META[status];
  return `<section class="coop-game-section" data-game-section="${status}">
    <header><div><h3>${meta.section}</h3><p>${meta.description}</p></div><strong>${sectionGames.length}</strong></header>
    <div class="coop-games-grid">${sectionGames.map(gameCard).join('')}</div>
  </section>`;
}

function coopStateMarkup(state, title, detail, action = '') {
  return `<div class="data-state-card is-${state} coop-data-state">
    <span class="data-state-pulse" aria-hidden="true"></span>
    <div><strong>${escapeHTML(title)}</strong><small>${escapeHTML(detail)}</small></div>
    ${state === 'loading'
      ? '<span class="data-state-lines" aria-hidden="true"><i></i><i></i></span>'
      : action}
  </div>`;
}

function render() {
  const root = document.getElementById('coop-games-grid');
  const identity = document.getElementById('coop-current-profile');
  const count = document.getElementById('coop-result-count');
  if (!root) return;
  const profile = selectedProfile();
  if (identity) identity.textContent = profile ? `Tu votes en tant que ${profile.name}` : 'Choisis d’abord ton profil';
  const visible = filterCoopGames(games, filters);
  renderStatusTabs();
  if (count) count.textContent = `${visible.length} jeu${visible.length > 1 ? 'x' : ''}`;
  const grouped = filters.status === 'all' && !filters.search;
  const content = visible.length
    ? grouped
      ? STATUS_ORDER.map(status => gameSection(status, visible.filter(game => game.status === status))).join('')
      : `<div class="coop-games-grid">${visible.map(gameCard).join('')}</div>`
    : coopStateMarkup(
      'empty',
      'Aucun jeu ne correspond',
      'Retire un filtre pour retrouver toute la liste.',
      '<button type="button" class="btn btn-primary" data-coop-reset>Réinitialiser</button>',
    );
  root.innerHTML = syncNoticeMarkup() + content;
}

async function loadGames({ quiet = false } = {}) {
  const sequence = ++loadSequence;
  const revision = realtimeRevision;
  const root = document.getElementById('coop-games-grid');
  if (!quiet && root && !games.length) root.innerHTML = coopStateMarkup(
    'loading',
    'Chargement des jeux',
    'Synchronisation des propositions et des votes du groupe.',
  );
  try {
    const data = await firebaseRequest('coopGames');
    if (sequence !== loadSequence || revision !== realtimeRevision) return;
    rawGames = data || {};
    games = Object.entries(rawGames).map(([id, value]) => normalizeCoopGame(id, value));
    syncNotice = null;
    recoveryAttempts = 0;
    clearTimeout(recoveryTimer);
    writeGamesCache();
    syncGenreOptions();
    render();
    void loadSteamReviews();
  } catch (error) {
    if (games.length) {
      syncNotice = { state:'offline' };
      render();
      return;
    }
    if (recoveryAttempts < 2 && document.getElementById('page-games')?.classList.contains('active')) {
      recoveryAttempts += 1;
      if (root) root.innerHTML = coopStateMarkup(
        'loading',
        'Reconnexion à la liste',
        `Nouvelle tentative automatique ${recoveryAttempts}/2…`,
      );
      clearTimeout(recoveryTimer);
      recoveryTimer = setTimeout(() => loadGames(), 700 * recoveryAttempts);
      return;
    }
    if (root) root.innerHTML = coopStateMarkup(
      'error',
      'Liste indisponible',
      'La connexion a été interrompue. Les jeux existants ne sont pas modifiés.',
      '<button type="button" class="btn btn-primary" data-coop-retry>Réessayer</button>',
    );
  }
}

async function loadSteamReviews() {
  const ids = [...new Set(games.map(game => game.steamAppId).filter(Boolean))].sort();
  const key = ids.join(',');
  if (!key) { steamReviews = new Map(); steamReviewIds = ''; return; }
  if (key === steamReviewIds) return;
  steamReviewIds = key;
  try {
    const summaries = await fetchSteamReviewSummaries(ids);
    if (steamReviewIds !== key) return;
    steamReviews = new Map(summaries.map(review => [String(review.steamAppId), review]));
    render();
  } catch (reviewError) {
    if (steamReviewIds === key) {
      steamReviews = new Map(ids.map(steamAppId => [steamAppId, { steamAppId, available:false, totalReviews:0 }]));
      render();
    }
    console.warn('[OLYCITY] Avis Steam indisponibles', reviewError);
  }
}

function scheduleReload() {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => loadGames({ quiet: true }), 120);
}

function applyRealtimeGames(event) {
  try {
    const update = JSON.parse(event.data);
    realtimeRevision += 1;
    loadSequence += 1;
    rawGames = mergeFirebaseEvent(rawGames, update);
    games = Object.entries(rawGames || {}).map(([id, value]) => normalizeCoopGame(id, value));
    syncNotice = null;
    writeGamesCache();
    syncGenreOptions();
    render();
    void loadSteamReviews();
  } catch (error) {
    console.warn('[OLYCITY] Mise à jour Jeux illisible', error);
    scheduleReload();
  }
}

function startRealtime() {
  if (stream || typeof EventSource === 'undefined') return;
  stream = new EventSource(`${FIREBASE_ROOT}/coopGames.json`);
  stream.addEventListener('put', applyRealtimeGames);
  stream.addEventListener('patch', applyRealtimeGames);
  stream.addEventListener('error', () => {
    if (games.length) {
      syncNotice = { state:'offline' };
      render();
    }
  });
}

function restartRealtime() {
  stream?.close();
  stream = null;
  startRealtime();
}

function openForm() {
  if (!selectedProfile()) {
    window.OLYCITY?._showProfilePicker?.();
    return;
  }
  document.getElementById('coop-game-modal')?.classList.add('open');
  document.getElementById('coop-catalog-query')?.focus();
}

function closeForm() {
  document.getElementById('coop-game-modal')?.classList.remove('open');
}

function setSelectValue(id, value) {
  const select = document.getElementById(id);
  if (!select) return;
  const text = String(value);
  if (![...select.options].some(option => option.value === text)) {
    select.add(new Option(text, text));
  }
  select.value = text;
}

function catalogMeta(game) {
  const players = game.minPlayers === game.maxPlayers
    ? `${game.minPlayers} joueur${game.minPlayers > 1 ? 's' : ''}`
    : `${game.minPlayers}–${game.maxPlayers} joueurs`;
  const parts = [players, ...(game.tags || []).slice(0, 2)];
  if (game.releaseDate) parts.push(new Date(`${game.releaseDate}T12:00:00Z`).toLocaleDateString('fr-FR', { year: 'numeric' }));
  return parts.join(' · ');
}

function renderCatalogResults(results = []) {
  const root = document.getElementById('coop-catalog-results');
  if (!root) return;
  root.innerHTML = results.map((result, index) => {
    const game = catalogFields(result);
    const cover = safeHttpsUrl(game.coverUrl);
    return `<button class="coop-catalog-result" type="button" role="option" data-catalog-index="${index}">
      ${cover ? `<img src="${escapeHTML(cover)}" alt="" loading="lazy">` : '<span class="coop-catalog-result-cover"></span>'}
      <span class="coop-catalog-result-copy"><strong>${escapeHTML(game.title)}</strong><span>${escapeHTML(catalogMeta(game))}</span></span>
      <span class="coop-catalog-result-source">${escapeHTML(result.source === 'igdb' ? 'IGDB' : result.source === 'steam' ? 'Steam' : 'Steam · IGDB')}</span>
    </button>`;
  }).join('');
  root.querySelectorAll('[data-catalog-index]').forEach(button => {
    button.addEventListener('click', () => selectCatalogGame(results[Number(button.dataset.catalogIndex)]));
  });
}

function selectCatalogGame(result) {
  selectedCatalogGame = catalogFields(result);
  document.getElementById('coop-title').value = selectedCatalogGame.title;
  document.getElementById('coop-steam').value = selectedCatalogGame.steamUrl;
  document.getElementById('coop-tags').value = selectedCatalogGame.tags.join(', ');
  setSelectValue('coop-min-players', selectedCatalogGame.minPlayers);
  setSelectValue('coop-max-players', selectedCatalogGame.maxPlayers);
  setSelectValue('coop-session', selectedCatalogGame.session);
  const selected = document.getElementById('coop-catalog-selected');
  const cover = safeHttpsUrl(selectedCatalogGame.coverUrl);
  if (selected) {
    selected.hidden = false;
    selected.innerHTML = `${cover ? `<img src="${escapeHTML(cover)}" alt="">` : '<span class="coop-catalog-selected-cover"></span>'}
      <span><strong>${escapeHTML(selectedCatalogGame.title)}</strong><span>${escapeHTML(catalogMeta(selectedCatalogGame))}</span></span>
      <button type="button" id="coop-catalog-change">Changer</button>`;
    selected.querySelector('#coop-catalog-change')?.addEventListener('click', clearCatalogSelection);
  }
  document.getElementById('coop-catalog-results')?.replaceChildren();
  const status = document.getElementById('coop-catalog-status');
  if (status) status.textContent = 'Fiche sélectionnée — tu peux corriger les joueurs ou les genres si besoin.';
}

function clearCatalogSelection() {
  selectedCatalogGame = null;
  const selected = document.getElementById('coop-catalog-selected');
  if (selected) { selected.hidden = true; selected.replaceChildren(); }
  const query = document.getElementById('coop-catalog-query');
  if (query) { query.value = ''; query.focus(); }
  document.getElementById('coop-title').value = '';
  document.getElementById('coop-steam').value = '';
  document.getElementById('coop-tags').value = '';
}

async function runCatalogSearch() {
  const input = document.getElementById('coop-catalog-query');
  const status = document.getElementById('coop-catalog-status');
  const button = document.getElementById('coop-catalog-search-btn');
  const query = input?.value.trim() || '';
  if (query.length < 2) {
    renderCatalogResults([]);
    if (status) status.textContent = query ? 'Encore un caractère…' : '';
    return;
  }
  const requestId = ++catalogSearchSequence;
  catalogAbortController?.abort();
  catalogAbortController = new AbortController();
  if (status) { status.classList.remove('error'); status.textContent = 'Recherche…'; }
  if (button) button.disabled = true;
  try {
    const results = rankCatalogResults(await searchGameCatalog(query, { signal: catalogAbortController.signal }), query);
    if (requestId !== catalogSearchSequence) return;
    renderCatalogResults(results);
    if (status) status.textContent = results.length ? `${results.length} résultat${results.length > 1 ? 's' : ''}` : 'Aucun jeu trouvé — utilise la saisie manuelle.';
  } catch (error) {
    if (error.name === 'AbortError' || requestId !== catalogSearchSequence) return;
    renderCatalogResults([]);
    if (status) {
      status.classList.add('error');
      status.textContent = `${error.message} La saisie manuelle reste disponible.`;
    }
  } finally {
    if (requestId === catalogSearchSequence && button) button.disabled = false;
  }
}

function resetGameForm(form) {
  form.reset();
  selectedCatalogGame = null;
  document.getElementById('coop-catalog-results')?.replaceChildren();
  const selected = document.getElementById('coop-catalog-selected');
  if (selected) { selected.hidden = true; selected.replaceChildren(); }
  const status = document.getElementById('coop-catalog-status');
  if (status) { status.classList.remove('error'); status.textContent = ''; }
  const manual = document.getElementById('coop-manual-fields');
  if (manual) manual.open = false;
}

async function submitGame(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const profile = selectedProfile();
  if (!profile) return window.OLYCITY?._showProfilePicker?.();
  const title = document.getElementById('coop-title').value.trim();
  const steamValue = document.getElementById('coop-steam').value.trim();
  const steamAppId = extractSteamAppId(steamValue);
  const minPlayers = Number(document.getElementById('coop-min-players').value);
  const maxPlayers = Number(document.getElementById('coop-max-players').value);
  const submit = document.getElementById('coop-submit');
  const error = document.getElementById('coop-form-error');
  error.textContent = '';
  if (!title) {
    error.textContent = 'Sélectionne un jeu ou saisis son titre.';
    return;
  }
  if (steamValue && !steamAppId) {
    error.textContent = 'Le lien Steam saisi n’est pas valide.';
    return;
  }
  if (maxPlayers < minPlayers) {
    error.textContent = 'Le maximum de joueurs doit être supérieur au minimum.';
    return;
  }
  const duplicate = games.find(game => game.status !== 'played' && (
    (steamAppId && game.steamAppId === steamAppId)
    || (selectedCatalogGame?.igdbId && game.igdbId === selectedCatalogGame.igdbId)
  ));
  if (duplicate) {
    filters.status = duplicate.status;
    render();
    error.textContent = `Ce jeu est déjà dans « ${STATUS_LABELS[duplicate.status]} ». Ferme cette fenêtre pour le voir.`;
    return;
  }
  const tags = document.getElementById('coop-tags').value.split(',').map(tag => tag.trim()).filter(Boolean).slice(0, 4);
  const game = {
    title,
    steamAppId,
    steamUrl: steamAppId ? `https://store.steampowered.com/app/${steamAppId}/` : '',
    igdbId: selectedCatalogGame?.igdbId || '',
    sourceUrl: selectedCatalogGame?.sourceUrl || (steamAppId ? `https://store.steampowered.com/app/${steamAppId}/` : ''),
    catalogSource: selectedCatalogGame?.catalogSource || (steamAppId ? 'steam' : 'manual'),
    coverUrl: selectedCatalogGame?.coverUrl || steamCover(steamAppId),
    minPlayers,
    maxPlayers,
    session: document.getElementById('coop-session').value,
    tags,
    releaseDate: selectedCatalogGame?.releaseDate || '',
    note: document.getElementById('coop-note').value.trim().slice(0, 280),
    submittedBy: profile.name,
    submittedAt: Date.now(),
    status: 'open',
    interests: {
      [profileKey(profile.name)]: { name: profile.name, avatar: profile.avatar, updatedAt: Date.now() },
    },
  };
  submit.disabled = true;
  submit.textContent = 'Ajout…';
  try {
    await firebaseRequest('coopGames', { method: 'POST', body: JSON.stringify(game) });
    resetGameForm(form);
    closeForm();
    await loadGames({ quiet: true });
  } catch (requestError) {
    error.textContent = `Ajout impossible : ${requestError.message}`;
  } finally {
    submit.disabled = false;
    submit.textContent = 'Ajouter à la liste';
  }
}

async function handleCardAction(event) {
  const button = event.target.closest('[data-action]');
  const card = button?.closest('[data-game-id]');
  if (!button || !card) return;
  const game = games.find(item => item.id === card.dataset.gameId);
  if (button.dataset.action === 'status-menu') {
    const menu = button.closest('.coop-status-control')?.querySelector('.coop-status-menu');
    const opening = Boolean(menu?.hidden);
    document.querySelectorAll('.coop-status-menu').forEach(other => { other.hidden = true; });
    document.querySelectorAll('[data-action="status-menu"]').forEach(other => other.setAttribute('aria-expanded', 'false'));
    if (menu && opening) { menu.hidden = false; button.setAttribute('aria-expanded', 'true'); }
    return;
  }
  const profile = selectedProfile();
  if (!game || !profile) return window.OLYCITY?._showProfilePicker?.();
  button.disabled = true;
  try {
    if (button.dataset.action === 'vote') {
      const key = profileKey(profile.name);
      const current = game.interests?.[key];
      await firebaseRequest(`coopGames/${game.id}/interests/${key}`, {
        method: 'PUT',
        body: JSON.stringify(current ? null : { name: profile.name, avatar: profile.avatar, updatedAt: Date.now() }),
      });
    } else if (button.dataset.action === 'replay') {
      const reason = window.prompt('Qu’est-ce qui donne envie d’y rejouer ? (mise à jour, nouveau contenu…)', 'Nouvelle mise à jour');
      if (reason === null) return;
      await firebaseRequest(`coopGames/${game.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'replay', replayNote: reason.trim().slice(0, 160), statusBy: profile.name, statusAt: Date.now() }),
      });
    } else if (button.dataset.action === 'set-status') {
      const nextStatus = button.dataset.status;
      if (!STATUS_META[nextStatus] || nextStatus === game.status) return;
      let replayNote = game.replayNote || null;
      if (nextStatus === 'replay') {
        const reason = window.prompt('Qu’est-ce qui donne envie d’y rejouer ? (mise à jour, nouveau contenu…)', game.replayNote || 'Nouvelle mise à jour');
        if (reason === null) return;
        replayNote = reason.trim().slice(0, 160);
      } else if (nextStatus === 'played') {
        replayNote = null;
      }
      await firebaseRequest(`coopGames/${game.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          status: nextStatus,
          replayNote,
          statusBy: profile.name,
          statusAt: Date.now(),
        }),
      });
    } else if (button.dataset.action === 'delete') {
      if (!canDeleteCoopGame(profile)) return;
      const confirmed = window.confirm(`Supprimer « ${game.title} » de la liste ?\n\nLes votes associés seront également supprimés. Cette action est définitive.`);
      if (!confirmed) return;
      await firebaseRequest(`coopGames/${game.id}`, { method: 'DELETE' });
    }
    await loadGames({ quiet: true });
  } catch (actionError) {
    window.alert(`Action impossible : ${actionError.message}`);
  } finally {
    button.disabled = false;
  }
}

function bindControls() {
  document.getElementById('coop-add-btn')?.addEventListener('click', openForm);
  document.getElementById('coop-modal-close')?.addEventListener('click', closeForm);
  document.getElementById('coop-game-modal')?.addEventListener('click', event => {
    if (event.target.id === 'coop-game-modal') closeForm();
  });
  document.getElementById('coop-game-form')?.addEventListener('submit', submitGame);
  document.getElementById('coop-catalog-search-btn')?.addEventListener('click', runCatalogSearch);
  document.getElementById('coop-catalog-query')?.addEventListener('input', () => {
    clearTimeout(catalogSearchTimer);
    const value = document.getElementById('coop-catalog-query')?.value.trim() || '';
    if (value.length < 2) {
      catalogAbortController?.abort();
      renderCatalogResults([]);
      const status = document.getElementById('coop-catalog-status');
      if (status) status.textContent = value ? 'Encore un caractère…' : '';
      return;
    }
    catalogSearchTimer = setTimeout(() => {
      runCatalogSearch();
    }, 160);
  });
  document.getElementById('coop-catalog-query')?.addEventListener('keydown', event => {
    if (event.key === 'Enter') { event.preventDefault(); runCatalogSearch(); }
  });
  document.getElementById('coop-games-grid')?.addEventListener('click', handleCardAction);
  document.getElementById('coop-games-grid')?.addEventListener('click', event => {
    if (event.target.closest('[data-coop-retry]')) {
      restartRealtime();
      loadGames();
      return;
    }
    if (!event.target.closest('[data-coop-reset]')) return;
    Object.assign(filters, { search:'', players:0, genre:'all', status:'all', sort:'recent' });
    const search = document.getElementById('coop-search');
    const players = document.getElementById('coop-players');
    const genre = document.getElementById('coop-genre');
    const sort = document.getElementById('coop-sort');
    if (search) search.value = '';
    if (players) players.value = '0';
    if (genre) genre.value = 'all';
    if (sort) sort.value = 'recent';
    render();
  });
  document.addEventListener('click', event => {
    if (event.target.closest('.coop-status-control')) return;
    document.querySelectorAll('.coop-status-menu').forEach(menu => { menu.hidden = true; });
    document.querySelectorAll('[data-action="status-menu"]').forEach(button => button.setAttribute('aria-expanded', 'false'));
  });
  document.getElementById('coop-search')?.addEventListener('input', event => { filters.search = event.target.value; render(); });
  document.getElementById('coop-players')?.addEventListener('change', event => { filters.players = Number(event.target.value); render(); });
  document.getElementById('coop-genre')?.addEventListener('change', event => { filters.genre = event.target.value; render(); });
  document.querySelectorAll('[data-coop-status]').forEach(button => button.addEventListener('click', () => { filters.status = button.dataset.coopStatus; render(); }));
  document.getElementById('coop-sort')?.addEventListener('change', event => { filters.sort = event.target.value; render(); });
  window.addEventListener('olycity:profile-change', render);
}

export function initCoopGamesPage(nextRoster = []) {
  roster = nextRoster;
  if (!initialized) {
    initialized = true;
    const cached = readGamesCache();
    if (cached?.games.length) {
      games = cached.games;
      rawGames = Object.fromEntries(games.map(game => [game.id, game]));
      syncNotice = { state:'syncing', savedAt:cached.savedAt };
    }
    bindControls();
    startRealtime();
    if (games.length) {
      syncGenreOptions();
      render();
      void loadSteamReviews();
      void loadGames({ quiet:true });
    } else {
      void loadGames();
    }
  } else {
    render();
    void loadGames({ quiet:true });
  }
}
