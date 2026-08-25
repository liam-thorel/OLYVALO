import { fetchJsonWithRetry } from './request-utils.mjs?v=20260825-first-load-recovery';
import { buildHomeActivity, groupNightCalendar, groupNightDateLabel, groupNightNeedsResponse, groupNightVoteSummary, localDateKey, normalizeGroupNight, relativeActivityTime, responseCounts } from './home-group-utils.mjs?v=20260825-group-night-v2';

const FIREBASE_ROOT = 'https://realtime-database-5bb9f-default-rtdb.europe-west1.firebasedatabase.app';
const LAST_SEEN_KEY = 'olycity-home-activity-seen';
const GAMES_CACHE_KEY = 'olycity-home-coop-games';
const PLAN_CACHE_KEY = 'olycity-home-group-night-v2';
const RESPONSE_LABELS = { yes:'présent', maybe:'peut-être', no:'absent' };

let members = [];
let plan = null;
let games = [];
let pendingAvailability = {};
let pendingGameVotes = new Set();
let stream = null;
let reloadTimer = null;
let coopCarouselTimer = null;

function cachedGames() {
  try { return JSON.parse(localStorage.getItem(GAMES_CACHE_KEY) || '{}') || {}; }
  catch { return {}; }
}

function cachedPlan() {
  try { return JSON.parse(localStorage.getItem(PLAN_CACHE_KEY) || 'null'); }
  catch { return null; }
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

function startCoopCarousel() {
  clearInterval(coopCarouselTimer);
  const tile = document.querySelector('.home-world[data-home-world="coop"]');
  const label = tile?.querySelector('.home-world-copy small');
  if (!tile || !label) return;
  const slides = games.filter(game => safeAvatar(game.coverUrl || '')).slice(0, 8);
  if (!slides.length) return;
  let index = 0;
  const show = () => {
    const game = slides[index % slides.length];
    tile.classList.remove('is-slide-ready');
    const image = new Image();
    image.onload = () => {
      tile.style.setProperty('--home-world-image', `url("${String(game.coverUrl).replaceAll('"', '%22')}")`);
      label.textContent = `Dans la liste · ${game.title || 'Coop'}`;
      tile.classList.add('is-slide-ready');
    };
    image.src = game.coverUrl;
    index += 1;
  };
  show();
  if (!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches && slides.length > 1) {
    coopCarouselTimer = window.setInterval(show, 6_500);
  }
}

function renderPlan() {
  const root = document.getElementById('home-tonight-content');
  const open = document.getElementById('home-tonight-open');
  if (!root || !open) return;
  if (!plan) {
    open.textContent = 'Organiser';
    root.innerHTML = '<div><strong id="home-tonight-title">On se retrouve quand ?</strong><small>Choisis une heure et un jeu avec le groupe.</small></div>';
    window.dispatchEvent(new CustomEvent('olycity:group-plan', { detail:{ plan:null, needsResponse:false } }));
    return;
  }
  const counts = responseCounts(plan);
  const people = Object.values(plan.responses || {}).filter(item => item.status !== 'no');
  open.textContent = 'Voir / répondre';
  root.innerHTML = `<div><strong id="home-tonight-title">${escapeHTML(plan.gameTitle)}</strong><small>${escapeHTML(groupNightDateLabel(plan))} · ${counts.yes} présent${counts.yes > 1 ? 's' : ''}${counts.maybe ? ` · ${counts.maybe} peut-être` : ''}</small><span class="home-tonight-people">${people.map(item => personAvatar(item, item.status)).join('')}${people.length ? '' : '<span class="home-activity-empty">En attente des réponses</span>'}</span></div><div class="home-tonight-schedule"><time class="home-tonight-time" datetime="${escapeHTML(`${plan.date}T${plan.time}`)}">${escapeHTML(plan.time)}</time><span>Rappels −30 · −15 min</span></div>`;
  const current = profile();
  window.dispatchEvent(new CustomEvent('olycity:group-plan', { detail:{
    plan, needsResponse:groupNightNeedsResponse(plan, current?.id || current?.name || ''),
  } }));
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
    fetchJsonWithRetry(`${FIREBASE_ROOT}/groupNight/current.json`, { timeoutMs:3_500 }),
    fetchJsonWithRetry(`${FIREBASE_ROOT}/coopGames.json`, { timeoutMs:3_500 }),
    fetchJsonWithRetry(`${FIREBASE_ROOT}/historyIndex/valorant.json${historyQuery}`, { timeoutMs:3_500 }),
    fetchJsonWithRetry(`${FIREBASE_ROOT}/live/lolHistory.json${historyQuery}`, { timeoutMs:3_500 }),
  ]);
  const rawPlan = nightResult.status === 'fulfilled' ? nightResult.value : cachedPlan();
  plan = normalizeGroupNight(rawPlan);
  if (nightResult.status === 'fulfilled') localStorage.setItem(PLAN_CACHE_KEY, JSON.stringify(nightResult.value || null));
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
  startCoopCarousel();
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
  const today = localDateKey();
  const max = localDateKey(new Date(Date.now() + 30 * 86_400_000));
  const slots = plan?.options?.length ? plan.options : [{ id:'slot-1', date:today, time:'21:30' }];
  const slotRoot = document.getElementById('home-night-slot-editors');
  if (slotRoot) slotRoot.innerHTML = [0,1,2].map(index => {
    const slot = slots[index] || {};
    return `<div class="home-slot-editor" data-slot-editor="${index}"><span>${index + 1}</span><input type="date" data-slot-date min="${today}" max="${max}" value="${escapeHTML(slot.date || '')}" ${index ? '' : 'required'}><input type="time" data-slot-time value="${escapeHTML(slot.time || (index ? '' : '21:30'))}" ${index ? '' : 'required'}></div>`;
  }).join('');
  const gameRoot = document.getElementById('home-night-game-editors');
  const options = `<option value="">— aucun —</option>${games.map(game => `<option value="${escapeHTML(game.id)}">${escapeHTML(game.title || 'Sans titre')}</option>`).join('')}`;
  if (gameRoot) gameRoot.innerHTML = [0,1,2].map(index => `<select data-night-game-select aria-label="Jeu proposé ${index + 1}">${options}</select>`).join('');
  gameRoot?.querySelectorAll('[data-night-game-select]').forEach((select, index) => { select.value = plan?.games?.[index]?.id || (index === 0 ? plan?.gameId || '' : ''); });
  const current = profile();
  const response = current ? plan?.responses?.[profileKey(current.id || current.name)] : null;
  pendingAvailability = { ...(response?.availability || {}) };
  pendingGameVotes = new Set(Object.entries(response?.gameVotes || {}).filter(([, value]) => value).map(([id]) => id));
  renderVoteControls(slots, plan?.games || []);
  const calendar = document.getElementById('home-night-calendar');
  if (calendar) calendar.hidden = !plan;
  const finalize = document.getElementById('home-night-finalize');
  if (finalize) {
    finalize.hidden = !plan || !['nico','liam'].includes(String(current?.id || '').toLowerCase());
    finalize.textContent = plan?.final ? 'Rouvrir les votes' : 'Valider le meilleur choix';
  }
  renderAttendees();
  setStatus('');
}

