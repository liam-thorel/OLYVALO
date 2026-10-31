/**
 * OLYCITY · Interactions
 * 3D tilt, parallax, theme toggle, search, keyboard shortcuts.
 */

import { storage } from './storage.js';
import { valorantApi } from './api.js';
import { state } from './state.mjs?v=20261005-sites-history';
import {
  groupLiveSessions,
  mergeSelectedSessionData,
  stablePlayersForSession,
  stableServerForSession,
  stableSessionForRender,
} from './live-sessions.mjs?v=20260809-live-server-local';
import { chooseLiveSession, freshLiveClients, groupLiveClients, isVersionAtLeast, liveClientSummary, liveSessionSignal, recoveringLiveClients, retainRecentLiveClients } from './live-clients.mjs?v=20261005-return-live';
import { liveClientStatus, liveClientSummaryText, liveWaitingState } from './live-status.mjs?v=20261005-sites-history';
import { buildLiveIdentityIndex, resolveLiveIdentity } from './live-identities.mjs?v=20261006-proprietaire';
import { updateScriptDownload } from './downloads.mjs?v=20260912-separate-downloads';
import { PLAYERS as LOL_ROSTER_PLAYERS } from './lol-roster.mjs?v=20261006-puuid-lol';
import { serverVisual } from './server-visuals.mjs?v=20260809-live-server-local';
import { avatarLayersHTML } from './avatars.mjs?v=20260720-avatars';
import { filterHistoryGames, historyGameForOwner, historyMode, historyOwnerKey, historyOwnerLabel, historyPlayerName, historyPlayerPerformance, historyPlayerPerformances, historyRankedPlayers, historyReports, historyScoreText, historyTrackerUrl, isHistorySelf, normalizeHistoryEntries } from './history-utils.mjs?v=20261005-sites-history';
import { initCurse } from './curse.mjs?v=20260828-page-stream-lifecycle';
import { fetchJsonWithTimeout } from './request-utils.mjs?v=20260930-consistent-live';
import { liveDataStore, liveTimestamp } from './live-data-store.mjs?v=20261005-return-live';
import { createHistoryPager } from './history-pager.mjs?v=20261031-saison';
import { rosterAccounts } from './roster-card-utils.mjs?v=20261006-proprietaire';
import { inAct, loadCurrentAct } from './valorant-act.mjs?v=20261031-saison';
import { featuredPerformance, gameDurationMs, trackedPerformances, historyAgentStats, historyDayGroups, historyMapStats, historyMemberStats, historyOverview, historyRosterMember, valorantTierIcon, valorantTierLabel } from './history-overview.mjs?v=20261031-saison';
import { createHistoryDisclosureState } from './history-disclosure-state.mjs';
import { liveScoreKey, liveScoreView } from './live-score.mjs?v=20260930-consistent-live';

const historyDisclosures = createHistoryDisclosureState('data-history-id');

// Le store peut appeler son abonné immédiatement avec une partie déjà chargée.
const RANK_NAMES = [
  'Unranked','Unranked','Unranked','Iron 1','Iron 2','Iron 3',
  'Bronze 1','Bronze 2','Bronze 3','Silver 1','Silver 2','Silver 3',
  'Gold 1','Gold 2','Gold 3','Platinum 1','Platinum 2','Platinum 3',
  'Diamond 1','Diamond 2','Diamond 3','Ascendant 1','Ascendant 2','Ascendant 3',
  'Immortal 1','Immortal 2','Immortal 3','Radiant',
];
const RANK_COLORS = {
  Iron:'#8b9bb4', Bronze:'#cd7f32', Silver:'#c0c0c0', Gold:'#f5c842',
  Platinum:'#40c9c9', Diamond:'#9b59b6', Ascendant:'#2ecc71',
  Immortal:'#e74c3c', Radiant:'#ffd700', Unranked:'#555',
};

const VALORANT_HISTORY_CACHE_KEY = 'olycity-valorant-history-cache-v1';
let historyLoadSequence = 0;
let valorantHistoryReady = false;
let lastValorantHistoryState = null;
let lastValorantHistorySavedAt = 0;
let valorantHistoryRecoveryAttempts = 0;
let valorantHistoryRecoveryTimer = null;
const valorantHistoryPager = createHistoryPager({
  firebaseUrl:'https://realtime-database-5bb9f-default-rtdb.europe-west1.firebasedatabase.app',
  indexPath:'historyIndex/valorant',
  dataPath:'live/history',
  pageSize:30,
});
const historyEscape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
const VALORANT_LIVE_MODE_LABELS = Object.freeze({
  competitive:'Compétitif', unrated:'Non classé', swiftplay:'Vélocité', spikerush:'Spike Rush',
  deathmatch:'Deathmatch', hurm:'Team Deathmatch', ggteam:'Intensification', onefa:'Réplication',
  snowball:'Bataille de boules de neige', newmap:'Nouvelle carte', premier:'Premier',
  custom:'Partie personnalisée', aros:'All Random One Site', dodgeball:'K.-O.',
  fortcollins:'Retake', skirmish:'Escarmouche', skirmishascension:'Escarmouche : Ascension',
  abilitydraftarena:'Gauntlet: Glitched', gauntlet:'Gauntlet: Glitched',
});

function valorantLiveModeLabel(data = {}) {
  const raw = data.queueId || (data.mode === 'agent-select' ? '' : data.mode) || '';
  const token = String(raw).trim().replace(/^social_mode_/i, '').split('/').pop().split('.')[0].toLowerCase();
  return VALORANT_LIVE_MODE_LABELS[token] || data.modeLabel || raw || 'Mode Riot';
}

function valorantLiveMapLabel(value) {
  return String(value || '').trim() === 'AbilityDraft' ? 'Arènes Gauntlet' : value;
}

function readValorantHistoryCache() {
  try {
    const cached = JSON.parse(localStorage.getItem(VALORANT_HISTORY_CACHE_KEY) || 'null');
    if (!cached || typeof cached.savedAt !== 'number' || !cached.state?.data || typeof cached.state.data !== 'object' || !Object.keys(cached.state.data).length) return null;
    return cached;
  } catch { return null; }
}

function rememberValorantHistory(state) {
  lastValorantHistoryState = state;
  lastValorantHistorySavedAt = Date.now();
  try {
    localStorage.setItem(VALORANT_HISTORY_CACHE_KEY, JSON.stringify({ savedAt:lastValorantHistorySavedAt, state }));
  } catch { /* Le stockage peut être indisponible ou plein sur mobile. */ }
}

function historySyncMarkup(syncState) {
  if (!syncState) return '';
  const offline = syncState.state === 'offline';
  const elapsed = Math.max(0, Date.now() - Number(syncState.savedAt || 0));
  const age = elapsed < 60_000 ? 'à l’instant'
    : elapsed < 3_600_000 ? `il y a ${Math.max(1, Math.round(elapsed / 60_000))} min`
      : elapsed < 86_400_000 ? `il y a ${Math.round(elapsed / 3_600_000)} h`
        : new Date(syncState.savedAt).toLocaleDateString('fr-FR', { day:'numeric', month:'short' });
  return `<div class="history-cache-note is-${offline ? 'offline' : 'syncing'}" role="status"><span></span><strong>${offline ? 'Mode hors connexion' : 'Historique enregistré affiché'}</strong><small>${offline ? 'Dernière copie' : 'Actualisation en cours'} · ${historyEscape(age)}</small></div>`;
}

// ─── THEME TOGGLE ─────────────────────────────────
export function initTheme() {
  const saved = storage.getTheme();
  document.documentElement.setAttribute('data-theme', saved);
  const icon = document.getElementById('theme-icon');
  if (icon) icon.textContent = saved === 'dark' ? '☾' : '☀';

  const btn = document.getElementById('theme-toggle');
  if (btn) {
    btn.addEventListener('click', () => {
      const cur = document.documentElement.getAttribute('data-theme');
      const next = cur === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      if (icon) icon.textContent = next === 'dark' ? '☾' : '☀';
      storage.setTheme(next);
    });
  }
}

// ─── 3D TILT on agent cards ───────────────────────
export function initTilt() {
  document.querySelectorAll('.agent-card').forEach(card => {
    if (card.dataset.tiltBound) return;
    card.dataset.tiltBound = '1';
    const inner = card.querySelector('.agent-card-inner');
    card.addEventListener('mousemove', (e) => {
      const r = card.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width;
      const y = (e.clientY - r.top) / r.height;
      const rx = (y - 0.5) * -14;
      const ry = (x - 0.5) * 14;
      inner.style.transform = `rotateX(${rx}deg) rotateY(${ry}deg)`;
    });
    card.addEventListener('mouseleave', () => {
      inner.style.transform = 'rotateX(0) rotateY(0)';
    });
  });
}

// ─── PARALLAX on hero ─────────────────────────────
export function initParallax() {
  document.addEventListener('mousemove', (e) => {
    const x = (e.clientX / window.innerWidth - 0.5) * 20;
    const y = (e.clientY / window.innerHeight - 0.5) * 20;
    const frame = document.querySelector('.hero-title-frame');
    if (frame) frame.style.transform = `translate(${x * 0.3}px, ${y * 0.3}px)`;
    const g1 = document.querySelector('.bg-glow-1');
    const g2 = document.querySelector('.bg-glow-2');
    if (g1) g1.style.transform = `translate(${x}px, ${y}px)`;
    if (g2) g2.style.transform = `translate(${-x}px, ${-y}px)`;
  });
}

// ─── SEARCH BY AGENT ──────────────────────────────
export function buildAgentIndex() {
  const idx = {};
  Object.keys(valorantApi.agents).forEach(name => { idx[name] = []; });
  state.COMPS_DATA.forEach((mapData, mi) => {
    mapData.comps.forEach((comp, ci) => {
      comp.agents.forEach(name => {
        if (!idx[name]) idx[name] = [];
        idx[name].push({ map: mapData.map, mapIdx: mi, compIdx: ci, compLabel: comp.label });
      });
    });
  });
  return idx;
}

export function initSearch(onAgentSelect) {
  const searchInput = document.getElementById('search-input');
  const searchResults = document.getElementById('search-results');
  if (!searchInput || !searchResults) return;

  function performSearch(q) {
    if (!q || q.length < 1) {
      searchResults.classList.remove('show');
      searchResults.innerHTML = '';
      return;
    }
    const idx = buildAgentIndex();
    const qLower = q.toLowerCase();
    const matches = Object.keys(idx).filter(n => n.toLowerCase().includes(qLower));
    if (matches.length === 0) {
      searchResults.innerHTML = `<div class="search-empty">Aucun agent trouvé</div>`;
      searchResults.classList.add('show');
      return;
    }
    // Agents
    const agentItems = matches.slice(0, 5).map(name => {
      const img = valorantApi.agentImg(name);
      const display = name === 'KAY/O' ? 'KAYO' : name;
      const occurrences = idx[name];
      const r = state.ROLES[name] || 'D';
      const roleLabel = state.ROLE_LABEL[r];
      const imgEl = img
        ? `<img src="${img}" alt="${display}">`
        : `<div class="portrait-ph" style="font-size:14px">${display[0]}</div>`;
      const detail = occurrences.length > 0
        ? `${roleLabel} · ${occurrences.length} comp${occurrences.length > 1 ? 's' : ''}`
        : `${roleLabel} · Hors meta`;
      return `<div class="search-result-item" data-agent="${name}" data-type="agent">
        <div class="search-result-thumb">${imgEl}</div>
        <div class="search-result-info">
          <span class="search-result-name">${display}</span>
          <span class="search-result-detail">${detail}</span>
        </div>
        <span style="font-size:8px;letter-spacing:1.5px;color:var(--dim);text-transform:uppercase;flex-shrink:0">Agent</span>
      </div>`;
    }).join('');

    // Maps
    const mapsData = state.COMPS_DATA || [];
    const mapMatches = mapsData.filter(m => m.map.toLowerCase().includes(qLower));
    const mapItems = mapMatches.slice(0, 3).map((m, i) => {
      const mi = mapsData.indexOf(m);
      const mapIcon = valorantApi.maps[m.map]?.icon;
      const iconEl = mapIcon
        ? `<img src="${mapIcon}" style="width:36px;height:22px;object-fit:cover;object-position:center;flex-shrink:0">`
        : `<div class="portrait-ph" style="width:36px;height:22px;font-size:10px">${m.map[0]}</div>`;
      return `<div class="search-result-item" data-map-idx="${mi}" data-type="map">
        <div class="search-result-thumb" style="width:36px;height:22px;overflow:hidden">${iconEl}</div>
        <div class="search-result-info">
          <span class="search-result-name">${m.map}</span>
          <span class="search-result-detail">${m.comps.length} comps · ${m.stats.difficulty}</span>
        </div>
        <span style="font-size:8px;letter-spacing:1.5px;color:var(--dim);text-transform:uppercase;flex-shrink:0">Map</span>
      </div>`;
    }).join('');

    const sep = agentItems && mapItems
      ? `<div style="height:1px;background:var(--border);margin:2px 0"></div>` : '';

    searchResults.innerHTML = agentItems + sep + mapItems;
    searchResults.classList.add('show');

    // Bind clicks
    searchResults.querySelectorAll('.search-result-item').forEach(item => {
      item.addEventListener('click', () => {
        searchInput.value = '';
        searchResults.classList.remove('show');
        if (item.dataset.type === 'agent') {
          onAgentSelect(item.dataset.agent);
        } else if (item.dataset.type === 'map') {
          const mi = +item.dataset.mapIdx;
          window.OLYCITY.nav('maps');
          setTimeout(() => {
            const btn = document.querySelector(`[data-map-idx="${mi}"]`);
            window.OLYCITY.showMap(mi, btn);
          }, 120);
        }
      });
    });
  }

  searchInput.addEventListener('input', (e) => performSearch(e.target.value));
  searchInput.addEventListener('focus', (e) => { if (e.target.value) performSearch(e.target.value); });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-wrap') && !e.target.closest('.search-results')) {
      searchResults.classList.remove('show');
    }
  });
}

// ─── KEYBOARD SHORTCUTS ───────────────────────────
export function initKeyboard(onEscape) {
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') onEscape();
  });
}

