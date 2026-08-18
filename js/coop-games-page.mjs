import {
  extractSteamAppId,
  filterCoopGames,
  nextCoopStatus,
  normalizeCoopGame,
  profileKey,
  steamCover,
} from './coop-games-utils.mjs';

const FIREBASE_ROOT = 'https://realtime-database-5bb9f-default-rtdb.europe-west1.firebasedatabase.app';
const SESSION_LABELS = { short: 'Soirée', medium: 'Quelques sessions', long: 'Longue aventure' };
const STATUS_LABELS = { open: 'À faire', planned: 'Prévu', played: 'Joué', replay: 'MàJ · À refaire' };

let games = [];
let roster = [];
let initialized = false;
let stream = null;
let reloadTimer = null;
const filters = { search: '', players: 0, status: 'open', sort: 'popular' };

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
        ${steamUrl ? `<a href="${escapeHTML(steamUrl)}" target="_blank" rel="noopener">Steam ↗</a>` : ''}
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
  document.getElementById('coop-title')?.focus();
}

function closeForm() {
  document.getElementById('coop-game-modal')?.classList.remove('open');
}

async function submitGame(event) {
  event.preventDefault();
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
  if (!title || !steamAppId) {
    error.textContent = 'Ajoute un titre et un lien Steam valide.';
    return;
  }
  if (maxPlayers < minPlayers) {
    error.textContent = 'Le maximum de joueurs doit être supérieur au minimum.';
    return;
  }
  if (games.some(game => game.steamAppId === steamAppId && game.status !== 'played')) {
    error.textContent = 'Ce jeu est déjà dans la liste.';
    return;
  }
  const tags = document.getElementById('coop-tags').value.split(',').map(tag => tag.trim()).filter(Boolean).slice(0, 4);
  const game = {
    title,
    steamAppId,
    steamUrl: `https://store.steampowered.com/app/${steamAppId}/`,
    coverUrl: steamCover(steamAppId),
    minPlayers,
    maxPlayers,
    session: document.getElementById('coop-session').value,
    tags,
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
    event.currentTarget.reset();
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