function renderVoteControls(slots = [], gameChoices = []) {
  const root = document.getElementById('home-night-vote');
  if (!root) return;
  if (!plan) {
    root.innerHTML = '<p>Crée les propositions : les membres pourront ensuite voter pour chaque horaire et chaque jeu.</p>';
    return;
  }
  const summary = groupNightVoteSummary(plan);
  root.innerHTML = `<h3>Mes disponibilités</h3><div class="home-vote-slots">${slots.map(slot => {
    const selected = pendingAvailability[slot.id] || '';
    const tally = summary.optionVotes[slot.id] || { yes:0, maybe:0 };
    return `<article><span><strong>${escapeHTML(groupNightDateLabel(slot))} · ${escapeHTML(slot.time)}</strong><small>${tally.yes} oui${tally.maybe ? ` · ${tally.maybe} peut-être` : ''}</small></span><div>${[['yes','Oui'],['maybe','Peut-être'],['no','Non']].map(([status,label]) => `<button type="button" data-vote-slot="${escapeHTML(slot.id)}" data-vote-status="${status}" class="${selected === status ? 'is-active' : ''}">${label}</button>`).join('')}</div></article>`;
  }).join('')}</div>${gameChoices.length ? `<h3>Jeux qui me tentent</h3><div class="home-vote-games">${gameChoices.map(game => `<button type="button" data-vote-game="${escapeHTML(game.id)}" class="${pendingGameVotes.has(game.id) ? 'is-active' : ''}"><strong>${escapeHTML(game.title)}</strong><small>${summary.gameVotes[game.id] || 0} vote${summary.gameVotes[game.id] === 1 ? '' : 's'}</small></button>`).join('')}</div>` : ''}${plan.final ? '<p class="home-night-locked">✓ Le choix final est validé. Les réponses restent visibles.</p>' : ''}`;
}

async function openModal() {
  if (!profile()) {
    window.OLYCITY?._showProfilePicker?.();
    return;
  }
  if (!games.length) await loadHomeGroup().catch(() => {});
  syncForm();
  document.getElementById('home-tonight-modal').hidden = false;
  document.querySelector('[data-slot-time]')?.focus();
}

function closeModal() {
  document.getElementById('home-tonight-modal').hidden = true;
}