// ─── HERO SNAKE ──────────────────────────────────
export function initHeroParticles() {
  const canvas = document.getElementById('hero-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let W, H, raf, t = 0;

  const resize = () => {
    W = canvas.width = canvas.offsetWidth;
    H = canvas.height = canvas.offsetHeight;
  };
  resize();
  window.addEventListener('resize', resize);

  // Snake: a long trail of points following a sinusoidal path
  const TRAIL = 220;
  const points = [];

  // Snake head movement — organic figure-8 / lissajous path
  let hx = W * 0.5, hy = H * 0.5;
  let angle = 0;
  const speed = 1.4;

  const draw = () => {
    const leagueMode = document.documentElement.dataset.game === 'lol';
    t += 0.012;
    ctx.clearRect(0, 0, W, H);

    // Move head along a slow organic lissajous curve
    hx = W * 0.5 + Math.sin(t * 0.7) * W * 0.38 + Math.sin(t * 1.3) * W * 0.08;
    hy = H * 0.5 + Math.sin(t * 0.9) * H * 0.32 + Math.cos(t * 1.1) * H * 0.1;

    // Push new head position
    points.unshift({ x: hx, y: hy });
    if (points.length > TRAIL) points.pop();

    if (points.length < 2) { raf = requestAnimationFrame(draw); return; }

    // Draw trail as a thick glowing line that fades toward the tail
    for (let i = 1; i < points.length; i++) {
      const progress = 1 - i / points.length; // 1 at head, 0 at tail
      const alpha = progress * progress * 0.55;
      const width = progress * 3.5 + 0.3;

      ctx.beginPath();
      ctx.moveTo(points[i - 1].x, points[i - 1].y);
      ctx.lineTo(points[i].x, points[i].y);
      ctx.strokeStyle = leagueMode
        ? `rgba(201,${Math.floor(125 + progress * 30)},${Math.floor(40 + progress * 22)},${alpha})`
        : `rgba(255,${Math.floor(40 + progress * 30)},${Math.floor(60 + progress * 20)},${alpha})`;
      ctx.lineWidth = width;
      ctx.lineCap = 'round';
      ctx.stroke();
    }

    // Glowing head dot
    const grd = ctx.createRadialGradient(hx, hy, 0, hx, hy, 18);
    grd.addColorStop(0, leagueMode ? 'rgba(201,155,63,0.45)' : 'rgba(255,80,70,0.45)');
    grd.addColorStop(1, leagueMode ? 'rgba(25,120,170,0)' : 'rgba(255,50,60,0)');
    ctx.beginPath();
    ctx.arc(hx, hy, 18, 0, Math.PI * 2);
    ctx.fillStyle = grd;
    ctx.fill();

    // Bright head core
    ctx.beginPath();
    ctx.arc(hx, hy, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = leagueMode ? 'rgba(238,205,119,0.95)' : 'rgba(255,120,100,0.9)';
    ctx.fill();

    raf = requestAnimationFrame(draw);
  };
  draw();
  return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize); };
}


// ─── GRANDE ROUE CANVAS ──────────────────────────
function drawWheel(canvas, size, speed, alpha) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const cx = size * 0.5, cy = size * 0.5;
  const R = size * 0.42; // outer radius
  let angle = 0, raf;

  const draw = () => {
    const leagueMode = document.documentElement.dataset.game === 'lol';
    const primary = leagueMode ? '#c99b3f' : '#ff4656';
    const secondary = leagueMode ? '#1682b8' : '#a87fff';
    const tertiary = leagueMode ? '#62b9d4' : '#3fcfcf';
    const gondolaColors = [primary,secondary,tertiary,primary,secondary,tertiary,primary,secondary];
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.globalAlpha = alpha;

    // Supports legs (static)
    ctx.strokeStyle = primary; ctx.lineWidth = size * 0.025;
    ctx.beginPath(); ctx.moveTo(cx, cy + R * 0.95); ctx.lineTo(cx - R * 0.45, canvas.height - 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx, cy + R * 0.95); ctx.lineTo(cx + R * 0.45, canvas.height - 2); ctx.stroke();
    ctx.strokeStyle = secondary; ctx.lineWidth = size * 0.018;
    ctx.beginPath(); ctx.moveTo(cx - R * 0.45, canvas.height - 2); ctx.lineTo(cx + R * 0.45, canvas.height - 2); ctx.stroke();

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);

    // Outer ring
    ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2);
    ctx.strokeStyle = primary; ctx.lineWidth = size * 0.022; ctx.stroke();

    // Inner ring
    ctx.beginPath(); ctx.arc(0, 0, R * 0.32, 0, Math.PI * 2);
    ctx.strokeStyle = primary; ctx.globalAlpha = alpha * 0.4; ctx.lineWidth = size * 0.012; ctx.stroke();
    ctx.globalAlpha = alpha;

    // 8 spokes
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * R * 0.32, Math.sin(a) * R * 0.32);
      ctx.lineTo(Math.cos(a) * R, Math.sin(a) * R);
      ctx.strokeStyle = i % 2 === 0 ? secondary : tertiary;
      ctx.lineWidth = size * 0.012;
      ctx.globalAlpha = alpha * 0.8; ctx.stroke(); ctx.globalAlpha = alpha;
    }

    // Gondolas
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const gx = Math.cos(a) * R, gy = Math.sin(a) * R;
      const gr = size * 0.058;
      ctx.beginPath(); ctx.arc(gx, gy, gr, 0, Math.PI * 2);
      ctx.fillStyle = gondolaColors[i]; ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = size * 0.008; ctx.stroke();
    }

    // Center hub
    ctx.beginPath(); ctx.arc(0, 0, size * 0.07, 0, Math.PI * 2);
    ctx.fillStyle = primary; ctx.fill();
    ctx.beginPath(); ctx.arc(0, 0, size * 0.042, 0, Math.PI * 2);
    ctx.fillStyle = secondary; ctx.fill();
    ctx.beginPath(); ctx.arc(0, 0, size * 0.022, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.fill();

    ctx.restore();
    ctx.restore();
    // Lu par hub-transition.mjs : la roue qui s'envole vers olycity.fr part
    // de l'angle exact où celle-ci se trouve.
    canvas.wheelAngle = angle;
    angle += speed;
    raf = requestAnimationFrame(draw);
  };
  draw();
  return () => cancelAnimationFrame(raf);
}

export function initWheelLogos() {
  drawWheel(document.getElementById('logo-canvas-topbar'), 36, 0.008, 1);
}

