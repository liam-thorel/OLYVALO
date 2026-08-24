import { fetchJsonWithTimeout } from './request-utils.mjs?v=20260809-route-load-stable';
import { buildHomeActivity, localDateKey, normalizeGroupNight, relativeActivityTime, responseCounts } from './home-group-utils.mjs?v=20260824-game-name';

const FIREBASE_ROOT = 'https://realtime-database-5bb9f-default-rtdb.europe-west1.firebasedatabase.app';
const LAST_SEEN_KEY = 'olycity-home-activity-seen';
const GAMES_CACHE_KEY = 'olycity-home-coop-games';
const RESPONSE_LABELS = { yes:'présent', maybe:'peut-être', no:'absent' };

let members = [];
let plan = null;
let games = [];
let pendingResponse = '';
let stream = null;
let reloadTimer = null;

function cachedGames() {
  try { return JSON.parse(localStorage.getItem(GAMES_CACHE_KEY) || '{}') || {}; }
  catch { return {}; }
}

const escapeHTML = value => String(value ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#39;');

function safeAvatar(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' ? url.href : '';
  } catch { return ''; }
}

function profile() {
  const id = localStorage.getItem('olycity-member-id') || '';
  const name = localStorage.getItem('olycity-profile') || '';
  const member = members.find(item => item.id === id || item.name === name);
  return member || (name && name !== 'Guest' ? { id, name, avatar:'' } : null);
}

function profileKey(value) {
  return String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9_-]/g, '_');
}

function personAvatar(person, status = '') {
  const member = members.find(item => item.id === person.memberId || item.name === person.name);
  const name = person.name || member?.name || '?';
  const avatar = safeAvatar(person.avatar || member?.avatar);
  return `<span class="home-tonight-person${status ? ` is-${escapeHTML(status)}` : ''}" title="${escapeHTML(`${name} · ${RESPONSE_LABELS[status] || status}`)}">${avatar ? `<img src="${escapeHTML(avatar)}" alt="">` : escapeHTML(name.slice(0, 1).toUpperCase())}</span>`;
}

function renderAttendees() {
  const root = document.getElementById('home-night-attendees');
  if (!root) return;
  const responses = Object.values(plan?.responses || {});
  root.innerHTML = responses.length
    ? responses.sort((a, b) => String(a.name).localeCompare(String(b.name), 'fr')).map(item => personAvatar(item, item.status)).join('')
    : '<span class="home-activity-empty">Personne n’a encore répondu.</span>';
}

function renderPlan() {
  const root = document.getElementById('home-tonight-content');
  const open = document.getElementById('home-tonight-open');
  if (!root || !open) return;
  if (!plan) {
    open.textContent = 'Organiser';
    root.innerHTML = '<div><strong id="home-tonight-title">On se retrouve quand ?</strong><small>Choisis une heure et un jeu avec le groupe.</small></div>';
    return;
  }
  const counts = responseCounts(plan);
  const people = Object.values(plan.responses || {}).filter(item => item.status !== 'no');
  open.textContent = 'Répondre';
  root.innerHTML = `<div><strong id="home-tonight-title">${escapeHTML(plan.gameTitle)}</strong><small>${counts.yes} présent${counts.yes > 1 ? 's' : ''}${counts.maybe ? ` · ${counts.maybe} peut-être` : ''}</small><span class="home-tonight-people">${people.map(item => personAvatar(item, item.status)).join('')}${people.length ? '' : '<span class="home-activity-empty">En attente des réponses</span>'}</span></div><time class="home-tonight-time" datetime="${escapeHTML(`${plan.date}T${plan.time}`)}">${escapeHTML(plan.time)}</time>`;
}

function renderActivity(events = []) {
  const root = document.getElementById('home-activity-list');
  const count = document.getElementById('home-activity-count');
  if (!root) return;
  const freshCount = events.filter(event => event.fresh).length;
  if (count) count.textContent = freshCount ? `${freshCount} nouveau${freshCount > 1 ? 'x' : ''}` : '';
  root.innerHTML = events.length
    ? events.map(event => `<div class="home-activity-item" data-kind="${escapeHTML(event.kind)}"><strong>${escapeHTML(event.text)}</strong><time datetime="${new Date(event.ts).toISOString()}">${escapeHTML(relativeActivityTime(event.ts))}</time></div>`).join('')
    : '<span class="home-activity-empty">Rien de nouveau pour le moment.</span>';
}

function setStatus(message = '', error = false) {
  const status = document.getElementById('home-tonight-status');
  if (!status) return;
  status.textContent = message;
  status.classList.toggle('is-error', error);
}

async function firebaseWrite(path, method, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch(`${FIREBASE_ROOT}/${path}.json`, {
      method, body:JSON.stringify(body), signal:controller.signal,
      headers:{ 'Content-Type':'application/json' },
    });
    if (!response.ok) throw new Error(`Firebase HTTP ${response.status}`);
    return response.json();
  } finally { clearTimeout(timer); }
}

