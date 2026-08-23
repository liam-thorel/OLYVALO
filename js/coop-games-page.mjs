import {
  catalogFields,
  extractSteamAppId,
  filterCoopGames,
  nextCoopStatus,
  normalizeCoopGame,
  profileKey,
  steamCover,
} from './coop-games-utils.mjs';
import { searchGameCatalog } from './coop-game-catalog.mjs';

const FIREBASE_ROOT = 'https://realtime-database-5bb9f-default-rtdb.europe-west1.firebasedatabase.app';
const SESSION_LABELS = { short: 'Soirée', medium: 'Quelques sessions', long: 'Longue aventure' };
const STATUS_LABELS = { open: 'À faire', planned: 'Prévu', played: 'Joué', replay: 'MàJ · À refaire' };

let games = [];
let roster = [];
let initialized = false;
let stream = null;
let reloadTimer = null;
let catalogSearchTimer = null;
let catalogSearchSequence = 0;
let catalogAbortController = null;
let selectedCatalogGame = null;
const filters = { search: '', players: 0, status: 'all', sort: 'popular' };

const escapeHTML = value => String(value ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#39;');

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
  const response = await fetch(`${FIREBASE_ROOT}/${path}.json`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  if (!response.ok) throw new Error(`Firebase HTTP ${response.status}`);
  return response.status === 204 ? null : response.json();
}

function selectedProfile() {
  const name = localStorage.getItem('olycity-profile') || '';
  const member = roster.find(player => player.name === name);
  return name && member ? { name, avatar: member.avatar || '' } : null;
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

function gameCard(game) {
  const profile = selectedProfile();
  const interested = profile && game.interests?.[profileKey(profile.name)];
  const cover = safeHttpsUrl(game.coverUrl || steamCover(game.steamAppId));
  const steamUrl = safeHttpsUrl(game.steamUrl, ['steampowered.com']);
  const sourceUrl = steamUrl || safeHttpsUrl(game.sourceUrl, ['igdb.com']);
  const sourceLabel = steamUrl ? 'Steam ↗' : sourceUrl ? 'IGDB ↗' : '';
  const tags = game.tags.map(tag => `<span>${escapeHTML(tag)}</span>`).join('');
  return `<article class="coop-game-card" data-game-id="${escapeHTML(game.id)}">
    <div class="coop-cover">
      ${cover ? `<img src="${escapeHTML(cover)}" alt="Jaquette de ${escapeHTML(game.title)}" loading="lazy" onerror="this.hidden=true">` : ''}
      <span class="coop-status coop-status-${game.status}">${STATUS_LABELS[game.status]}</span>
      <button class="coop-status-cycle" type="button" data-action="status" title="Passer à l’état suivant">↻</button>
    </div>
    <div class="coop-card-body">
      <div class="coop-card-meta"><span>${playerRange(game)}</span><span>${SESSION_LABELS[game.session]}</span></div>
      <h3>${escapeHTML(game.title)}</h3>
      ${tags ? `<div class="coop-tags">${tags}</div>` : ''}
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
        ${game.status === 'played' ? '<button type="button" class="coop-replay-btn" data-action="replay">↻ MàJ / Rejouer</button>' : ''}
        ${sourceUrl ? `<a href="${escapeHTML(sourceUrl)}" target="_blank" rel="noopener">${sourceLabel}</a>` : ''}
      </div>
    </div>
  </article>`;
}

function render() {
  const root = document.getElementById('coop-games-grid');
  const identity = document.getElementById('coop-current-profile');
  const count = document.getElementById('coop-result-count');
  if (!root) return;
  const profile = selectedProfile();
  if (identity) identity.textContent = profile ? `Tu votes en tant que ${profile.name}` : 'Choisis d’abord ton profil';
  const visible = filterCoopGames(games, filters);
  if (count) count.textContent = `${visible.length} jeu${visible.length > 1 ? 'x' : ''}`;
  root.innerHTML = visible.length
    ? visible.map(gameCard).join('')
    : `<div class="coop-empty"><strong>Aucun jeu ici</strong><span>Change les filtres ou propose le premier.</span></div>`;
}

async function loadGames({ quiet = false } = {}) {
  const root = document.getElementById('coop-games-grid');
  if (!quiet && root && !games.length) root.innerHTML = '<div class="coop-empty">Chargement de la liste…</div>';
  try {
    const data = await firebaseRequest('coopGames');
    games = Object.entries(data || {}).map(([id, value]) => normalizeCoopGame(id, value));
    render();
  } catch (error) {
    if (root) root.innerHTML = `<div class="coop-empty coop-error">Impossible de charger la liste. ${escapeHTML(error.message)}</div>`;
  }
}

function scheduleReload() {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => loadGames({ quiet: true }), 120);
}

function startRealtime() {
  if (stream || typeof EventSource === 'undefined') return;
  stream = new EventSource(`${FIREBASE_ROOT}/coopGames.json`);
  stream.addEventListener('put', scheduleReload);
  stream.addEventListener('patch', scheduleReload);
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

function normalizeCatalogText(value = '') {
  return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function rankCatalogResults(results = [], query = '') {
  const wanted = normalizeCatalogText(query);
  const tokens = wanted.split(/\s+/).filter(Boolean);
  return [...results].sort((left, right) => {
    const score = result => {
      const title = normalizeCatalogText(result.title);
      if (title === wanted) return 10000;
      let value = title.startsWith(wanted) ? 5000 : title.includes(wanted) ? 3000 : 0;
      value += tokens.filter(token => title.includes(token)).length * 500;
      value -= Math.abs(title.length - wanted.length);
      return value;
    };
    return score(right) - score(left);
  }).slice(0, 8);
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
    const statusFilter = document.getElementById('coop-status-filter');
    if (statusFilter) statusFilter.value = duplicate.status;
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
    } else if (button.dataset.action === 'status') {
      await firebaseRequest(`coopGames/${game.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          status: nextCoopStatus(game.status),
          replayNote: nextCoopStatus(game.status) === 'played' ? null : game.replayNote || null,
          statusBy: profile.name,
          statusAt: Date.now(),
        }),
      });
    }
    await loadGames({ quiet: true });
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
  document.getElementById('coop-search')?.addEventListener('input', event => { filters.search = event.target.value; render(); });
  document.getElementById('coop-players')?.addEventListener('change', event => { filters.players = Number(event.target.value); render(); });
  document.getElementById('coop-status-filter')?.addEventListener('change', event => { filters.status = event.target.value; render(); });
  document.getElementById('coop-sort')?.addEventListener('change', event => { filters.sort = event.target.value; render(); });
  window.addEventListener('olycity:profile-change', render);
}

export function initCoopGamesPage(nextRoster = []) {
  roster = nextRoster;
  if (!initialized) {
    initialized = true;
    bindControls();
    startRealtime();
    loadGames();
  } else {
    render();
  }
}