// ─── LIVE PAGE ────────────────────────────────────────
export function initLivePage() {
  const FIREBASE_URL = 'https://realtime-database-5bb9f-default-rtdb.europe-west1.firebasedatabase.app';
  let lastMapName = null;
  let currentLiveData = null;

  const curse = initCurse();

  let selectedSession = null;
  let lastSessions = {};
  let lastStoreSessions = null;
  let lastClients = {};
  let liveStoreStatus = {};
  let lastConfirmedSession = null;
  let liveSignalState = 'ended';
  let byMatchCache = {};
  const stableRosterCache = new Map();
  const stablePregameCache = new Map();
  const stableServerCache = new Map();
  const serverImageFailures = new Map();
  let latestLiveVersion = '';
  let _rosterIdentityIndex = null;
  let _rosterFetched = false;
  let _mapsCache = null;
  const agentIconCache = {};
  const agentUuidMap = { ...(window._agentNameToUuid || {}) }; // name → uuid
  const uuidToName = {}; // uuid → name (source de vérité API)
  Object.entries(agentUuidMap).forEach(([name, uuid]) => {
    if (uuid) uuidToName[String(uuid).toLowerCase()] = name;
  });

  // Les compositions peuvent être rendues avant la réponse de Valorant-API.
  // Une fois les UUID reçus, on invalide explicitement la carte Agent Select :
  // son ancienne clé map|side ne suffisait pas à provoquer un second rendu.
  fetch('https://valorant-api.com/v1/agents?isPlayableCharacter=true')
    .then(response => {
      if (!response.ok) throw new Error(`Valorant assets HTTP ${response.status}`);
      return response.json();
    })
    .then(payload => {
      window._agentNameToUuid = window._agentNameToUuid || {};
      payload.data?.forEach(agent => {
        agentUuidMap[agent.displayName] = agent.uuid;
        uuidToName[agent.uuid.toLowerCase()] = agent.displayName;
        window._agentNameToUuid[agent.displayName] = agent.uuid;
      });
      const compsPanel = document.getElementById('live-comps-panel');
      if (compsPanel) delete compsPanel.dataset.key;
      if (currentLiveData) {
        lastDataKey = '';
        updateUI(currentLiveData);
      }
    })
    .catch(() => {});

  fetch(`./live/update-manifest.json?v=${Date.now()}`)
    .then(response => response.ok ? response.json() : null)
    .then(manifest => {
      latestLiveVersion = manifest?.version || '';
      renderDiagnostic();
    })
    .catch(() => {});

  function rosterProfileForName(name = '') {
    return resolveLiveIdentity({ playerName: name }, _rosterIdentityIndex);
  }

  // Depuis la v4.16.0, chaque script publie le membre OLYCITY choisi à
  // l'installation. C'est la source la plus fiable : contrairement au Riot ID,
  // elle reste juste immédiatement après un changement de pseudo, sans
  // attendre que rosterOverlay/accounts soit relu.
  function profileForEntry(entry = {}) {
    return resolveLiveIdentity(entry, _rosterIdentityIndex)
      || (entry.member ? { avatar: '', member: entry.member } : null);
  }

  function ensureRosterCache() {
    if (_rosterFetched) return;
    _rosterFetched = true;
    if (state.ROSTER.length) {
      _rosterIdentityIndex = buildLiveIdentityIndex(state.ROSTER, state.ROSTER_OVERLAY || {}, LOL_ROSTER_PLAYERS);
      renderDiagnostic();
      updateSessionPicker(lastSessions);
      return;
    }
    fetch('./data/roster.json?v=20260809-mathis-main').then(response => response.json()).then(roster => {
      // Le roster local suffit immédiatement pour les comptes principaux et
      // les smurfs connus. Firebase enrichit ensuite l'index avec les comptes
      // rattachés dans l'admin, sans pouvoir bloquer l'affichage des prénoms.
      _rosterIdentityIndex = buildLiveIdentityIndex(roster, {}, LOL_ROSTER_PLAYERS);
      renderDiagnostic();
      updateSessionPicker(lastSessions);
      return fetch(`${FIREBASE_URL}/rosterOverlay.json`)
        .then(response => response.ok ? response.json() : null)
        .then(overlay => {
          if (!overlay) return;
          _rosterIdentityIndex = buildLiveIdentityIndex(roster, overlay, LOL_ROSTER_PLAYERS);
          renderDiagnostic();
          updateSessionPicker(lastSessions);
        })
        .catch(() => {});
    }).catch(() => {});
  }
  window.addEventListener('olycity:roster-identity-change',()=>{
    _rosterIdentityIndex = buildLiveIdentityIndex(state.ROSTER, state.ROSTER_OVERLAY || {}, LOL_ROSTER_PLAYERS);
    renderDiagnostic();
    updateSessionPicker(lastSessions);
    if (currentLiveData) { lastDataKey='';updateUI(currentLiveData); }
  });
  // Round timer using roundStartTime from Firebase
  let timerInterval = null;
  let lastRoundStart = null;
  let lastMinimapKey = '';
  function startRoundTimer(startTime, phase) {
    if (timerInterval) clearInterval(timerInterval);
    const PHASE_DURATION = { 'shopping': 30, 'combat': 100, 'end': 9, 'game_end': 9 };
    const duration = PHASE_DURATION[phase?.toLowerCase()] || 100;
    timerInterval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      const remaining = Math.max(0, duration - elapsed);
      const timerEl = document.getElementById('live-timer');
      if (timerEl) timerEl.textContent = `${Math.floor(remaining/60)}:${String(remaining%60).padStart(2,'0')}`;
    }, 500);
  }

  let lastDataKey = '';
  const escapeDiagnosticText = value => String(value || '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);

  function renderDiagnostic() {
    const panel = document.getElementById('live-diagnostic');
    const label = document.getElementById('live-diagnostic-label');
    const detail = document.getElementById('live-diagnostic-detail');
    const version = document.getElementById('live-diagnostic-version');
    const list = document.getElementById('live-client-list');
    const download = document.getElementById('live-download-link');
    const waitingTitle = document.getElementById('live-waiting-title');
    const waitingDetail = document.getElementById('live-waiting-detail');
    if (!panel || !label || !detail || !version || !list) return;

    ensureRosterCache();
    const freshClients = freshLiveClients(lastClients, lastSessions);
    const recoveringClients = recoveringLiveClients(lastClients, lastSessions);
    const clients = [...freshClients, ...recoveringClients];
    const summary = liveClientSummary(freshClients);
    const transportIssue = Boolean(liveStoreStatus.valorantClients?.error || liveStoreStatus.valorantSessions?.error);

    if (!summary.total && !recoveringClients.length) {
      const channels = [liveStoreStatus.valorantClients, liveStoreStatus.valorantSessions].filter(Boolean);
      const loading = channels.some(status => !status.loaded);
      const reconnecting = channels.some(status => status.error);
      panel.dataset.state = reconnecting ? 'error' : 'offline';
      label.textContent = reconnecting ? 'Reconnexion au Live'
        : loading ? 'Connexion aux données Live' : 'Aucun script connecté';
      detail.textContent = reconnecting ? 'Les dernières données restent affichées'
        : loading ? 'Synchronisation Firebase en cours' : 'Les membres actifs apparaîtront ici';
      version.textContent = '—';
      list.innerHTML = '';
      updateScriptDownload(download);
      if (waitingTitle) waitingTitle.textContent = reconnecting ? 'Reconnexion au Live…'
        : loading ? 'Connexion au Live…'
        : liveSignalState === 'expired' ? 'Suivi interrompu' : 'Aucun script connecté';
      if (waitingDetail) waitingDetail.textContent = reconnecting
        ? 'La connexion sera relancée automatiquement.'
        : loading ? 'Vérification des membres connectés.'
        : liveSignalState === 'expired'
          ? 'Le dernier signal était trop ancien. La partie reviendra automatiquement si le script reprend.'
          : 'Lance OLYCITY Live : la prochaine partie apparaîtra ici automatiquement.';
      return;
    }

    panel.dataset.state = !summary.total || transportIssue ? 'error' : summary.inGame ? 'in-game'
      : summary.agentSelect ? 'agent-select'
        : summary.issues ? 'error' : 'idle';
    label.textContent = summary.total
      ? `${summary.total} membre${summary.total > 1 ? 's' : ''} en ligne`
      : 'Signal des scripts interrompu';
    detail.textContent = !summary.total
      ? `${recoveringClients.length} dernier${recoveringClients.length > 1 ? 's' : ''} état${recoveringClients.length > 1 ? 's' : ''} conservé${recoveringClients.length > 1 ? 's' : ''} · reconnexion en cours`
      : [
      liveClientSummaryText(summary),
      recoveringClients.length && `${recoveringClients.length} signal${recoveringClients.length > 1 ? 's' : ''} perdu${recoveringClients.length > 1 ? 's' : ''}`,
      transportIssue && 'Flux Live en reconnexion',
    ].filter(Boolean).join(' · ');
    const versions = [...new Set(clients.map(client => client.version).filter(Boolean))];
    const updateNeeded = versions.length > 1 || Boolean(latestLiveVersion && clients.some(client => (
      client.version && !isVersionAtLeast(client.version, latestLiveVersion)
    )));
    version.textContent = versions.length > 1
      ? `${versions.length} versions`
      : versions.length === 1 ? `v${versions[0]}` : 'Version inconnue';
    updateScriptDownload(download, updateNeeded, latestLiveVersion);
    const waiting = liveWaitingState(summary);
    if (waitingTitle) waitingTitle.textContent = waiting.title;
    if (waitingDetail) waitingDetail.textContent = waiting.detail;

    const renderClient = (client, compactContext = false) => {
      const profile = profileForEntry(client);
      const displayName = profile?.member || client.playerName?.split('#')[0] || 'Joueur inconnu';
      const safeName = escapeDiagnosticText(displayName);
      const avatar = profile
        ? avatarLayersHTML(profile.member, profile.avatar)
        : `<span class="live-client-initial">${safeName.slice(0, 1).toUpperCase()}</span>`;
      const recovering = client.age >= 60000;
      const status = liveClientStatus(client, { recovering });
      const stateLabel = status.key === 'inGame' && client.activity !== 'reconnect'
        ? 'En partie' : status.label;
      const safeState = status.tone;
      const context = compactContext ? '' : ['inGame', 'agentSelect'].includes(status.key)
        ? valorantLiveMapLabel(client.map) : '';
      const details = escapeDiagnosticText([client.playerName, status.label, client.map, client.server, client.side, client.error].filter(Boolean).join(' · '));
      return `<div class="live-client-chip${client.puuid === selectedSession ? ' selected' : ''}" data-state="${safeState}" title="${details}">
        <span class="live-client-avatar">${avatar}</span>
        <span class="live-client-info">
          <strong>${safeName}</strong>
          <small>${stateLabel}${context ? ` · ${escapeDiagnosticText(context)}` : ''}</small>
        </span>
        <span class="live-client-chip-version">${client.version ? `v${escapeDiagnosticText(client.version)}` : '—'}</span>
      </div>`;
    };

    list.innerHTML = groupLiveClients(clients).map(group => {
      if (group.clients.length === 1) return renderClient(group.clients[0]);
      const reference = group.clients.find(client => client.map || client.server || client.side) || group.clients[0];
      const context = group.matchId
        ? [valorantLiveMapLabel(reference.map), reference.server, reference.side].filter(Boolean).join(' · ')
        : `${reference.partySize || group.clients.length}${reference.partyCapacity ? '/' + reference.partyCapacity : ''} dans le groupe`;
      return `<div class="live-client-group" data-state="${escapeDiagnosticText(reference.state || 'online')}">
        <div class="live-client-group-heading">
          <strong>${group.matchId ? 'Même partie' : 'Même groupe Riot'}</strong>
          <small>${escapeDiagnosticText(context || 'Match partagé')}</small>
        </div>
        <div class="live-client-group-members">${group.clients.map(client => renderClient(client, true)).join('')}</div>
      </div>`;
    }).join('');
  }

  const diagnosticTicker = setInterval(renderDiagnostic, 5000);

  function handleSSE(e) {
    try {
      const msg = JSON.parse(e.data);
      const path = msg.path || '/';
      const data = msg.data;

      const isTick = e.type === 'tick';
      if (path === '/') {
        // Full replace — keep client receive timestamps
        const incoming = (data && typeof data === 'object') ? data : {};
        if (!isTick) {
          const rx = Date.now();
          Object.keys(incoming).forEach(k => {
            // Preserve old _rxAt only if session content unchanged on tick; real events refresh it
            incoming[k] = {...incoming[k], _rxAt: rx};
          });
          lastSessions = incoming;
        }
        // On tick: keep lastSessions as-is (just re-evaluate filters below)
      } else {
        // Partial update — path is like '/d70bdb3f-...'
        const puuid = path.replace(/^\//, '').split('/')[0];
        const subPath = path.replace(/^\/[^/]+/, '');
        if (puuid) {
          if (!lastSessions[puuid]) lastSessions[puuid] = {};
          if (subPath) {
            const field = subPath.replace(/^\//, '');
            lastSessions[puuid][field] = data;
          } else {
            // A Firebase `put` replaces the whole session. Merging it would keep
            // fields removed by Firebase (notably an empty `players` array).
            if (e.type === 'put') {
              if (data === null) delete lastSessions[puuid];
              else lastSessions[puuid] = data && typeof data === 'object' ? { ...data } : data;
            } else if (data && typeof data === 'object') {
              Object.assign(lastSessions[puuid], data);
            } else {
              lastSessions[puuid] = data;
            }
          }
          if (lastSessions[puuid] && typeof lastSessions[puuid] === 'object') lastSessions[puuid]._rxAt = Date.now();
        }
      }
      const sessions = lastSessions;
      const now = Date.now();
      const pickerSessions = { ...sessions };
      if (selectedSession && !sessions[selectedSession]
        && lastConfirmedSession?.key === selectedSession
        && ['live', 'recovering'].includes(liveSessionSignal(lastConfirmedSession.data, now))) {
        pickerSessions[selectedSession] = lastConfirmedSession.data;
      }
      updateSessionPicker(pickerSessions);

      const choice = chooseLiveSession(sessions, selectedSession, lastConfirmedSession, now);
      const { active, selectedEnded } = choice;
      if (selectedEnded) lastConfirmedSession = null;
      selectedSession = choice.selectedSession;
      let liveData = choice.data;
      liveData = mergeSelectedSessionData(liveData, selectedSession, byMatchCache);
      liveData = stableSessionForRender(liveData, selectedSession, stablePregameCache);
      const signalState = choice.recoveredFromCache ? 'recovering'
        : !liveData && lastConfirmedSession && !selectedEnded ? 'expired'
          : liveSessionSignal(liveData, now);
      if (!choice.recoveredFromCache && ['live', 'recovering'].includes(signalState)) {
        lastConfirmedSession = { key:selectedSession, data:liveData, confirmedAt:now };
      }
      if (signalState === 'ended' && selectedEnded) lastConfirmedSession = null;
      liveSignalState = signalState;

      // Key tracks ALL active sessions so any update triggers re-render
      const key = JSON.stringify({
        signalState,
        active: liveData?.active, map: liveData?.mapClean, mode: liveData?.mode,
        phase: liveData?.phase, roundPhase: liveData?.roundPhase,
        matchId: liveData?.matchId, side: liveData?.side,
        server: liveData?.server, scriptVersion: liveData?.scriptVersion,
        // Sans le score dans la clé, une manche gagnée ne redessine rien :
        // c'est souvent le seul champ qui change entre deux polls.
        score: liveScoreKey(liveData),
        activeCount: active.length,
        allPlayers: active.map(([,s]) => (s.players||[]).length).join(','),
        players: (liveData?.players||[]).map(p=>`${p.name}|${p.agentId||p.agent}|${p.team}|${p.rank?.tier??''}|${p.rank?.peakTier??''}|${p.rank?.peakHistorical??''}|${p.rank?.level??''}|${(p.rank?.rrHistory||[]).join('.')}|${p.rank?.rrEarned??''}|${p.rank?.season?.games??''}|${p.rank?.season?.winRatePct??''}`)
      });
      if (key !== lastDataKey) {
        lastDataKey = key;
        currentLiveData = liveData;
        updateUI(currentLiveData, signalState);
      }
    } catch(err) { console.error(err); }
  }
  const unsubscribeLiveData = liveDataStore.subscribe(snapshot => {
    liveStoreStatus = snapshot.status || {};
    const nextClients = snapshot.valorantClients || {};
    const nextSessions = snapshot.valorantSessions || {};
    lastClients = retainRecentLiveClients(lastClients, nextClients);
    if (nextSessions !== lastStoreSessions) {
      lastStoreSessions = nextSessions;
      handleSSE({
        type: 'store',
        data: JSON.stringify({ path: '/', data: nextSessions }),
      });
    }
    renderDiagnostic();
  });

  // Periodic staleness check — re-evaluate even without new SSE events
  const staleChecker = setInterval(() => {
    try { handleSSE({ type: 'tick', data: JSON.stringify({ path: '/', data: lastSessions }) }); } catch {}
  }, 10000);

  function updateSessionPicker(sessions) {
    let picker = document.getElementById('live-session-picker');
    const page = document.getElementById('page-live');
    if (!page) return;

    const _now = Date.now();
    const active = Object.entries(sessions).filter(([,s]) => ['live', 'recovering'].includes(liveSessionSignal(s, _now)));
    
    byMatchCache = groupLiveSessions(active);

    // Swapping is useful between matches, not between two clients in one match.
    if (Object.keys(byMatchCache).length <= 1) {
      if (picker) picker.remove();
      return;
    }

    // Group by matchId first, then by player overlap as fallback
    const byMatch = byMatchCache;

    if (!picker) {
      picker = document.createElement('div');
      picker.id = 'live-session-picker';
      picker.className = 'live-session-picker';
      picker.addEventListener('click', event => {
        const button = event.target.closest('[data-live-session]');
        if (!button) return;
        window._selectLiveSession(button.dataset.liveSession);
      });
      page.querySelector('.live-page')?.prepend(picker);
    }

    const allPuuids = active.map(([p]) => p);
    if (!selectedSession || !allPuuids.includes(selectedSession)) {
      selectedSession = allPuuids[0] || null;
    }
    const renderSelected = selectedSession;

    // Roster lookup — fetched once per page load (module cache)
    ensureRosterCache();

    picker.innerHTML = `
      <div class="live-session-picker-heading">
        <span>Parties en cours</span>
        <small>Choisissez le match à suivre</small>
      </div>
      <div class="live-session-picker-list">
      ${Object.entries(byMatch).map(([mid, sessions]) => {
        const first = sessions[0];
        const isSelected = sessions.some(p => p.puuid === renderSelected);
        const recovering = sessions.every(session => liveSessionSignal(session, _now) === 'recovering');
        const map = valorantLiveMapLabel(first.mapClean || first.map || '?');
        const mode = valorantLiveModeLabel(first);
        const server = first.server || '';

        // Find roster avatars for players in this game
        const rosterAvatars = sessions.map(s => {
          const hit = profileForEntry(s);
          return hit ? { avatar: hit.avatar, member: hit.member } : null;
        }).filter(Boolean);

        const avatarsHtml = rosterAvatars.length
          ? `<span class="live-session-avatars">
              ${rosterAvatars.map(profile => `<span class="live-session-avatar">${avatarLayersHTML(profile.member, profile.avatar)}</span>`).join('')}
            </span>`
          : '';

        const names = sessions.map(s => s.playerName?.split('#')[0]).join(' & ');
        // Le puuid atterrit dans un attribut data : on le conserve encodé puis
        // la délégation de clic du conteneur le transmet au sélecteur.
        return `<button class="live-session-card${isSelected ? ' is-selected' : ''}" data-live-session="${encodeURIComponent(sessions[0].puuid)}" type="button"${isSelected ? ' aria-current="true"' : ''}>
          ${avatarsHtml}
          <span class="live-session-copy">
            <strong>${escapeDiagnosticText(map.toUpperCase())}</strong>
            <span>${escapeDiagnosticText(names)}</span>
            <small>${escapeDiagnosticText([mode, server].filter(Boolean).join(' · '))}</small>
          </span>
          <span class="live-session-state">${recovering ? 'Reconnexion' : isSelected ? 'Affichée' : 'Voir'}</span>
        </button>`;
      }).join('')}
      </div>`;
  }

  window._selectLiveSession = (encodedPuuid) => {
    // Contrepartie de l'encodage fait au rendu du bouton ci-dessus.
    let puuid = encodedPuuid;
    try { puuid = decodeURIComponent(encodedPuuid); } catch { /* déjà en clair */ }
    selectedSession = puuid;
    updateSessionPicker(lastSessions); // re-render picker immediately with new selection
    renderDiagnostic();
    const rawData = lastSessions[puuid] || null;
    const mergedData = mergeSelectedSessionData(rawData, selectedSession, byMatchCache);
    const data = stableSessionForRender(mergedData, selectedSession, stablePregameCache);
    if (data) {
      const signalState = liveSessionSignal(data);
      if (['live', 'recovering'].includes(signalState)) {
        lastConfirmedSession = { key:puuid, data, confirmedAt:Date.now() };
      }
      liveSignalState = signalState;
      lastDataKey = '';
      currentLiveData = data;
      updateUI(data, signalState);
    }
  };

  async function loadMapImg(mapName) {
    if (mapName === lastMapName) return;
    lastMapName = mapName;
    try {
      if (!_mapsCache) {
        const r = await fetch('https://valorant-api.com/v1/maps');
        _mapsCache = (await r.json()).data || [];
      }
      const m = _mapsCache.find(m => m.displayName?.toLowerCase() === mapName?.toLowerCase()
        || m.mapUrl?.toLowerCase().includes(mapName?.toLowerCase()));
      const imgEl = document.getElementById('live-map-img');
      if (imgEl) {
        const source = m?.splash || m?.displayIcon || '';
        imgEl.hidden = !source;
        imgEl.alt = source && mapName ? `Carte ${mapName}` : '';
        if (source) imgEl.src = source;
        else imgEl.removeAttribute('src');
      }
    } catch { _mapsCache = null; }
  }

  function renderLiveScore(data) {
    const scoreEl = document.getElementById('live-score');
    if (!scoreEl) return;
    const view = liveScoreView(data);
    scoreEl.hidden = !view;
    if (!view) return;
    scoreEl.dataset.state = view.state;
    const set = (id, value) => {
      const el = document.getElementById(id);
      if (el && el.textContent !== String(value)) el.textContent = String(value);
    };
    set('live-score-mine', view.mine);
    set('live-score-theirs', view.theirs);
    set('live-score-mine-label', view.labels[0]);
    set('live-score-theirs-label', view.labels[1]);
    scoreEl.setAttribute('aria-label', `Score : ${view.labels[0]} ${view.mine}, ${view.labels[1]} ${view.theirs}`);
  }

  function updateUI(data, signalState = liveSessionSignal(data)) {
    const waiting = document.getElementById('live-waiting');
    const content = document.getElementById('live-content');
    const dot = document.getElementById('live-dot');
    const signalNotice = document.getElementById('live-signal-notice');
    const selectedClient = lastClients[selectedSession] || {};

    if (!data?.active || signalState === 'expired' || signalState === 'invalid') {
      if (signalNotice) signalNotice.hidden = true;
      if (waiting) waiting.style.display = 'flex';
      if (content) content.style.display = 'none';
      if (dot && document.documentElement.dataset.game === 'valorant') dot.style.display = 'none';
      curse?.setLive(false);
      return;
    }

    if (signalNotice) {
      signalNotice.hidden = signalState !== 'recovering';
      if (signalState === 'recovering') signalNotice.textContent = 'Signal Live interrompu · dernier état connu affiché, reconnexion en cours.';
    }

    if (waiting?.style.display !== 'none')  waiting.style.display  = 'none';
    if (content?.style.display !== 'block') content.style.display  = 'block';
    if (dot && document.documentElement.dataset.game === 'valorant' && dot.style.display !== 'block') dot.style.display = 'block';

    const isPregame = data?.phase === 'pregame' || data?.mode === 'agent-select';
    const liveMode = data?.queueId || (data?.mode === 'agent-select' ? '' : data?.mode) || '';
    const liveModeLabel = valorantLiveModeLabel(data);
    const isGauntlet = String(liveMode).toLowerCase() === 'abilitydraftarena'
      || String(liveModeLabel).toLowerCase() === 'gauntlet: glitched';
    const liveHeader = content?.querySelector('.live-header');
    const liveBody = content?.querySelector('.live-body');
    if (liveHeader) liveHeader.style.display = isPregame ? 'none' : '';
    liveHeader?.classList.toggle('is-gauntlet', isGauntlet);
    if (liveBody) liveBody.style.display = isPregame ? 'none' : '';

    // Map — guard + internal name conversion
    // Internal codename → display. Includes wrong legacy values from old scripts.
    const _MAP_DISPLAY = {
      'Ascent':'Ascent','Bonsai':'Split','Duality':'Bind','Triad':'Haven','Port':'Icebox',
      'Foxtrot':'Breeze','Canyon':'Fracture','Pitt':'Pearl','Jam':'Lotus','Juliett':'Sunset',
      'Infinity':'Abyss','Rook':'Corrode','Plummet':'Summit','Poveglia':'Range','Range':'Range',
      'AbilityDraft':'Arènes Gauntlet',
      'HURM_Alley':'District','HURM_Yard':'Piazza','HURM_Bowl':'Kasbah','HURM_Helix':'Drift','HURM_HighTide':'Glitch',
    };
    // Prefer the raw internal map code (most reliable), fall back to mapClean
    const _internal = (data.mapInternal || data.map?.split('/')?.pop() || '').trim();
    const _fromInternal = _MAP_DISPLAY[_internal];
    const mapName = _fromInternal || _MAP_DISPLAY[data.mapClean] || data.mapClean || data.mapDisplay || '—';
    const mapEl = document.getElementById('live-map-name');
    if (mapEl && mapEl.textContent !== mapName) {
      mapEl.textContent = mapName;
      loadMapImg(mapName);
    }
    renderLiveScore(data);
    const serverEl = document.getElementById('live-server');
    if (serverEl) {
      const serverName = stableServerForSession(
        data,
        selectedSession,
        stableServerCache,
        selectedClient.server,
      );
      serverEl.style.display = serverName ? '' : 'none';
      const visual = serverVisual(serverName);
      const serverKey = `${serverName}|${visual?.image || ''}`;
      const imageMissing = !!visual && !serverEl.querySelector('.live-server-image');
      const imageFailed = serverEl.dataset.key === `${serverKey}|failed`;
      if (serverName && (serverEl.dataset.key !== serverKey || (imageMissing && !imageFailed))) {
        serverEl.dataset.key = serverKey;
        serverEl.classList.toggle('has-visual', !!visual);
        serverEl.innerHTML = `
          ${visual ? `<img class="live-server-image" src="${visual.image}" alt="" loading="eager" decoding="async">` : ''}
          <span class="live-server-copy">
            <small>Serveur Riot</small>
            <strong>${escapeDiagnosticText(serverName)}</strong>
          </span>
          ${visual ? `<a class="live-server-credit" href="${visual.source}" target="_blank" rel="noopener" title="Photo : ${escapeDiagnosticText(visual.credit)}">PHOTO ↗</a>` : ''}
        `;
        const image = serverEl.querySelector('.live-server-image');
        if (image) {
          image.addEventListener('load', () => {
            serverImageFailures.delete(visual.image);
            serverEl.classList.add('has-visual');
          }, { once: true });
          image.addEventListener('error', () => {
            const failures = (serverImageFailures.get(visual.image) || 0) + 1;
            serverImageFailures.set(visual.image, failures);
            image.remove();
            serverEl.classList.remove('has-visual');
            serverEl.dataset.key = `${serverKey}|failed`;
            // Un seul nouvel essai automatique : assez pour une coupure réseau
            // passagère, sans créer une boucle sur une source vraiment absente.
            if (failures === 1) {
              setTimeout(() => {
                if (!currentLiveData || !document.contains(serverEl)) return;
                serverEl.dataset.key = '';
                updateUI(currentLiveData);
              }, 8000);
            }
          }, { once: true });
        }
      } else if (!serverName) {
        serverEl.dataset.key = '';
        serverEl.replaceChildren();
      }
    }

    // Average rank display under map image
    const players = stablePlayersForSession(data, stableRosterCache);
    const rankedPlayers = players.filter(p => p.rank?.tier > 2);
    const historicalPeaks = rankedPlayers.filter(p => p.rank?.peakHistorical === true);
    const missingHistoricalPeaks = rankedPlayers.length - historicalPeaks.length;
    const notice = document.getElementById('live-data-notice');
    if (notice) {
      const scriptVersion = data.scriptVersion || selectedClient.version || '';
      if (missingHistoricalPeaks > 0 && !isVersionAtLeast(scriptVersion, '4.12.0')) {
        const observer = escapeDiagnosticText(
          profileForEntry(data)?.member
            || data.playerName?.split('#')[0]
            || 'Le joueur',
        );
        notice.innerHTML = `<strong>Peaks historiques en attente.</strong> ${observer} utilise ${scriptVersion ? `la v${escapeDiagnosticText(scriptVersion)}` : 'une ancienne version'} : il faut redémarrer son script pour charger le vrai peak des ${missingHistoricalPeaks} joueur${missingHistoricalPeaks > 1 ? 's' : ''}.`;
        notice.style.display = '';
      } else {
        notice.style.display = 'none';
        notice.textContent = '';
      }
    }
    const avgEl = document.getElementById('live-avg-rank');
    if (rankedPlayers.length > 0 && avgEl) {
      const avgTier = Math.round(rankedPlayers.reduce((s,p) => s + (p.rank?.tier||0), 0) / rankedPlayers.length);
      const avgName = RANK_NAMES[avgTier] || '';
      avgEl.hidden = false;
      if (avgEl.dataset.tier !== String(avgTier)) {
        avgEl.dataset.tier = avgTier;
        avgEl.innerHTML = `
          <img class="live-rank-icon" src="" alt="">
          <span class="live-avg-rank-copy"><small>Rang moyen</small><strong>${avgName}</strong></span>`;
        // Load rank icon from valorant-api
        if (!window._rankIconsCache) window._rankIconsCache = {};
        if (window._rankIconsCache[avgTier]) {
          avgEl.querySelector('.live-rank-icon').src = window._rankIconsCache[avgTier];
        } else {
          fetch('https://valorant-api.com/v1/competitivetiers').then(r=>r.json()).then(d => {
            const latest = d.data?.[d.data.length-1];
            const tier = latest?.tiers?.find(t => t.tier === avgTier);
            if (tier?.largeIcon) {
              window._rankIconsCache[avgTier] = tier.largeIcon;
              const img = avgEl.querySelector('.live-rank-icon');
              if (img) img.src = tier.largeIcon;
            }
          }).catch(()=>{});
        }
      }
    } else if (avgEl) {
      avgEl.hidden = true;
      avgEl.dataset.tier = '';
    }

    // L'identité de l'observateur est déjà visible dans le sélecteur de
    // sessions : ne pas la répéter dans l'en-tête du match.
    document.getElementById('live-player-tag')?.remove();

    // Pregame — show map comps during agent select
    let compsEl = document.getElementById('live-comps-panel');
    if (isPregame && (data?.mapClean || data?.map)) {
      const pgMapName = data.mapClean || data.map;
      const pregameRenderKey = `${pgMapName}|${data.side || ''}|${liveMode}|${data.supportsComps !== false}`;
      const sideClass = data.side === 'ATTAQUE' ? 'attack' : data.side === 'DEFENSE' ? 'defense' : 'pending';
      const sideLabel = data.side === 'ATTAQUE' ? 'Départ en attaque' : data.side === 'DEFENSE' ? 'Départ en défense' : 'Côté en attente';
      const sideHint = data.side ? 'Côté de départ' : 'Synchronisation avec Riot';
      if (!compsEl) {
        compsEl = document.createElement('div');
        compsEl.id = 'live-comps-panel';
        compsEl.className = 'live-pregame-panel';
        const content = document.getElementById('live-content');
        const body = content?.querySelector('.live-body');
        if (body) content.insertBefore(compsEl, body);
        else if (content) content.prepend(compsEl);
      }
      if (compsEl.dataset.key !== pregameRenderKey) {
        compsEl.dataset.map = pgMapName;
        compsEl.dataset.key = pregameRenderKey;
        Promise.resolve(state.COMPS_DATA).then(comps => {
          if (data.supportsComps === false) {
            const optionalSide = data.side ? `
              <div class="live-side-card ${sideClass}" aria-label="${sideLabel}">
                <span class="live-side-icon" aria-hidden="true"></span>
                <span class="live-side-copy"><small>${sideHint}</small><strong>${sideLabel}</strong></span>
              </div>` : '';
            compsEl.innerHTML = `
              <div class="live-pregame-header ${sideClass}">
                <div class="live-pregame-heading">
                  <span class="live-pregame-kicker">${pgMapName} <i aria-hidden="true">·</i> Agent Select</span>
                  <strong>${escapeDiagnosticText(liveModeLabel)}</strong>
                  <span>Mode détecté par le script OLYCITY</span>
                </div>
                ${optionalSide}
              </div>`;
            return;
          }
          const mapData = comps.find(m => m.map === pgMapName);
          if (!mapData) { compsEl.innerHTML = ''; return; }
          const pick = (...tiers) => mapData.comps.find(c => tiers.includes(c.tier));
          const show = [pick('S'), pick('PRO'), pick('FUN', 'F')].filter(Boolean);
          const agentIcons = agents => agents.map(a => {
            const uuid = agentUuidMap[a]
              || Object.entries(agentUuidMap).find(([name]) => name.toLowerCase() === a.toLowerCase())?.[1];
            const cachedVisual = valorantApi.agentData(a)?.icon || valorantApi.agentImg(a);
            const src = uuid ? `https://media.valorant-api.com/agents/${uuid}/displayicon.png` : cachedVisual;
            return src
              ? `<img src="${src}" title="${escapeDiagnosticText(a)}" alt="${escapeDiagnosticText(a)}" width="30" height="30" onerror="this.hidden=true">`
              : `<span>${escapeDiagnosticText(a)}</span>`;
          }).join('');
          const liveCompCard = comp => {
            const presets = Array.isArray(comp.teamPresets) ? comp.teamPresets : [];
            const presetIndex = Math.min(comp.selectedPreset || 0, Math.max(0, presets.length - 1));
            const preset = presets[presetIndex];
            const agents = preset?.agents || comp.agents;
            const teamPicker = presets.length ? `
              <div class="live-pro-team-picker" role="tablist" aria-label="Équipe professionnelle">
                ${presets.map((team, index) => `
                  <button type="button" class="live-pro-preset-btn ${index === presetIndex ? 'active' : ''}"
                    data-live-pro-preset="${index}" aria-selected="${index === presetIndex}" title="${team.team}">
                    <img src="${team.logo}" alt=""><span>${team.tag}</span>
                  </button>`).join('')}
              </div>
              <div class="live-comp-team-meta">
                <img src="${preset.logo}" alt=""><span><strong>${preset.team}</strong><small>vs ${preset.opponent} · ${preset.score}</small></span>
              </div>` : '';
            return `
              <div class="live-pregame-comp" data-live-comp-tier="${comp.tier}">
                <div class="live-pregame-comp-label">${comp.label || comp.tier}</div>
                ${teamPicker}
                <div class="live-comp-agents">${agentIcons(agents)}</div>
                <div class="live-comp-agent-names">${agents.join(' · ')}</div>
              </div>`;
          };
          compsEl.innerHTML = `
            <div class="live-pregame-header ${sideClass}">
              <div class="live-pregame-heading">
                <span class="live-pregame-kicker">${pgMapName} <i aria-hidden="true">·</i> Agent Select</span>
                <strong>Compositions recommandées</strong>
                <span>Choisissez une stratégie adaptée au côté de départ</span>
              </div>
              <div class="live-side-card ${sideClass}" aria-label="${sideLabel}">
                <span class="live-side-icon" aria-hidden="true"></span>
                <span class="live-side-copy">
                  <small>${sideHint}</small>
                  <strong>${sideLabel}</strong>
                </span>
              </div>
            </div>
            <div class="live-pregame-comps">
              ${show.map(liveCompCard).join('')}
            </div>`;
          compsEl.querySelectorAll('[data-live-pro-preset]').forEach(button => {
            button.addEventListener('click', () => {
              const proComp = pick('PRO');
              const index = Number(button.dataset.liveProPreset);
              const selected = proComp?.teamPresets?.[index];
              const card = button.closest('.live-pregame-comp');
              if (!selected || !card) return;
              proComp.selectedPreset = index;
              card.querySelectorAll('.live-pro-preset-btn').forEach((item, itemIndex) => {
                const active = itemIndex === index;
                item.classList.toggle('active', active);
                item.setAttribute('aria-selected', String(active));
              });
              const agentRow = card.querySelector('.live-comp-agents');
              const names = card.querySelector('.live-comp-agent-names');
              const meta = card.querySelector('.live-comp-team-meta');
              if (agentRow) agentRow.innerHTML = agentIcons(selected.agents);
              if (names) names.textContent = selected.agents.join(' · ');
              if (meta) meta.innerHTML = `<img src="${selected.logo}" alt=""><span><strong>${selected.team}</strong><small>vs ${selected.opponent} · ${selected.score}</small></span>`;
            });
          });
        }).catch(()=>{});
      }
    } else if (!isPregame && compsEl) {
      compsEl.remove();
    }

    // L'ancienne barre « Compo » transformait des notes d'agents arbitraires
    // en faux pourcentage de victoire. Aucun chiffre n'est préférable à une
    // estimation trompeuse tant que l'historique commun n'est pas suffisant.
    document.getElementById('live-winpct')?.remove();

    // Kill feed
    const lastKill = data.lastKill;
    if (lastKill && lastKill.ts !== window._lastKillTs) {
      window._lastKillTs = lastKill.ts;
      let feedEl = document.getElementById('live-kill-feed');
      if (!feedEl) {
        feedEl = document.createElement('div');
        feedEl.id = 'live-kill-feed';
        feedEl.style.cssText = 'position:fixed;top:80px;right:16px;display:flex;flex-direction:column;gap:4px;z-index:100;pointer-events:none';
        document.body.appendChild(feedEl);
      }
      const item = document.createElement('div');
      item.style.cssText = 'font-family:Tomorrow,sans-serif;font-size:10px;letter-spacing:1px;background:rgba(6,8,12,.9);border:1px solid var(--border);padding:5px 10px;color:var(--text);animation:fadeInOut 3s forwards';
      // Ces noms viennent de Firebase, qui accepte les écritures anonymes :
      // les injecter bruts dans innerHTML est une XSS stockée.
      item.innerHTML = `<span style="color:var(--red)">${escapeDiagnosticText(lastKill.killer)}</span> <span style="opacity:.5">→</span> ${escapeDiagnosticText(lastKill.victim)}`;
      feedEl.appendChild(item);
      setTimeout(() => item.remove(), 3000);
    }

    // Phase — guard
    const phaseEl = document.getElementById('live-phase');
    const phase = liveModeLabel || data.roundPhase || '—';
    if (phaseEl) {
      const label = phase.charAt(0).toUpperCase() + phase.slice(1);
      if (phaseEl.textContent !== label) {
        phaseEl.textContent = label;
        phaseEl.className = 'live-phase' + (['combat','bomb'].includes(phase.toLowerCase()) ? ' combat' : '');
      }
    }
    // Timer — guard on roundStartTime
    lastRoundStart = data.roundStartTime || lastRoundStart;

    // Players — rebuild only if player list changed
    const playersEl = document.getElementById('live-players');
    const myName = localStorage.getItem('olycity-profile') || '';
    const all = players;
    // In deathmatch everyone is on same "team" — just show all
    const allies = all.filter(p => p.team === 'ORDER');
    const enemies = all.filter(p => p.team === 'CHAOS');
    const isDM = data.modeFamily === 'free-for-all'
      || (/deathmatch/i.test(liveMode) && !/team/i.test(liveMode))
      || all.some(p => p.team === 'NEUTRAL')
      || allies.length === all.length
      || enemies.length === 0;
    const usesSingleRoster = isDM || isGauntlet;

    curse?.setRoster([...new Set(allies.map(p => olycityMember(p.name)).filter(Boolean))]);
    curse?.setMatch(data.matchId || '');
    curse?.setLive(true);

    // Ranks arrive asynchronously after the roster. Include every displayed rank
    // field so the player rows refresh immediately without requiring an F5.
    const stableKey = all.map(p => {
      const rank = p.rank || {};
      return `${p.name}|${p.agent}|${p.team}|${rank.tier ?? ''}|${rank.rr ?? ''}|${rank.peakTier ?? ''}|${rank.level ?? ''}|${(rank.rrHistory || []).join('.')}|${rank.rrEarned ?? ''}|${rank.season?.games ?? ''}|${rank.season?.winRatePct ?? ''}`;
    }).join(',');
    if (playersEl && playersEl.dataset.key !== stableKey) {
      const openPlayerKeys = [...playersEl.querySelectorAll('.live-player-row[open]')]
        .map(row => row.dataset.playerKey).filter(Boolean);
      const selectedMobileTeam = playersEl.dataset.mobileTeam || 'allies';
      playersEl.dataset.key = stableKey;
      playersEl.classList.toggle('is-syncing', all.length === 0);
      playersEl.classList.toggle('is-deathmatch', usesSingleRoster);
      playersEl.classList.toggle('is-gauntlet', isGauntlet);
      playersEl.innerHTML = all.length === 0
        ? `<div class="live-roster-sync">
             <span class="live-roster-sync-dot" aria-hidden="true"></span>
             <strong>Roster en resynchronisation</strong>
             <small>La partie reste suivie pendant que Riot renvoie les joueurs.</small>
           </div>`
        : usesSingleRoster
        ? `${isGauntlet ? teamTitle('Participants', all, false) : ''}${all.map(p => playerRow(p, myName)).join('')}`
        : `<div class="live-team-tabs" role="tablist" aria-label="Choisir une équipe">
             <button class="live-team-tab" type="button" role="tab" data-live-team="allies" aria-selected="${selectedMobileTeam !== 'enemies'}">Alliés · ${allies.length}</button>
             <button class="live-team-tab" type="button" role="tab" data-live-team="enemies" aria-selected="${selectedMobileTeam === 'enemies'}">Ennemis · ${enemies.length}</button>
           </div>
           <section class="live-team live-team-allies">
             ${teamTitle('Alliés', allies)}
             ${allies.map(p => playerRow(p, myName)).join('')}
           </section>
           <section class="live-team live-team-enemies">
             ${teamTitle('Ennemis', enemies)}
             ${enemies.map(p => playerRow(p, myName)).join('')}
           </section>`;
      playersEl.dataset.mobileTeam = selectedMobileTeam === 'enemies' ? 'enemies' : 'allies';
      playersEl.querySelectorAll('.live-team-tab').forEach(button => {
        button.addEventListener('click', () => {
          const team = button.dataset.liveTeam === 'enemies' ? 'enemies' : 'allies';
          playersEl.dataset.mobileTeam = team;
          playersEl.querySelectorAll('.live-team-tab').forEach(tab => {
            tab.setAttribute('aria-selected', String(tab.dataset.liveTeam === team));
          });
        });
      });
      openPlayerKeys.forEach(key => {
        const row = [...playersEl.querySelectorAll('.live-player-row')].find(item => item.dataset.playerKey === key);
        if (row) row.open = true;
      });
    }


  }

  function rrDisplay(rank) {
    if (!rank) return '';
    if (rank.rrHistory?.length >= 2) {
      const wins   = rank.rrHistory.filter(r => r > 0);
      const losses = rank.rrHistory.filter(r => r < 0);
      const avgW   = wins.length   ? Math.round(wins.reduce((s,r)=>s+r,0)/wins.length)   : null;
      const avgL   = losses.length ? Math.round(losses.reduce((s,r)=>s+r,0)/losses.length) : null;
      const parts  = [];
      if (avgW !== null) parts.push(`<span class="positive">+${avgW}</span>`);
      if (avgL !== null) parts.push(`<span class="negative">${avgL}</span>`);
      if (!parts.length) return '';
      return `<span class="live-player-rr" title="Gains et pertes RR moyens">${parts.join('<span class="separator"> / </span>')}</span>`;
    }
    if (rank.rrEarned !== undefined && rank.rrEarned !== 0) {
      const v = rank.rrEarned;
      return `<span class="live-player-rr ${v > 0 ? 'positive' : 'negative'}">${v>0?'+':''}${v} RR</span>`;
    }
    return '';
  }

  function smurfBadge(rank) {
    if (!rank) return '';
    const tier = rank.tier || 0;
    const peak = rank.peakTier || tier;
    const level = rank.level || 999;
    const gap = peak - tier;

    // Smurf indicators
    // Tier names: 0-2=unranked, 3-5=iron, 6-8=bronze, 9-11=silver, 12-14=gold
    // 15-17=plat, 18-20=diamond, 21-23=ascendant, 24-26=immortal, 27=radiant
    const isLowRank = tier <= 14; // gold or below
    const isHighPeak = peak >= 21; // ascendant or above
    const isNewAccount = level < 60;
    const bigGap = gap >= 9; // 3 full ranks gap

    if (isLowRank && isHighPeak && (isNewAccount || bigGap)) {
      return `<span class="live-player-badge smurf">Smurf possible</span>`;
    }
    if (bigGap && isHighPeak) {
      return `<span class="live-player-badge warning">Écart de rang</span>`;
    }
    return '';
  }

  function teamTitle(label, teamPlayers, showAverage = true) {
    const ranked = teamPlayers.filter(player => player.rank?.tier > 2);
    const averageTier = ranked.length
      ? Math.round(ranked.reduce((sum, player) => sum + player.rank.tier, 0) / ranked.length)
      : 0;
    const average = averageTier ? RANK_NAMES[averageTier] : '';
    return `<div class="live-team-title"><strong>${label}</strong><small>${showAverage && average ? `Rang moyen · ${average}` : `${teamPlayers.length} joueurs`}</small></div>`;
  }
  function rankDisplay(rank) {
    if (!rank) return '';
    const name = RANK_NAMES[rank.tier] || 'Unranked';
    const base = name.split(' ')[0];
    const color = RANK_COLORS[base] || '#888';
    return `<span class="live-rank-current" style="color:${color}">${name}</span>`;
  }

  function peakDisplay(rank) {
    if (!rank?.peakTier) return '';
    const name = RANK_NAMES[rank.peakTier] || 'Unranked';
    const base = name.split(' ')[0];
    const color = RANK_COLORS[base] || '#888';
    const label = rank.peakHistorical ? 'PEAK' : 'MAX RÉCENT';
    const title = rank.peakHistorical
      ? 'Meilleur rang retrouvé dans l’historique des actes'
      : 'Historique Riot indisponible — meilleur rang des parties récentes';
    return `<span class="live-rank-peak" title="${title}" style="color:${color}"><span class="live-rank-prefix">${label}</span> ${name}</span>`;
  }

  function seasonDisplay(rank) {
    if (!rank?.season?.games) return '';
    const { games, winRatePct } = rank.season;
    const wr = winRatePct != null ? `${winRatePct}% WR · ` : '';
    return `<span class="live-player-season" title="Acte compétitif en cours">${wr}${games} game${games > 1 ? 's' : ''}</span>`;
  }

  // Résolution agent — l'UUID (agentId) est la source de vérité, résolu via l'API
  function fixAgentName(p) {
    if (p.agentId) {
      const full = uuidToName[p.agentId.toLowerCase()];
      if (full) return full;
    }
    return (p.agent && p.agent !== '?') ? p.agent : (p.agentId ? '' : p.agent);
  }

  function agentIconUrl(agentName, agentId) {
    // Use UUID directly if available (most reliable)
    if (agentId) return `https://media.valorant-api.com/agents/${agentId}/displayicon.png`;
    if (!agentName || agentName === '?') return '';
    if (agentIconCache[agentName]) return agentIconCache[agentName];
    const uuid = agentUuidMap[agentName] ||
      Object.entries(agentUuidMap).find(([k]) => k.toLowerCase() === agentName.toLowerCase())?.[1];
    if (uuid) {
      const url = `https://media.valorant-api.com/agents/${uuid}/displayicon.png`;
      agentIconCache[agentName] = url;
      return url;
    }
    return '';
  }

  function olycityMember(name) {
    if (!name || !name.includes('#')) return null;
    const hit = rosterProfileForName(name);
    return hit?.member || null;
  }

  function playerRow(p, myName) {
    const isMe = myName && p.name?.includes(myName.split('#')[0]);
    const fixedAgent = fixAgentName(p);
    const imgUrl = agentIconUrl(fixedAgent, p.agentId);
    const profile = resolveLiveIdentity({...p,playerName:p.name || ''}, _rosterIdentityIndex);
    const member = profile?.member || olycityMember(p.name);
    const memberAvatar = profile?.avatar
      ? `<span class="live-player-member-avatar" title="${escapeDiagnosticText(member)}">${avatarLayersHTML(member, profile.avatar)}</span>`
      : '';
    const playerName = p.incognito ? 'Joueur anonyme' : escapeDiagnosticText(p.name || '—');
    const playerKey = escapeDiagnosticText(encodeURIComponent(p.name || `${fixedAgent}-${p.team || ''}`));
    const secondary = [seasonDisplay(p.rank), rrDisplay(p.rank), smurfBadge(p.rank)].filter(Boolean).join('');
    const tracker = !p.incognito && p.name?.includes('#')
      ? `<a class="live-player-tracker" href="https://tracker.gg/valorant/profile/riot/${encodeURIComponent(p.name)}/overview" target="_blank" rel="noopener">Voir sur Tracker ↗</a>`
      : '';

    return `<details class="live-player-row ${p.alive===false ? 'dead' : ''} ${isMe ? 'me' : ''}" data-player-key="${playerKey}">
      <summary class="live-player-summary">
        <span class="live-player-portrait">
          ${imgUrl ? `<img class="live-player-agent" src="${imgUrl}" alt="${escapeDiagnosticText(fixedAgent || 'Agent')}" onerror="this.style.visibility='hidden'">` : '<span class="live-player-agent"></span>'}
          ${memberAvatar}
        </span>
        <span class="live-player-main">
          <span class="live-player-identity">
            <span class="live-player-name">${playerName}</span>
            <span class="live-player-agent-name">${escapeDiagnosticText(fixedAgent || '')}</span>
            ${p.incognito ? '<span class="live-player-badge">Anonyme</span>' : ''}
            ${member ? `<span class="live-player-badge oly">OLY · ${escapeDiagnosticText(member)}</span>` : ''}
          </span>
          <span class="live-player-primary-stats">${rankDisplay(p.rank) || '<span class="live-rank-current">Rang indisponible</span>'}${peakDisplay(p.rank)}</span>
        </span>
        <span class="live-player-chevron" aria-hidden="true">⌄</span>
      </summary>
      <div class="live-player-details">
        ${secondary || '<span class="live-player-season">Aucune statistique supplémentaire</span>'}
        ${tracker}
      </div>
    </details>`;
  }

  const handleGameChange = event => {
    if (event.detail?.mode !== 'valorant') return;
    const dot = document.getElementById('live-dot');
    if (dot) dot.style.display = currentLiveData?.active ? 'block' : 'none';
  };
  document.addEventListener('olycity:gamechange', handleGameChange);

  return () => {
    unsubscribeLiveData();
    clearInterval(staleChecker);
    clearInterval(diagnosticTicker);
    if (timerInterval) clearInterval(timerInterval);
    document.removeEventListener('olycity:gamechange', handleGameChange);
  };
}

/**
 * Membre et compte derrière un rapport de partie, par PUUID d'abord (il
 * survit aux renommages), par Riot ID seulement quand l'un des deux PUUID
 * manque. Mêmes comptes que les cartes du roster (rosterAccounts) : ceux de
 * roster.json, ceux ajoutés depuis l'admin, et le principal choisi dans
 * l'admin s'il y en a un — sinon le `riot` de roster.json.
 */
function historyAccountOwner(report) {
  const lower = value => String(value || '').trim().toLowerCase();
  const puuid = lower(report?.playerPuuid);
  const riotId = lower(report?.player);
  const roster = state.ROSTER || [];
  let byName = null;
  for (const member of roster) {
    const accounts = rosterAccounts(member, state.ROSTER_OVERLAY, roster);
    for (const account of accounts) {
      const accountPuuid = lower(account.puuid);
      if (puuid && accountPuuid) {
        if (puuid === accountPuuid) return { member, account };
        continue;
      }
      if (!byName && riotId && (lower(account.riotId) === riotId || lower(account.riotId).split('#')[0] === riotId.split('#')[0])) {
        byName = { member, account };
      }
    }
  }
  if (byName) return byName;
  const member = historyRosterMember(report, roster);
  return { member, account:null };
}

export async function initHistoryPage() {
  const el = document.getElementById('history-content');
  if (!el) return;
  const loadSequence = ++historyLoadSequence;
  const cached = lastValorantHistoryState && Object.keys(lastValorantHistoryState.data || {}).length
    ? { savedAt:lastValorantHistorySavedAt, state:lastValorantHistoryState }
    : readValorantHistoryCache();
  let syncState = cached ? { state:'syncing', savedAt:cached.savedAt } : null;
  let backgroundRefresh = null;
  const agentMapPromise = ensureAgentMap();
  if (!cached) el.innerHTML = '<div class="data-state-card is-loading"><span class="data-state-pulse" aria-hidden="true"></span><div><strong>Chargement de l’historique</strong><small>Récupération des dernières parties Valorant</small></div><span class="data-state-lines" aria-hidden="true"><i></i><i></i></span></div>';

  let games = [];
  let pagerState = valorantHistoryPager.snapshot();
  if (cached?.state) {
    lastValorantHistoryState = cached.state;
    lastValorantHistorySavedAt = cached.savedAt;
    pagerState = cached.state;
    games = normalizeHistoryEntries(pagerState.data);
    backgroundRefresh = valorantHistoryReady ? valorantHistoryPager.refresh() : valorantHistoryPager.loadNext();
  } else {
    try {
      pagerState = await valorantHistoryPager.loadNext();
      if (loadSequence !== historyLoadSequence) return;
      valorantHistoryReady = true;
      valorantHistoryRecoveryAttempts = 0;
      clearTimeout(valorantHistoryRecoveryTimer);
      rememberValorantHistory(pagerState);
      games = normalizeHistoryEntries(pagerState.data);
    } catch {
      if (loadSequence !== historyLoadSequence) return;
      if (valorantHistoryRecoveryAttempts < 2 && document.getElementById('page-history')?.classList.contains('active') && document.documentElement.dataset.game !== 'lol') {
        valorantHistoryRecoveryAttempts += 1;
        el.innerHTML = `<div class="data-state-card is-loading"><span class="data-state-pulse" aria-hidden="true"></span><div><strong>Reconnexion à l’historique</strong><small>Nouvelle tentative automatique ${valorantHistoryRecoveryAttempts}/2…</small></div><span class="data-state-lines" aria-hidden="true"><i></i><i></i></span></div>`;
        clearTimeout(valorantHistoryRecoveryTimer);
        valorantHistoryRecoveryTimer = setTimeout(initHistoryPage, 700 * valorantHistoryRecoveryAttempts);
        return;
      }
      el.innerHTML = `<div class="data-state-card is-error">
        <span class="data-state-pulse" aria-hidden="true"></span><div><strong>Historique indisponible</strong>
        <small>Le chargement a pris trop de temps ou la connexion a été interrompue.</small></div>
        <button type="button" data-history-retry class="btn btn-primary">Réessayer</button>
      </div>`;
      el.querySelector('[data-history-retry]')?.addEventListener('click', initHistoryPage);
      return;
    }
  }

  if (!games.length) {
    el.innerHTML = `<div class="data-state-card is-empty">
      <span class="data-state-pulse" aria-hidden="true"></span><div><strong>Aucune partie enregistrée</strong>
      <small>Les parties se sauvegardent automatiquement à la fin de chaque game. Script v4.3 minimum requis.</small></div>
    </div>`;
    return;
  }

  games.sort((a,b) => (b.ts||0) - (a.ts||0));

  let allGames = games;
  let ownerOptions = [];
  let currentActInfo = null;
  // Toutes les parties connues (l'index entier, pas seulement les pages
  // affichées) : c'est l'échantillon des statistiques de la saison.
  const knownGames = () => {
    const summaries = valorantHistoryPager.allSummaries();
    return Object.keys(summaries).length ? normalizeHistoryEntries(summaries) : allGames;
  };
  const updateOwnerOptions = () => {
    ownerOptions = [...new Map(knownGames().flatMap(game => historyReports(game).map(report => {
      const key = historyOwnerKey(report);
      const { member, account } = historyAccountOwner(report);
      const riotId = String(report?.player || '').trim();
      const name = member?.name || riotId.split('#')[0] || 'Inconnu';
      // Smurf seulement si le compte est connu et n'est pas le principal.
      const smurf = Boolean(account && !account.isMain);
      return [key, {
        key, name, riotId, smurf,
        label: `${name}${riotId ? ` · ${riotId}` : ''}${smurf ? ' · Smurf' : ''}`,
        avatar: member?.avatar || '',
      }];
    }))).values()].sort((a,b) => a.name.localeCompare(b.name, 'fr') || a.smurf - b.smurf || a.label.localeCompare(b.label, 'fr'));
  };
  updateOwnerOptions();
  // Compétitif par défaut : les autres modes se choisissent dans « Mode ».
  const historyUI = { view:'matches', owner:'all', period:'all', mode:'competitive', limit:20 };
  // Statistiques : le compétitif de l'acte en cours (ou tout le compétitif
  // enregistré si l'acte est inconnu), pour le joueur choisi.
  const seasonGames = () => filterHistoryGames(knownGames(), { owner:historyUI.owner, period:'all', view:'matches', mode:'competitive' })
    .filter(game => !currentActInfo || inAct(game, currentActInfo))
    .map(game => historyUI.owner === 'all' ? game : historyGameForOwner(game, historyUI.owner))
    .sort((a,b) => (b.ts||0) - (a.ts||0));
  const visibleGames = () => filterHistoryGames(allGames, historyUI)
    .map(game => historyUI.owner === 'all' ? game : historyGameForOwner(game, historyUI.owner));
  const refreshHistory = () => renderHistory(visibleGames());
  const renderHistory = games => {
  const roster = state.ROSTER;
  const statsGames = seasonGames();
  const overview = historyOverview(statsGames);
  const agentStats = historyAgentStats(statsGames).slice(0, 6);
  const mapStats = historyMapStats(statsGames);
  const memberStats = historyMemberStats(statsGames, roster);
  const seasonLabel = currentActInfo ? currentActInfo.label : 'toutes les compétitives enregistrées';
  const displayedGames = games.slice(0, historyUI.limit);
  const days = historyDayGroups(displayedGames);

  // ─── Petits formats ────────────────────────────────────────────────────
  const fixed = (value, digits = 2) => Number.isFinite(value) ? value.toFixed(digits) : '—';
  const percent = value => Number.isFinite(value) ? `${value}%` : '—';
  const signed = value => Number.isFinite(value) ? `${value > 0 ? '+' : ''}${value}` : '—';
  const kdTone = value => !Number.isFinite(value) ? '' : value >= 1.15 ? 'is-good' : value < 0.9 ? 'is-bad' : '';
  const wrTone = value => !Number.isFinite(value) ? '' : value >= 55 ? 'is-good' : value <= 45 ? 'is-bad' : 'is-even';
  const signTone = value => !Number.isFinite(value) || value === 0 ? '' : value > 0 ? 'is-good' : 'is-bad';
  const durationLabel = ms => {
    if (!ms || ms < 0) return '—';
    const totalMinutes = Math.round(ms / 60000);
    return totalMinutes >= 60 ? `${Math.floor(totalMinutes / 60)} h ${String(totalMinutes % 60).padStart(2, '0')}` : `${totalMinutes} min`;
  };
  const timeLabel = ts => ts ? new Date(ts).toLocaleTimeString('fr-FR', { hour:'2-digit', minute:'2-digit' }) : '';
  const dateLabel = ts => ts ? new Date(ts).toLocaleString('fr-FR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }) : '—';
  const mapLabel = map => historyEscape(valorantLiveMapLabel(map || '?'));
  const modeLabel = game => historyMode(game) === 'deathmatch' ? 'Deathmatch'
    : historyMode(game) === 'competitive' ? 'Compétitif'
    : valorantLiveModeLabel(game);
  const agentImg = (agent, className = '') => {
    // Deux sources : la liste d'agents de valorant-api.com, ou les visuels du
    // site déjà en cache (valorantApi), si la première ne répond pas.
    const src = agentIconFromName(agent) || (agent ? valorantApi.agentData(agent)?.icon || '' : '');
    return src ? `<img class="${className}" src="${src}" alt="${historyEscape(agent || '')}" loading="lazy" onerror="this.style.visibility='hidden'">`
      : `<span class="${className} hx-agent-fallback" aria-hidden="true">${historyEscape(String(agent || '?').slice(0, 2))}</span>`;
  };
  const avatar = (name, src, className = 'hx-avatar') => src
    ? `<img class="${className}" src="${historyEscape(src)}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'${className} is-initial',textContent:${historyEscape(JSON.stringify(String(name || '?').slice(0, 1).toUpperCase()))}}))">`
    : `<span class="${className} is-initial" aria-hidden="true">${historyEscape(String(name || '?').slice(0, 1).toUpperCase())}</span>`;
  const tierImg = (tier, className = 'hx-tier') => {
    const src = valorantTierIcon(tier);
    return src ? `<img class="${className}" src="${src}" alt="${historyEscape(valorantTierLabel(tier))}" title="${historyEscape(valorantTierLabel(tier))}" loading="lazy" onerror="this.remove()">` : '';
  };
  const ownerOf = report => historyAccountOwner(report).member;
  const ownerName = report => ownerOf(report)?.name || String(report?.player || 'Inconnu').split('#')[0];
  const sectionHead = (title, extra = '') => `<header class="hx-card-head"><h3>${title}</h3>${extra}</header>`;

  // ─── Profil : un joueur, ou tout le groupe ─────────────────────────────
  const selectedOwner = historyUI.owner !== 'all' ? ownerOptions.find(option => option.key === historyUI.owner) : null;
  const selectedStats = selectedOwner ? memberStats.find(entry => entry.key === selectedOwner.key) : null;
  const modeLabels = { competitive:'Compétitif', deathmatch:'Deathmatch', other:'Autres modes', all:'Tous les modes' };
  const form = overview.recent.length ? `<div class="hx-form" aria-label="Derniers résultats en compétitif">
      <small>Forme</small>
      <div>${overview.recent.map(result => `<i class="${result === 'win' ? 'is-win' : result === 'loss' ? 'is-loss' : 'is-draw'}" title="${result === 'win' ? 'Victoire' : result === 'loss' ? 'Défaite' : 'Égalité'}">${result === 'win' ? 'V' : result === 'loss' ? 'D' : 'É'}</i>`).join('')}</div>
    </div>` : '';
  const profile = selectedOwner ? `<section class="hx-profile">
      ${avatar(selectedOwner.name, selectedOwner.avatar, 'hx-profile-avatar')}
      <div class="hx-profile-id">
        <small>Historique</small>
        <h3>${historyEscape(selectedOwner.name)}</h3>
        <span>${historyEscape(selectedOwner.riotId || '')}${selectedOwner.smurf ? ' · Smurf' : ''}</span>
      </div>
      ${selectedStats?.tier ? `<div class="hx-profile-rank">${tierImg(selectedStats.tier, 'hx-profile-tier')}<span><small>Rang actuel</small><strong>${historyEscape(valorantTierLabel(selectedStats.tier, selectedStats.rr))}</strong></span></div>` : ''}
      ${form}
    </section>` : `<section class="hx-profile is-group">
      <div class="hx-profile-stack">${memberStats.slice(0, 5).map(entry => avatar(entry.label, entry.avatar, 'hx-profile-avatar')).join('')}</div>
      <div class="hx-profile-id">
        <small>Historique du groupe</small>
        <h3>Five stack OLYCITY</h3>
        <span>${memberStats.length} compte${memberStats.length > 1 ? 's' : ''} suivi${memberStats.length > 1 ? 's' : ''} en compétitif · ${historyEscape(seasonLabel)}</span>
      </div>
      ${form}
    </section>`;

  // ─── Vue d'ensemble ────────────────────────────────────────────────────
  const bigStat = (label, value, sub, tone = '', bar = null) => `<div class="hx-stat-big ${tone}">
      <small>${label}</small><strong>${value}</strong><span>${sub}</span>
      ${bar === null ? '' : `<i class="hx-meter" aria-hidden="true"><b style="width:${Math.max(0, Math.min(100, bar))}%"></b></i>`}
    </div>`;
  const smallStat = (label, value, tone = '') => `<div class="hx-stat-small ${tone}"><small>${label}</small><strong>${value}</strong></div>`;
  const overviewCard = `<section class="hx-card hx-overview" aria-label="Vue d'ensemble">
      ${sectionHead("Vue d'ensemble", `<span>Compétitif · ${historyEscape(seasonLabel)} · ${overview.games} partie${overview.games > 1 ? 's' : ''}</span>`)}
      <div class="hx-overview-big">
        ${bigStat('Victoires', percent(overview.winrate), overview.wins + overview.losses ? `${overview.wins}V · ${overview.losses}D${overview.draws ? ` · ${overview.draws}É` : ''}` : 'aucune compétitive', wrTone(overview.winrate), overview.winrate)}
        ${bigStat('Ratio K/D', fixed(overview.kd), `${overview.kills} / ${overview.deaths} / ${overview.assists}`, kdTone(overview.kd), Number.isFinite(overview.kd) ? overview.kd / 2 * 100 : null)}
        ${bigStat('ACS moyen', overview.acs ?? '—', 'score de combat par manche', '', Number.isFinite(overview.acs) ? overview.acs / 3.5 : null)}
        ${bigStat('Headshots', percent(overview.hs), 'des balles qui touchent', '', overview.hs)}
      </div>
      <div class="hx-overview-small">
        ${smallStat('Parties', overview.games)}
        ${smallStat('Temps de jeu', durationLabel(overview.durationMs))}
        ${smallStat('RR net', signed(overview.rrNet), signTone(overview.rrNet))}
        ${smallStat('Record de kills', overview.performances ? overview.maxKills : '—')}
        ${smallStat('Kills / partie', fixed(overview.killsPerGame, 1))}
        ${smallStat('KDA', fixed(overview.kda))}
      </div>
    </section>`;

  // ─── Colonne : agents, maps, joueurs ───────────────────────────────────
  const agentsCard = agentStats.length ? `<section class="hx-card hx-agents">
      ${sectionHead('Agents', '<span>parties · victoires · K/D · ACS</span>')}
      <div class="hx-list">
        ${agentStats.map(agent => `<div class="hx-list-row">
          ${agentImg(agent.label, 'hx-list-icon')}
          <span class="hx-list-name"><strong>${historyEscape(agent.label)}</strong><small>${agent.games} partie${agent.games > 1 ? 's' : ''}</small></span>
          <b class="${wrTone(agent.winrate)}">${percent(agent.winrate)}</b>
          <b class="${kdTone(agent.kd)}">${fixed(agent.kd)}</b>
          <b>${agent.acs ?? '—'}</b>
        </div>`).join('')}
      </div>
    </section>` : '';
  const mapsCard = mapStats.length ? `<section class="hx-card hx-maps">
      ${sectionHead('Maps', '<span>compétitif</span>')}
      <div class="hx-map-list">
        ${mapStats.map(entry => {
          const splash = valorantApi.mapSplash(entry.map);
          return `<div class="hx-map-row"${splash ? ` style="--hx-map:url('${splash}')"` : ''}>
            <span class="hx-map-name"><strong>${mapLabel(entry.map)}</strong><small>${entry.games} partie${entry.games > 1 ? 's' : ''} · ${entry.wins}V ${entry.losses}D</small></span>
            <span class="hx-map-wr ${wrTone(entry.winrate)}"><strong>${percent(entry.winrate)}</strong><i class="hx-meter" aria-hidden="true"><b style="width:${entry.winrate ?? 0}%"></b></i></span>
          </div>`;
        }).join('')}
      </div>
    </section>` : '';
  const membersCard = !selectedOwner && memberStats.length > 1 ? `<section class="hx-card hx-members">
      ${sectionHead('Joueurs', '<span>cliquer pour filtrer</span>')}
      <div class="hx-list">
        ${memberStats.map(entry => `<button type="button" class="hx-list-row hx-member-row" data-history-owner="${historyEscape(entry.key)}" title="${historyEscape(entry.riotId)}">
          ${avatar(entry.label, entry.avatar, 'hx-list-icon is-round')}
          <span class="hx-list-name"><strong>${historyEscape(entry.label)}</strong><small>${entry.games} partie${entry.games > 1 ? 's' : ''}${entry.tier ? ` · ${historyEscape(valorantTierLabel(entry.tier))}` : ''}</small></span>
          ${entry.tier ? tierImg(entry.tier, 'hx-list-tier') : '<span></span>'}
          <b class="${wrTone(entry.winrate)}">${percent(entry.winrate)}</b>
          <b class="${kdTone(entry.kd)}">${fixed(entry.kd)}</b>
        </button>`).join('')}
      </div>
    </section>` : '';

  // ─── Détail d'une partie : tableau des joueurs ─────────────────────────
  const boardRow = (game, player, rankedPlayers) => {
    const stats = player.stats || {};
    const rank = rankedPlayers.indexOf(player) + 1;
    const diff = (stats.kills || 0) - (stats.deaths || 0);
    const kd = (stats.kills || 0) / Math.max(1, stats.deaths || 0);
    const deathmatch = historyMode(game) === 'deathmatch';
    return `<div class="hx-board-row ${isHistorySelf(game, player) ? 'self' : ''}">
      <span class="hx-board-player">
        ${agentImg(player.agent, 'hx-board-agent')}
        <span><strong>${historyEscape(historyPlayerName(game, player, Math.max(0, rank - 1)))}</strong><small>${historyEscape(player.agent || '?')}</small></span>
        ${rank === 1 ? '<b class="hx-badge is-mvp">MVP</b>' : deathmatch ? `<b class="hx-badge">#${rank}</b>` : ''}
      </span>
      <span>${deathmatch ? (stats.score ?? '—') : (stats.acs ?? '—')}</span>
      <span>${stats.kills || 0}</span>
      <span>${stats.deaths || 0}</span>
      <span>${stats.assists || 0}</span>
      <span class="${signTone(diff)}">${signed(diff)}</span>
      <span class="${kdTone(kd)}">${kd.toFixed(2)}</span>
      <span>${percent(stats.hsPercent)}</span>
    </div>`;
  };
  const boardHead = (title, extra = '', deathmatch = false) => `<div class="hx-board-head">
      <strong>${title}${extra}</strong><span>${deathmatch ? 'Score' : 'ACS'}</span><span>K</span><span>D</span><span>A</span><span>+/−</span><span>K/D</span><span>HS</span>
    </div>`;
  const gameDetail = game => {
    const kind = historyMode(game);
    const detailedPlayers = (game.players||[]).filter(player => player.stats);
    const rankedPlayers = historyRankedPlayers(game);
    const performances = historyPlayerPerformances(game).filter(entry => entry.self);
    const performance = performances[0] || historyPlayerPerformance(game);
    const mvp = rankedPlayers[0] || performance.mvp;
    const splash = valorantApi.mapSplash(game.map);
    const heroStyle = splash ? ` style="--history-map-image:url('${splash}')"` : '';
    let playersHTML = '<div class="history-legacy-note">Cette ancienne game ne contient pas encore les statistiques détaillées.</div>';

    const scoreText = historyScoreText(game) || '—';
    const resultText = kind === 'deathmatch'
      ? performance.placement ? `${performance.placement}${performance.placement === 1 ? 'er' : 'e'} sur ${performance.playerCount}` : 'Terminée'
      : game.result === 'win' ? 'Victoire' : game.result === 'loss' ? 'Défaite' : game.result === 'draw' ? 'Égalité' : 'Résultat indisponible';
    const resultClass = kind === 'deathmatch' ? 'deathmatch' : game.result === 'win' ? 'win' : game.result === 'loss' ? 'loss' : 'unknown';
    const rrDelta = kind === 'competitive' ? game.rr?.delta : null;
    const selfName = historyOwnerLabel(game, roster);
    const mvpIndex = mvp ? rankedPlayers.indexOf(mvp) : -1;
    const trackerUrl = historyTrackerUrl(game);

    const overviewHTML = performances.length ? `<div class="history-match-overview">
      ${performances.map(entry => {
        const tracked = entry.self;
        const trackedScore = kind === 'deathmatch' ? tracked.stats?.score : tracked.stats?.acs;
        return `<section class="history-performance-card self">
          <div class="history-performance-player">
            ${agentImg(tracked.agent)}
            <span><small>Performance suivie</small><strong>${historyEscape(historyOwnerLabel(entry.report, roster))}</strong><em>${historyEscape(historyPlayerName(entry.report, tracked))} · ${historyEscape(tracked.agent||'Agent inconnu')}</em></span>
          </div>
          <div class="history-performance-metrics">
            <div><strong>${tracked.stats?.kills||0}/${tracked.stats?.deaths||0}/${tracked.stats?.assists||0}</strong><span>K / D / A</span></div>
            <div><strong class="${kdTone(entry.kd)}">${fixed(entry.kd)}</strong><span>Ratio K/D</span></div>
            <div><strong>${entry.placement ? `#${entry.placement}/${entry.playerCount}` : '—'}</strong><span>Classement</span></div>
            <div><strong>${Number.isFinite(trackedScore) ? trackedScore : '—'}</strong><span>${kind === 'deathmatch' ? 'Score' : 'ACS'}</span></div>
          </div>
        </section>`;
      }).join('')}
      ${mvp ? `<section class="history-performance-card mvp ${isHistorySelf(game, mvp) ? 'self-mvp' : ''}">
        <span class="history-mvp-label">MVP de la partie</span>
        <strong>${historyEscape(historyPlayerName(game, mvp, mvpIndex >= 0 ? mvpIndex : 0))}</strong>
        <small>${historyEscape(mvp.agent||'?')} · ${mvp.stats?.kills||0}/${mvp.stats?.deaths||0}/${mvp.stats?.assists||0}</small>
      </section>` : ''}
    </div>` : '';

    if (detailedPlayers.length && kind === 'deathmatch') {
      playersHTML = `<div class="hx-board is-deathmatch">
        ${boardHead('Classement individuel', '', true)}
        ${rankedPlayers.map(player => boardRow(game, player, rankedPlayers)).join('')}
      </div>`;
    } else if (detailedPlayers.length) {
      const self = detailedPlayers.find(player => isHistorySelf(game, player));
      const selfTeam = String(game.selfTeam || self?.team || 'ORDER').toUpperCase();
      const { blue, red } = game.score || {};
      const teamScore = team => (team === 'ORDER' ? blue : red);
      playersHTML = `<div class="hx-board">
        ${[selfTeam, selfTeam === 'ORDER' ? 'CHAOS' : 'ORDER'].map(team => `
          <div class="hx-board-team ${team === selfTeam ? 'is-ally' : 'is-enemy'}">
            ${boardHead(team === selfTeam ? 'Votre équipe' : 'Adversaires', Number.isInteger(teamScore(team)) ? ` <em>${teamScore(team)}</em>` : '')}
            ${detailedPlayers.filter(player => player.team === team)
              .sort((a,b)=>(b.stats?.score||0)-(a.stats?.score||0))
              .map(player => boardRow(game, player, rankedPlayers)).join('')}
          </div>`).join('')}
      </div>`;
    }

    const compactHistory = window.matchMedia?.('(max-width: 768px)').matches ?? false;
    const rosterLabel = kind === 'deathmatch' ? 'Classement complet' : 'Tableau des scores';
    const rosterContent = detailedPlayers.length ? `<details class="history-roster-disclosure"${compactHistory ? '' : ' open'}>
      <summary>
        <span>${rosterLabel}</span>
        <strong>${detailedPlayers.length} joueur${detailedPlayers.length > 1 ? 's' : ''}</strong>
        <i aria-hidden="true">⌄</i>
      </summary>
      <div class="history-roster-content">${playersHTML}</div>
    </details>` : playersHTML;

    return `<div class="history-detail-layout">
      <aside class="history-map-visual"${heroStyle}>
        <div class="history-match-result ${resultClass}"><span>${resultText}</span><strong>${kind === 'competitive' ? scoreText : performance.placement ? `#${performance.placement}` : 'DM'}</strong></div>
        <span>${modeLabel(game)}</span>
        <strong>${mapLabel(game.map).toUpperCase()}</strong>
        <small>${dateLabel(game.ts)} · ${durationLabel(gameDurationMs(game))}</small>
        <div class="history-match-facts">
          <span>Joueur${historyReports(game).length > 1 ? 's' : ''} <strong>${historyEscape(selfName)}</strong></span>
          ${Number.isFinite(game.rounds) && game.rounds && kind === 'competitive' ? `<span>Manches <strong>${game.rounds}</strong></span>` : ''}
          ${Number.isFinite(rrDelta) ? `<span>RR <strong class="${rrDelta >= 0 ? 'positive' : 'negative'}">${signed(rrDelta)}</strong></span>` : ''}
        </div>
        ${trackerUrl ? `<a class="history-tracker-link" href="${trackerUrl}" target="_blank" rel="noopener noreferrer">Voir sur Tracker.gg <span aria-hidden="true">↗</span></a>` : ''}
      </aside>
      <div class="history-detail-content">${overviewHTML}<div class="history-detail-players">${rosterContent}</div></div>
    </div>`;
  };

  // ─── Ligne d'une partie ────────────────────────────────────────────────
  const gameCard = game => {
    const kind = historyMode(game);
    const featured = featuredPerformance(game);
    const stats = featured?.self?.stats || null;
    const result = kind === 'deathmatch' ? 'is-dm' : game.result === 'win' ? 'is-win' : game.result === 'loss' ? 'is-loss' : 'is-draw';
    const resultLabel = kind === 'deathmatch' ? 'Deathmatch' : game.result === 'win' ? 'Victoire' : game.result === 'loss' ? 'Défaite' : game.result === 'draw' ? 'Égalité' : '—';
    const score = kind === 'deathmatch'
      ? featured?.placement && featured.playerCount > 1 ? `#${featured.placement}<em>/${featured.playerCount}</em>` : stats ? `${stats.kills || 0}` : '—'
      : (historyScoreText(game) || '—').replace('–', '<em>:</em>');
    const reports = historyReports(game);
    const owners = reports.map(report => ({ name:ownerName(report), avatar:ownerOf(report)?.avatar || '' }))
      .filter((owner, index, all) => all.findIndex(other => other.name === owner.name) === index);
    // L'agent de chaque membre présent, le mieux classé d'abord.
    const picks = trackedPerformances(game)
      .sort((a, b) => (a === featured ? -1 : b === featured ? 1 : 0))
      .map(entry => ({ agent:entry.self.agent, name:ownerName(entry.report), avatar:ownerOf(entry.report)?.avatar || '' }))
      .filter((pick, index, all) => all.findIndex(other => other.name === pick.name) === index);
    if (!picks.length) picks.push({ agent:featured?.self?.agent, name:owners[0]?.name || '', avatar:owners[0]?.avatar || '' });
    const rrReport = featured?.report || reports[0];
    const rrDelta = kind === 'competitive' ? rrReport?.rr?.delta : null;
    const kd = stats ? (stats.kills || 0) / Math.max(1, stats.deaths || 0) : null;
    const placement = featured?.playerCount > 1 ? featured.placement : null;
    const detail = game.__summary
      ? '<div class="history-detail-loading">Ouvrez la partie pour charger les détails</div>'
      : gameDetail(game);
    return `<details class="history-game hx-match ${result} ${kind}" data-history-id="${historyEscape(game.historyId || '')}">
      <summary class="hx-row">
        <span class="hx-row-agents" aria-label="${historyEscape(picks.map(pick => `${pick.name} : ${pick.agent || 'agent inconnu'}`).join(', '))}">
          ${picks.slice(0, 3).map(pick => `<span class="hx-row-pick" title="${historyEscape(`${pick.name} · ${pick.agent || '?'}`)}">
            ${agentImg(pick.agent, 'hx-row-agent-img')}
            ${pick.name ? avatar(pick.name, pick.avatar, 'hx-row-owner') : ''}
          </span>`).join('')}
          ${picks.length > 3 ? `<span class="hx-row-more">+${picks.length - 3}</span>` : ''}
        </span>
        <span class="hx-row-map">
          <strong>${mapLabel(game.map)}</strong>
          <small>${modeLabel(game)} · ${timeLabel(game.ts)} · ${durationLabel(gameDurationMs(game))}</small>
          ${historyUI.owner === 'all' ? `<small class="hx-row-who">${historyEscape(owners.map(owner => owner.name).join(', '))}</small>` : ''}
        </span>
        <span class="hx-row-score"><strong>${score}</strong><small>${resultLabel}</small></span>
        <span class="hx-row-rank">
          ${kind === 'competitive' && rrReport?.rr?.tier ? tierImg(rrReport.rr.tier, 'hx-row-tier') : ''}
          ${Number.isFinite(rrDelta) ? `<b class="${signTone(rrDelta)}">${signed(rrDelta)}</b>` : ''}
        </span>
        <span class="hx-row-stat hx-row-kda"><strong>${stats ? `${stats.kills || 0} <em>/</em> ${stats.deaths || 0} <em>/</em> ${stats.assists || 0}` : '—'}</strong><small>K / D / A</small></span>
        <span class="hx-row-stat"><strong class="${kdTone(kd)}">${fixed(kd)}</strong><small>K/D</small></span>
        <span class="hx-row-stat hx-row-hs"><strong>${percent(stats?.hsPercent)}</strong><small>HS</small></span>
        <span class="hx-row-stat"><strong>${kind === 'deathmatch' ? (stats?.score ?? '—') : (stats?.acs ?? '—')}</strong><small>${kind === 'deathmatch' ? 'Score' : 'ACS'}</small></span>
        <span class="hx-row-place">${placement === 1 ? '<b class="hx-badge is-mvp">MVP</b>' : placement ? `<b class="hx-badge">${placement}e</b>` : ''}</span>
        <span class="hx-row-chevron" aria-hidden="true">⌄</span>
      </summary>
      <div class="history-game-detail" data-history-detail>${detail}</div>
    </details>`;
  };
  const dayBlock = day => `<section class="hx-day">
      <header class="hx-day-head">
        <strong>${historyEscape(day.label)}</strong>
        <span>${day.count} partie${day.count > 1 ? 's' : ''}</span>
        <span class="hx-day-stats">
          ${day.wins + day.losses ? `<b><i class="is-good">${day.wins}V</i> · <i class="is-bad">${day.losses}D</i></b>` : ''}
          ${Number.isFinite(day.rrNet) ? `<b class="${signTone(day.rrNet)}">${signed(day.rrNet)} RR</b>` : ''}
          ${Number.isFinite(day.kd) ? `<b>K/D <i class="${kdTone(day.kd)}">${fixed(day.kd)}</i></b>` : ''}
          ${Number.isFinite(day.acs) ? `<b>ACS <i>${day.acs}</i></b>` : ''}
        </span>
      </header>
      <div class="hx-matches${historyUI.owner === 'all' ? '' : ' is-solo'}">${day.games.map(gameCard).join('')}</div>
    </section>`;

  // ─── Filtres ───────────────────────────────────────────────────────────
  const segment = (group, value, label, active) => `<button type="button" class="history-filter-button ${active ? 'active' : ''}" data-history-${group}="${historyEscape(value)}" aria-pressed="${active}">${historyEscape(label)}</button>`;
  const ownerChip = (key, label, title, avatarHTML) => `<button type="button" class="history-filter-button hx-owner-chip ${historyUI.owner === key ? 'active' : ''}" data-history-owner="${historyEscape(key)}" aria-pressed="${historyUI.owner === key}" title="${historyEscape(title)}">${avatarHTML}<span>${historyEscape(label)}</span></button>`;
  const toolbar = `<div class="history-filters hx-toolbar">
      <div class="history-filter-group hx-owners">
        <span>Joueur</span>
        <div>
          ${ownerChip('all', 'Tout le groupe', 'Tout le groupe', '<span class="hx-chip-icon" aria-hidden="true">✦</span>')}
          ${ownerOptions.map(owner => ownerChip(owner.key, owner.smurf ? `${owner.name} · smurf` : owner.name, owner.label, avatar(owner.name, owner.avatar, 'hx-chip-avatar'))).join('')}
        </div>
      </div>
      <div class="history-filter-group">
        <span>Période</span>
        <div class="hx-segment">
          ${segment('period', 'today', "Aujourd'hui", historyUI.period === 'today')}
          ${segment('period', '7d', '7 jours', historyUI.period === '7d')}
          ${segment('period', 'all', 'Tout', historyUI.period === 'all')}
        </div>
      </div>
      <label class="history-filter-group hx-mode">
        <span>Mode</span>
        <select class="hx-select" data-history-mode-select aria-label="Mode des parties affichées">
          ${Object.entries(modeLabels).map(([value, label]) => `<option value="${value}"${historyUI.mode === value ? ' selected' : ''}>${label}</option>`).join('')}
        </select>
      </label>
    </div>`;

  el.innerHTML = `${historySyncMarkup(syncState)}
    ${toolbar}
    ${games.length || statsGames.length ? `${profile}${overviewCard}
    <div class="hx-layout">
      <div class="hx-main">
        <div class="hx-main-head"><h3>Parties · ${historyEscape(modeLabels[historyUI.mode])}</h3><span>${Math.min(historyUI.limit, games.length)} sur ${games.length}</span></div>
        ${days.length ? days.map(dayBlock).join('') : '<div class="history-empty-filter">Aucune partie ne correspond à ces filtres.</div>'}
        <div class="history-load-more-wrap">
          ${historyUI.limit < games.length
            ? `<button type="button" class="btn btn-primary" data-history-show-more>Afficher 20 parties de plus · ${Math.min(historyUI.limit, games.length)}/${games.length}</button>`
            : pagerState.hasMore
              ? `<button type="button" class="btn btn-primary" data-history-load-more>Charger les anciennes · ${pagerState.loaded}/${pagerState.total}</button>`
              : `<span>${pagerState.loaded} partie${pagerState.loaded > 1 ? 's' : ''} chargée${pagerState.loaded > 1 ? 's' : ''}</span>`}
        </div>
      </div>
      <aside class="hx-side">${membersCard}${agentsCard}${mapsCard}</aside>
    </div>` : `<div class="history-empty-filter">Aucune partie ne correspond à ces filtres.</div>
    ${pagerState.hasMore ? `<div class="history-load-more-wrap"><button type="button" class="btn btn-primary" data-history-load-more>Charger les anciennes · ${pagerState.loaded}/${pagerState.total}</button></div>` : ''}`}`;

    el.querySelectorAll('[data-history-owner]').forEach(button => button.addEventListener('click', () => {
      historyUI.owner = button.dataset.historyOwner;
      historyUI.limit = 20;
      refreshHistory();
    }));
    el.querySelectorAll('[data-history-period]').forEach(button => button.addEventListener('click', () => {
      historyUI.period = button.dataset.historyPeriod;
      historyUI.limit = 20;
      refreshHistory();
    }));
    el.querySelector('[data-history-mode-select]')?.addEventListener('change', event => {
      historyUI.mode = event.currentTarget.value;
      historyUI.limit = 20;
      refreshHistory();
    });
    el.querySelector('[data-history-show-more]')?.addEventListener('click', () => {
      historyUI.limit += 20;
      refreshHistory();
    });
    el.querySelector('[data-history-load-more]')?.addEventListener('click', async event => {
      const button = event.currentTarget;
      button.disabled = true;
      button.textContent = 'Chargement…';
      try {
        pagerState = await valorantHistoryPager.loadNext();
        rememberValorantHistory(pagerState);
        allGames = normalizeHistoryEntries(pagerState.data).sort((a,b) => (b.ts||0) - (a.ts||0));
        updateOwnerOptions();
        refreshHistory();
      } catch {
        button.disabled = false;
        button.textContent = 'Réessayer de charger les anciennes';
      }
    });
    el.querySelectorAll('details[data-history-id]').forEach(details => details.addEventListener('toggle', async () => {
      if (!details.open || details.dataset.detailLoaded === '1') return;
      const target = details.querySelector('[data-history-detail]');
      const game = allGames.find(candidate => candidate.historyId === details.dataset.historyId);
      if (!target || !game?.__summary) { details.dataset.detailLoaded = '1'; return; }
      target.innerHTML = '<div class="history-detail-loading">Chargement des détails…</div>';
      try {
        const raw = await valorantHistoryPager.loadDetail(details.dataset.historyId);
        const full = normalizeHistoryEntries({ [details.dataset.historyId]:raw })[0];
        if (!full) throw new Error('Détail indisponible');
        const shown = historyUI.owner === 'all' ? full : historyGameForOwner(full, historyUI.owner);
        target.innerHTML = gameDetail(shown);
        details.dataset.detailLoaded = '1';
      } catch {
        target.innerHTML = '<div class="history-detail-loading error">Détails indisponibles · refermez puis réessayez</div>';
      }
    }));
    historyDisclosures.restore(el);
  };

  refreshHistory();
  valorantHistoryRecoveryAttempts = 0;
  clearTimeout(valorantHistoryRecoveryTimer);
  void loadCurrentAct().then(act => {
    if (!act || loadSequence !== historyLoadSequence) return;
    currentActInfo = act;
    refreshHistory();
  });
  void agentMapPromise.then(() => {
    if (loadSequence === historyLoadSequence) refreshHistory();
  });
  if (backgroundRefresh) void backgroundRefresh.then(nextState => {
    if (loadSequence !== historyLoadSequence) return;
    valorantHistoryReady = true;
    pagerState = nextState;
    rememberValorantHistory(nextState);
    allGames = normalizeHistoryEntries(nextState.data).sort((a,b) => (b.ts||0) - (a.ts||0));
    syncState = null;
    updateOwnerOptions();
    refreshHistory();
  }).catch(() => {
    if (loadSequence !== historyLoadSequence) return;
    syncState = { state:'offline', savedAt:cached.savedAt };
    refreshHistory();
  });
}

async function ensureAgentMap() {
  if (window._agentNameToUuid) return;
  try {
    const d = await fetchJsonWithTimeout('https://valorant-api.com/v1/agents?isPlayableCharacter=true', { timeoutMs: 5_000 });
    window._agentNameToUuid = {};
    d.data?.forEach(a => { window._agentNameToUuid[a.displayName] = a.uuid; });
  } catch { window._agentNameToUuid = {}; }
}
function agentIconFromName(name) {
  const map = window._agentNameToUuid || {};
  const uuid = map[name];
  return uuid ? `https://media.valorant-api.com/agents/${uuid}/displayicon.png` : '';
}