async function submitPlan(event) {
  event.preventDefault();
  const current = profile();
  if (!current) return window.OLYCITY?._showProfilePicker?.();
  const submit = event.currentTarget.querySelector('[type="submit"]');
  const options = [...document.querySelectorAll('[data-slot-editor]')].map((row, index) => {
    const date = row.querySelector('[data-slot-date]')?.value || '';
    const time = row.querySelector('[data-slot-time]')?.value || '';
    if (!date || !time) return null;
    return { id:plan?.options?.[index]?.id || `slot-${index + 1}`, date, time, startsAt:new Date(`${date}T${time}:00`).getTime() };
  }).filter(Boolean);
  const selectedIds = [...new Set([...document.querySelectorAll('[data-night-game-select]')].map(select => select.value).filter(Boolean))];
  const gameChoices = selectedIds.map(id => games.find(game => game.id === id)).filter(Boolean).map(game => ({ id:game.id, title:game.title || 'Sans titre', coverUrl:game.coverUrl || '' }));
  const firstSlot = options[0];
  const firstGame = gameChoices[0];
  if (!firstSlot) { setStatus('Ajoute au moins un créneau complet.', true); return; }
  submit.disabled = true;
  setStatus('Enregistrement…');
  try {
    const updatedAt = Date.now();
    await firebaseWrite('groupNight/current', 'PATCH', {
      date:firstSlot.date, time:firstSlot.time, startsAt:firstSlot.startsAt,
      gameId:firstGame?.id || '', gameTitle:firstGame?.title || 'Jeu à décider',
      options:Object.fromEntries(options.map(option => [option.id, option])),
      games:Object.fromEntries(gameChoices.map(game => [game.id, game])), final:null,
      createdBy:plan?.createdBy || current.name, updatedAt,
    });
    const availability = plan ? pendingAvailability : { [firstSlot.id]:'yes' };
    const selectedVotes = pendingGameVotes.size ? pendingGameVotes : new Set(firstGame ? [firstGame.id] : []);
    const statuses = Object.values(availability);
    const status = statuses.includes('yes') ? 'yes' : statuses.includes('maybe') ? 'maybe' : statuses.includes('no') ? 'no' : '';
    await firebaseWrite(`groupNight/current/responses/${profileKey(current.id || current.name)}`, 'PUT', {
      memberId:current.id || '', name:current.name, avatar:current.avatar || '', status, availability,
      gameVotes:Object.fromEntries([...selectedVotes].map(id => [id, true])), updatedAt,
    });
    await loadHomeGroup();
    closeModal();
  } catch (error) {
    setStatus('Impossible d’enregistrer pour le moment. Réessaie.', true);
  } finally { submit.disabled = false; }
}

async function toggleFinalChoice() {
  const current = profile();
  if (!plan || !['nico','liam'].includes(String(current?.id || '').toLowerCase())) return;
  const button = document.getElementById('home-night-finalize');
  button.disabled = true;
  setStatus(plan.final ? 'Réouverture des votes…' : 'Validation du meilleur choix…');
  try {
    if (plan.final) {
      await firebaseWrite('groupNight/current/final', 'PUT', null);
    } else {
      const summary = groupNightVoteSummary(plan);
      await firebaseWrite('groupNight/current/final', 'PUT', {
        optionId:summary.bestOption?.id || plan.options?.[0]?.id || '',
        gameId:summary.bestGame?.id || plan.games?.[0]?.id || '', lockedAt:Date.now(), lockedBy:current.name,
      });
    }
    await loadHomeGroup();
    syncForm();
  } catch {
    setStatus('Impossible de modifier le choix final.', true);
  } finally { button.disabled = false; }
}

function downloadCalendar() {
  const content = groupNightCalendar(plan);
  if (!content) return;
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([content], { type:'text/calendar;charset=utf-8' }));
  link.download = `olycity-${plan.date}.ics`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 0);
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
  document.getElementById('home-night-calendar')?.addEventListener('click', downloadCalendar);
  document.getElementById('home-night-finalize')?.addEventListener('click', toggleFinalChoice);
  document.getElementById('home-night-vote')?.addEventListener('click', event => {
    const slot = event.target.closest('[data-vote-slot]');
    if (slot) {
      pendingAvailability[slot.dataset.voteSlot] = slot.dataset.voteStatus;
      renderVoteControls(plan?.options || [], plan?.games || []);
      return;
    }
    const game = event.target.closest('[data-vote-game]');
    if (!game) return;
    if (pendingGameVotes.has(game.dataset.voteGame)) pendingGameVotes.delete(game.dataset.voteGame);
    else pendingGameVotes.add(game.dataset.voteGame);
    renderVoteControls(plan?.options || [], plan?.games || []);
  });
  document.querySelectorAll('[data-home-sheet-close]').forEach(button => button.addEventListener('click', closeModal));
  document.getElementById('home-tonight-modal')?.addEventListener('click', event => { if (event.target.id === 'home-tonight-modal') closeModal(); });
  window.addEventListener('olycity:profile-change', () => { renderPlan(); if (!document.getElementById('home-tonight-modal')?.hidden) syncForm(); });
  startRealtime();
  loadHomeGroup().catch(() => {
    renderPlan();
    renderActivity([]);
  });
  return () => { stream?.close(); stream = null; clearTimeout(reloadTimer); clearInterval(coopCarouselTimer); };
}