async function loadHomeGroup() {
  const historyQuery = '?orderBy=%22%24key%22&limitToLast=6';
  const [nightResult, gamesResult, valorantResult, lolResult] = await Promise.allSettled([
    fetchJsonWithTimeout(`${FIREBASE_ROOT}/groupNight/current.json`, { timeoutMs:3_500 }),
    fetchJsonWithTimeout(`${FIREBASE_ROOT}/coopGames.json`, { timeoutMs:3_500 }),
    fetchJsonWithTimeout(`${FIREBASE_ROOT}/historyIndex/valorant.json${historyQuery}`, { timeoutMs:3_500 }),
    fetchJsonWithTimeout(`${FIREBASE_ROOT}/live/lolHistory.json${historyQuery}`, { timeoutMs:3_500 }),
  ]);
  plan = normalizeGroupNight(nightResult.status === 'fulfilled' ? nightResult.value : null);
  const fetchedGames = gamesResult.status === 'fulfilled' ? gamesResult.value || {} : {};
  const rawGames = Object.keys(fetchedGames).length ? fetchedGames : cachedGames();
  if (Object.keys(fetchedGames).length) localStorage.setItem(GAMES_CACHE_KEY, JSON.stringify(fetchedGames));
  games = Object.entries(rawGames).map(([id, game]) => ({ id, ...(game || {}) }))
    .sort((a, b) => {
      const statusWeight = { planned:4, replay:3, open:2, played:1 };
      return Number(statusWeight[b.status] || 0) - Number(statusWeight[a.status] || 0)
        || Object.keys(b.interests || {}).length - Object.keys(a.interests || {}).length
        || Number(b.submittedAt || 0) - Number(a.submittedAt || 0);
    });
  renderPlan();
  const lastSeen = Number(localStorage.getItem(LAST_SEEN_KEY)) || 0;
  renderActivity(buildHomeActivity({
    valorant:valorantResult.status === 'fulfilled' ? valorantResult.value : {},
    lol:lolResult.status === 'fulfilled' ? lolResult.value : {},
    coop:rawGames,
    plan,
    members,
    lastSeen,
  }));
  localStorage.setItem(LAST_SEEN_KEY, String(Date.now()));
}

function syncForm() {
  const time = document.getElementById('home-tonight-time');
  const select = document.getElementById('home-tonight-game');
  if (time) time.value = plan?.time || '21:30';
  if (select) {
    select.innerHTML = `<option value="">À décider ensemble</option>${games.map(game => `<option value="${escapeHTML(game.id)}">${escapeHTML(game.title || 'Sans titre')}</option>`).join('')}`;
    select.value = plan?.gameId && games.some(game => game.id === plan.gameId) ? plan.gameId : '';
  }
  const current = profile();
  pendingResponse = current ? String(plan?.responses?.[profileKey(current.id || current.name)]?.status || '') : '';
  document.querySelectorAll('[data-night-response]').forEach(button => button.classList.toggle('is-active', button.dataset.nightResponse === pendingResponse));
  renderAttendees();
  setStatus('');
}

async function openModal() {
  if (!profile()) {
    window.OLYCITY?._showProfilePicker?.();
    return;
  }
  if (!games.length) await loadHomeGroup().catch(() => {});
  syncForm();
  document.getElementById('home-tonight-modal').hidden = false;
  document.getElementById('home-tonight-time')?.focus();
}

function closeModal() {
  document.getElementById('home-tonight-modal').hidden = true;
}

async function submitPlan(event) {
  event.preventDefault();
  const current = profile();
  if (!current) return window.OLYCITY?._showProfilePicker?.();
  const submit = event.currentTarget.querySelector('[type="submit"]');
  const time = document.getElementById('home-tonight-time')?.value || '21:30';
  const date = localDateKey();
  const startsAt = new Date(`${date}T${time}:00`).getTime();
  const select = document.getElementById('home-tonight-game');
  const game = games.find(item => item.id === select?.value);
  submit.disabled = true;
  setStatus('Enregistrement…');
  try {
    const updatedAt = Date.now();
    await firebaseWrite('groupNight/current', 'PATCH', {
      date, time, startsAt, gameId:game?.id || '', gameTitle:game?.title || 'Jeu à décider',
      createdBy:current.name, updatedAt,
    });
    if (pendingResponse) await firebaseWrite(`groupNight/current/responses/${profileKey(current.id || current.name)}`, 'PUT', {
      memberId:current.id || '', name:current.name, avatar:current.avatar || '', status:pendingResponse, updatedAt,
    });
    await loadHomeGroup();
    closeModal();
  } catch (error) {
    setStatus('Impossible d’enregistrer pour le moment. Réessaie.', true);
  } finally { submit.disabled = false; }
}

function scheduleReload() {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => loadHomeGroup().catch(() => {}), 180);
}

function startRealtime() {
  if (stream || typeof EventSource === 'undefined') return;
  stream = new EventSource(`${FIREBASE_ROOT}/groupNight/current.json`);
  stream.addEventListener('put', scheduleReload);
  stream.addEventListener('patch', scheduleReload);
}

export function initHomeGroup(nextMembers = []) {
  members = nextMembers;
  document.getElementById('home-tonight-open')?.addEventListener('click', openModal);
  document.getElementById('home-tonight-form')?.addEventListener('submit', submitPlan);
  document.querySelectorAll('[data-home-sheet-close]').forEach(button => button.addEventListener('click', closeModal));
  document.getElementById('home-tonight-modal')?.addEventListener('click', event => { if (event.target.id === 'home-tonight-modal') closeModal(); });
  document.querySelectorAll('[data-night-response]').forEach(button => button.addEventListener('click', () => {
    pendingResponse = button.dataset.nightResponse;
    document.querySelectorAll('[data-night-response]').forEach(item => item.classList.toggle('is-active', item === button));
  }));
  window.addEventListener('olycity:profile-change', () => { renderPlan(); if (!document.getElementById('home-tonight-modal')?.hidden) syncForm(); });
  startRealtime();
  loadHomeGroup().catch(() => {
    renderPlan();
    renderActivity([]);
  });
  return () => { stream?.close(); stream = null; clearTimeout(reloadTimer); };
}
