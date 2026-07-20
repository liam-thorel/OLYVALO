/**
 * OLYCITY · Interactions
 * 3D tilt, parallax, theme toggle, search, keyboard shortcuts.
 */

import { storage } from './storage.js';
import { valorantApi } from './api.js';
import { state } from './main.js';
import { groupLiveSessions, mergeSelectedSessionData } from './live-sessions.mjs';

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

// ─── FAVORITES UI ─────────────────────────────────
export function updateFavCount() {
  document.querySelectorAll('.fav-count').forEach(el => {
    el.textContent = state.FAVS.length;
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
      ctx.strokeStyle = `rgba(255,${Math.floor(40 + progress * 30)},${Math.floor(60 + progress * 20)},${alpha})`;
      ctx.lineWidth = width;
      ctx.lineCap = 'round';
      ctx.stroke();
    }

    // Glowing head dot
    const grd = ctx.createRadialGradient(hx, hy, 0, hx, hy, 18);
    grd.addColorStop(0, 'rgba(255,80,70,0.45)');
    grd.addColorStop(1, 'rgba(255,50,60,0)');
    ctx.beginPath();
    ctx.arc(hx, hy, 18, 0, Math.PI * 2);
    ctx.fillStyle = grd;
    ctx.fill();

    // Bright head core
    ctx.beginPath();
    ctx.arc(hx, hy, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,120,100,0.9)';
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
  const gondolaColors = ['#ff4656','#a87fff','#3fcfcf','#ff4656','#a87fff','#3fcfcf','#ff4656','#a87fff'];
  let angle = 0, raf;

  const draw = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.globalAlpha = alpha;

    // Supports legs (static)
    ctx.strokeStyle = '#ff4656'; ctx.lineWidth = size * 0.025;
    ctx.beginPath(); ctx.moveTo(cx, cy + R * 0.95); ctx.lineTo(cx - R * 0.45, canvas.height - 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx, cy + R * 0.95); ctx.lineTo(cx + R * 0.45, canvas.height - 2); ctx.stroke();
    ctx.strokeStyle = '#a87fff'; ctx.lineWidth = size * 0.018;
    ctx.beginPath(); ctx.moveTo(cx - R * 0.45, canvas.height - 2); ctx.lineTo(cx + R * 0.45, canvas.height - 2); ctx.stroke();

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);

    // Outer ring
    ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2);
    ctx.strokeStyle = '#ff4656'; ctx.lineWidth = size * 0.022; ctx.stroke();

    // Inner ring
    ctx.beginPath(); ctx.arc(0, 0, R * 0.32, 0, Math.PI * 2);
    ctx.strokeStyle = '#ff4656'; ctx.globalAlpha = alpha * 0.4; ctx.lineWidth = size * 0.012; ctx.stroke();
    ctx.globalAlpha = alpha;

    // 8 spokes
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * R * 0.32, Math.sin(a) * R * 0.32);
      ctx.lineTo(Math.cos(a) * R, Math.sin(a) * R);
      ctx.strokeStyle = i % 2 === 0 ? '#a87fff' : '#3fcfcf';
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
    ctx.fillStyle = '#ff4656'; ctx.fill();
    ctx.beginPath(); ctx.arc(0, 0, size * 0.042, 0, Math.PI * 2);
    ctx.fillStyle = '#a87fff'; ctx.fill();
    ctx.beginPath(); ctx.arc(0, 0, size * 0.022, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.fill();

    ctx.restore();
    ctx.restore();
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
  if (!window._agentNameToUuid) { fetch('https://valorant-api.com/v1/agents?isPlayableCharacter=true').then(r=>r.json()).then(d=>{ window._agentNameToUuid={}; d.data?.forEach(a=>window._agentNameToUuid[a.displayName]=a.uuid); }).catch(()=>{}); }
  const FIREBASE_URL = 'https://realtime-database-5bb9f-default-rtdb.europe-west1.firebasedatabase.app';
  const AGENT_COLORS = {
    'Jett':'#88c8ff','Raze':'#ff9a3c','Neon':'#5ae6ff','Phoenix':'#ff6b35',
    'Reyna':'#c77dff','Yoru':'#5e60ce','Waylay':'#a8dadc',
    'Sova':'#4361ee','Fade':'#7b2d8b','KAY/O':'#4cc9f0','Skye':'#80b918',
    'Breach':'#f77f00','Gekko':'#99d98c',
    'Viper':'#57cc99','Omen':'#9381ff','Miks':'#9381ff','Clove':'#f72585',
    'Astra':'#480ca8','Harbor':'#4895ef','Brimstone':'#ef233c',
    'Killjoy':'#f9c74f','Cypher':'#e9ecef','Vyse':'#b5838d','Chamber':'#cdb4db',
    'Sage':'#80ffdb',
  };

  let mapImg = null;
  let lastMapName = null;
  let raf = null;
  let currentLiveData = null;

  const canvas = document.getElementById('live-map-canvas');
  const ctx = canvas?.getContext('2d');

  // Firebase SSE listener
  const evtSource = new EventSource(`${FIREBASE_URL}/live/sessions.json`);
  const clientsSource = new EventSource(`${FIREBASE_URL}/live/clients.json`);
  let selectedSession = null;
  let lastSessions = {};
  let lastClients = {};
  let byMatchCache = {};
  const _rosterCache = {};
  let _rosterFetched = false;
  let _mapsCache = null;
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
  const DIAGNOSTIC_LABELS = {
    'idle': 'Script prêt',
    'agent-select': 'Agent Select détecté',
    'in-game': 'Partie en cours',
    'game-ended': 'Partie terminée',
    'riot-offline': 'Client Riot introuvable',
    'error': 'Erreur de synchronisation',
    'stopped': 'Script arrêté',
  };

  function renderDiagnostic() {
    const panel = document.getElementById('live-diagnostic');
    const label = document.getElementById('live-diagnostic-label');
    const detail = document.getElementById('live-diagnostic-detail');
    const version = document.getElementById('live-diagnostic-version');
    if (!panel || !label || !detail || !version) return;

    const entries = Object.entries(lastClients).filter(([, client]) => client && typeof client === 'object');
    const selected = selectedSession ? lastClients[selectedSession] : null;
    const client = selected || entries.sort((a, b) => (b[1].ts || 0) - (a[1].ts || 0))[0]?.[1] || null;
    const age = client?.ts ? Date.now() - Number(client.ts) : Infinity;
    const fresh = client?.online && age < 30000;

    if (!fresh) {
      panel.dataset.state = 'offline';
      label.textContent = 'Script hors ligne';
      detail.textContent = client?.ts
        ? `Dernier signal il y a ${Math.max(1, Math.round(age / 1000))} s`
        : 'En attente du premier signal';
      version.textContent = client?.version ? `v${client.version}` : '—';
      return;
    }

    panel.dataset.state = client.state || 'online';
    label.textContent = DIAGNOSTIC_LABELS[client.state] || 'Script connecté';
    const context = [client.map, client.side, client.error].filter(Boolean).join(' · ');
    detail.textContent = context || (client.riotClient ? 'Client Riot connecté' : 'Client Riot indisponible');
    version.textContent = client.version ? `v${client.version}` : '—';
  }

  function handleClientsSSE(event) {
    try {
      const message = JSON.parse(event.data);
      const path = message.path || '/';
      const data = message.data;
      if (path === '/') {
        lastClients = data && typeof data === 'object' ? data : {};
      } else {
        const clientKey = path.replace(/^\//, '').split('/')[0];
        const subPath = path.replace(/^\/[^/]+/, '').replace(/^\//, '');
        if (!clientKey) return;
        if (!lastClients[clientKey]) lastClients[clientKey] = {};
        if (subPath) lastClients[clientKey][subPath] = data;
        else if (data && typeof data === 'object') lastClients[clientKey] = data;
      }
      renderDiagnostic();
    } catch {}
  }

  clientsSource.addEventListener('put', handleClientsSSE);
  clientsSource.addEventListener('patch', handleClientsSSE);
  const diagnosticTicker = setInterval(renderDiagnostic, 5000);

  const isFreshSession = (session, now = Date.now()) => {
    const updatedAt = Number(session?.ts);
    return Number.isFinite(updatedAt) && updatedAt > 0 && now - updatedAt < 30000;
  };

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
      updateSessionPicker(sessions);

      const now = Date.now();
      const active = Object.entries(sessions).filter(([,s]) => s?.active && (s?.mapClean || s?.map) && isFreshSession(s, now));
      if (active.length === 1) selectedSession = active[0][0];
      
      // Pick session — ONLY from the staleness-filtered active list
      const activeMap = Object.fromEntries(active);
      if (selectedSession && !activeMap[selectedSession]) selectedSession = active[0]?.[0] || null;
      let liveData = selectedSession ? activeMap[selectedSession] : (active[0]?.[1] || null);


      // Key tracks ALL active sessions so any update triggers re-render
      const key = JSON.stringify({
        active: liveData?.active, map: liveData?.mapClean, mode: liveData?.mode,
        phase: liveData?.phase, roundPhase: liveData?.roundPhase,
        matchId: liveData?.matchId, side: liveData?.side,
        activeCount: active.length,
        allPlayers: active.map(([,s]) => (s.players||[]).length).join(','),
        players: (liveData?.players||[]).map(p=>`${p.name}|${p.agentId||p.agent}|${p.team}|${p.rank?.tier??''}|${p.rank?.peakTier??''}|${p.rank?.level??''}|${(p.rank?.rrHistory||[]).join('.')}|${p.rank?.rrEarned??''}`)
      });
      if (key !== lastDataKey) {
        lastDataKey = key;
        // A roster can only be shared by clients observing the same match.
        liveData = mergeSelectedSessionData(liveData, selectedSession, byMatchCache);
        currentLiveData = liveData;
        updateUI(currentLiveData);
      }
    } catch(err) { console.error(err); }
  }
  evtSource.addEventListener('put', handleSSE);
  evtSource.addEventListener('patch', handleSSE);

  // Periodic staleness check — re-evaluate even without new SSE events
  const staleChecker = setInterval(() => {
    try { handleSSE({ type: 'tick', data: JSON.stringify({ path: '/', data: lastSessions }) }); } catch {}
  }, 10000);

  function updateSessionPicker(sessions) {
    let picker = document.getElementById('live-session-picker');
    const page = document.getElementById('page-live');
    if (!page) return;

    const _now = Date.now();
    const active = Object.entries(sessions).filter(([,s]) => s?.active && (s?.mapClean || s?.map) && isFreshSession(s, _now));
    
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
      picker.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;padding:12px 0 16px';
      page.querySelector('.live-page')?.prepend(picker);
    }

    const allPuuids = active.map(([p]) => p);
    if (!selectedSession || !allPuuids.includes(selectedSession)) {
      selectedSession = allPuuids[0] || null;
    }
    const renderSelected = selectedSession;

    // Roster lookup — fetched once per page load (module cache)
    const rosterMap = _rosterCache;
    if (!_rosterFetched) {
      _rosterFetched = true;
      fetch('./data/roster.json').then(r=>r.json()).then(roster => {
        roster.forEach(p => {
          const entry = { avatar: p.avatar, member: p.name };
          if (p.riot?.name) _rosterCache[`${p.riot.name}#${p.riot.tag}`.toLowerCase()] = entry;
          (p.smurfs||[]).forEach(s => { _rosterCache[`${s.name}#${s.tag}`.toLowerCase()] = entry; });
        });
        updateSessionPicker(lastSessions); // re-render with avatars
      }).catch(()=>{});
    }

    picker.innerHTML = `
      <div style="font-family:Tomorrow,sans-serif;font-size:9px;letter-spacing:2px;color:var(--dim);text-transform:uppercase;margin-bottom:8px">Games en cours</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
      ${Object.entries(byMatch).map(([mid, sessions]) => {
        const first = sessions[0];
        const isSelected = sessions.some(p => p.puuid === renderSelected);
        const map = first.mapClean || first.map || '?';
        const mode = first.mode || '';

        // Find roster avatars for players in this game
        const allPlayers = sessions.flatMap(s => s.players || []);
        const rosterAvatars = sessions.map(s => {
          const name = s.playerName || '';
          const key = name.toLowerCase();
          // Try exact match or partial
          const hit = rosterMap[key] || Object.values(rosterMap).find((v,i)=>Object.keys(rosterMap)[i].split('#')[0] === name.toLowerCase().split('#')[0]);
          const avatar = hit?.avatar;
          return avatar || null;
        }).filter(Boolean);

        const avatarsHtml = rosterAvatars.length
          ? `<div style="display:flex;margin-bottom:8px">
              ${rosterAvatars.map((url, i) => `<img src="${url}" style="width:28px;height:28px;border-radius:50%;border:2px solid ${isSelected ? 'var(--red)' : 'var(--border)'};margin-left:${i>0?'-8px':'0'};object-fit:cover;background:var(--surf3)" onerror="this.style.display='none'">`).join('')}
            </div>`
          : '';

        const names = sessions.map(s => s.playerName?.split('#')[0]).join(' & ');
        return `<button onclick="window._selectLiveSession('${sessions[0].puuid}')" style="
          font-family:Tomorrow,sans-serif;cursor:pointer;text-align:left;
          padding:10px 14px;border:1px solid ${isSelected ? 'var(--red)' : 'var(--border)'};
          background:${isSelected ? 'var(--red-low)' : 'var(--surf)'};
          transition:border-color .15s,background .15s;min-width:160px">
          ${avatarsHtml}
          <div style="font-size:11px;font-weight:700;letter-spacing:3px;color:${isSelected ? 'var(--red)' : 'var(--text)'};margin-bottom:3px">${map.toUpperCase()}</div>
          <div style="font-size:9px;letter-spacing:1px;color:var(--muted)">${names}</div>
          <div style="font-size:8px;letter-spacing:1px;color:var(--dim);margin-top:2px;text-transform:uppercase">${mode}</div>
        </button>`;
      }).join('')}
      </div>`;
  }

  window._selectLiveSession = (puuid) => {
    selectedSession = puuid;
    updateSessionPicker(lastSessions); // re-render picker immediately with new selection
    renderDiagnostic();
    const rawData = lastSessions[puuid] || null;
    const data = mergeSelectedSessionData(rawData, selectedSession, byMatchCache);
    if (data) {
      lastDataKey = '';
      currentLiveData = data;
      updateUI(data);
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
      if (m?.splash && imgEl) imgEl.src = m.splash;
      else if (m?.displayIcon && imgEl) imgEl.src = m.displayIcon;
    } catch { _mapsCache = null; }
  }

  function updateUI(data) {
    const waiting = document.getElementById('live-waiting');
    const content = document.getElementById('live-content');
    const dot = document.getElementById('live-dot');

    if (!data?.active) {
      // Debounce — only hide after 3s to avoid Firebase reconnect flashes
      if (!updateUI._hideTimer) {
        updateUI._hideTimer = setTimeout(() => {
          if (waiting) waiting.style.display = 'flex';
          if (content) content.style.display = 'none';
          if (dot) dot.style.display = 'none';
          updateUI._hideTimer = null;
        }, 3000);
      }
      return;
    }
    // Cancel pending hide if we got active data
    if (updateUI._hideTimer) { clearTimeout(updateUI._hideTimer); updateUI._hideTimer = null; }

    if (waiting?.style.display !== 'none')  waiting.style.display  = 'none';
    if (content?.style.display !== 'block') content.style.display  = 'block';
    if (dot?.style.display     !== 'block') dot.style.display      = 'block';

    const isPregame = data?.phase === 'pregame' || data?.mode === 'agent-select';
    const liveBody = content?.querySelector('.live-body');
    if (liveBody) liveBody.style.display = isPregame ? 'none' : '';

    // Map — guard + internal name conversion
    // Internal codename → display. Includes wrong legacy values from old scripts.
    const _MAP_DISPLAY = {
      'Ascent':'Ascent','Bonsai':'Split','Duality':'Bind','Triad':'Haven','Port':'Icebox',
      'Foxtrot':'Breeze','Canyon':'Fracture','Pitt':'Pearl','Jam':'Lotus','Juliett':'Sunset',
      'Infinity':'Abyss','Rook':'Corrode','Plummet':'Summit','Poveglia':'Range','Range':'Range',
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
    const mapLabel = document.getElementById('live-map-label');
    const modeLabel = document.getElementById('live-mode-label');
    if (mapLabel && mapLabel.textContent !== mapName) mapLabel.textContent = mapName;
    if (modeLabel && modeLabel.textContent !== (data.mode||'')) modeLabel.textContent = data.mode || '';

    // Average rank display under map image
    const players = data.players || [];
    const rankedPlayers = players.filter(p => p.rank?.tier > 2);
    if (rankedPlayers.length > 0) {
      const avgTier = Math.round(rankedPlayers.reduce((s,p) => s + (p.rank?.tier||0), 0) / rankedPlayers.length);
      const avgName = RANK_NAMES[avgTier] || '';
      let avgEl = document.getElementById('live-avg-rank');
      if (!avgEl) {
        avgEl = document.createElement('div');
        avgEl.id = 'live-avg-rank';
        avgEl.style.cssText = 'position:absolute;top:12px;right:12px;display:flex;align-items:center;gap:8px;background:rgba(6,8,12,.7);padding:6px 10px;backdrop-filter:blur(4px)';
        document.querySelector('.live-minimap-wrap')?.appendChild(avgEl);
      }
      if (avgEl.dataset.tier !== String(avgTier)) {
        avgEl.dataset.tier = avgTier;
        avgEl.innerHTML = `
          <img id="live-rank-icon" src="" style="width:28px;height:28px;object-fit:contain" alt="">
          <div>
            <div style="font-family:Tomorrow,sans-serif;font-size:8px;letter-spacing:1px;color:rgba(255,255,255,.5);text-transform:uppercase">Rang moyen</div>
            <div style="font-family:Tomorrow,sans-serif;font-size:11px;font-weight:700;letter-spacing:2px;color:#fff">${avgName.toUpperCase()}</div>
          </div>`;
        // Load rank icon from valorant-api
        if (!window._rankIconsCache) window._rankIconsCache = {};
        if (window._rankIconsCache[avgTier]) {
          avgEl.querySelector('#live-rank-icon').src = window._rankIconsCache[avgTier];
        } else {
          fetch('https://valorant-api.com/v1/competitivetiers').then(r=>r.json()).then(d => {
            const latest = d.data?.[d.data.length-1];
            const tier = latest?.tiers?.find(t => t.tier === avgTier);
            if (tier?.largeIcon) {
              window._rankIconsCache[avgTier] = tier.largeIcon;
              const img = document.getElementById('live-rank-icon');
              if (img) img.src = tier.largeIcon;
            }
          }).catch(()=>{});
        }
      }
    }

    // Player tag — guard
    const header = document.getElementById('live-header');
    if (header && data.playerName) {
      let playerEl = document.getElementById('live-player-tag');
      if (!playerEl) {
        playerEl = document.createElement('div');
        playerEl.id = 'live-player-tag';
        playerEl.style.cssText = 'font-family:Tomorrow,sans-serif;font-size:10px;letter-spacing:2px;color:var(--muted);text-transform:uppercase;margin-left:auto';
        header.appendChild(playerEl);
      }
      if (playerEl.textContent !== data.playerName) playerEl.textContent = data.playerName;
    }

    // Score
    const score = data.score || {};
    let scoreEl = document.getElementById('live-score');
    if (!scoreEl && document.getElementById('live-header')) {
      scoreEl = document.createElement('div');
      scoreEl.id = 'live-score';
      scoreEl.style.cssText = 'font-family:Tomorrow,sans-serif;font-size:20px;font-weight:700;letter-spacing:4px;color:var(--text)';
      document.getElementById('live-header').insertBefore(scoreEl, document.getElementById('live-timer'));
    }
    if (scoreEl) {
      const s = `${score.blue||0} — ${score.red||0}`;
      if (scoreEl.textContent !== s) scoreEl.textContent = s;
    }

    // Pregame — show map comps during agent select
    let compsEl = document.getElementById('live-comps-panel');
    if (isPregame && (data?.mapClean || data?.map)) {
      const pgMapName = data.mapClean || data.map;
      const pregameRenderKey = `${pgMapName}|${data.side || ''}`;
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
        fetch('./data/comps.json').then(r=>r.json()).then(comps => {
          const mapData = comps.find(m => m.map === pgMapName);
          if (!mapData) { compsEl.innerHTML = ''; return; }
          const pick = t => mapData.comps.find(c => c.tier === t);
          const show = [pick('S'), pick('PRO'), pick('F')].filter(Boolean);
          compsEl.innerHTML = `
            <div class="live-pregame-header ${sideClass}">
              <div class="live-pregame-heading">
                <span class="live-pregame-kicker">Agent Select</span>
                <strong>${pgMapName}</strong>
                <span>Compositions recommandées</span>
              </div>
              <div class="live-side-card ${sideClass}" aria-label="${sideLabel}">
                <span class="live-side-icon" aria-hidden="true"></span>
                <span class="live-side-copy">
                  <small>${sideHint}</small>
                  <strong>${sideLabel}</strong>
                </span>
              </div>
            </div>
            <div style="display:flex;gap:10px;flex-wrap:wrap">
            ${show.map(c => `
              <div style="flex:1;min-width:210px;background:var(--surf);border:1px solid var(--border);padding:12px 14px">
                <div style="font-family:Tomorrow,sans-serif;font-size:8px;letter-spacing:2px;color:var(--muted);text-transform:uppercase;margin-bottom:8px">${c.label || c.tier}</div>
                <div style="display:flex;gap:6px;align-items:center;margin-bottom:8px">
                  ${c.agents.map(a => { const u = (window._agentNameToUuid||{})[a]; return u ? `<img src="https://media.valorant-api.com/agents/${u}/displayicon.png" style="width:30px;height:30px;object-fit:cover" title="${a}">` : `<span style="font-size:9px;color:var(--dim)">${a}</span>`; }).join('')}
                </div>
                <div style="font-family:Tomorrow,sans-serif;font-size:9px;color:var(--dim);letter-spacing:1px">${c.agents.join(' · ')}</div>
              </div>
            `).join('')}
            </div>`;
        }).catch(()=>{});
      }
    } else if (!isPregame && compsEl) {
      compsEl.remove();
    }

    // Win % based on agent meta scores (client-side only, no Firebase)
    const META_SCORES = {
      // S-tier
      'Jett':9,'Neon':8,'Raze':8,'Viper':9,'Omen':8,'Astra':8,'Killjoy':9,'Cypher':8,
      'Sova':9,'Breach':8,'Fade':8,'Gekko':8,'Chamber':7,'Skye':8,'Clove':8,
      // A-tier
      'Reyna':7,'Iso':7,'Sage':7,'Brimstone':7,'Harbor':7,'KAY/O':7,'Tejo':8,
      'Deadlock':7,'Vyse':7,'Veto':8,'Phoenix':6,'Yoru':7,'Waylay':7,'Miks':7,
      // Default
    };
    const getScore = (p) => META_SCORES[p.agent] || 6;
    const allyTeam = (data.players||[]).filter(p => p.team === 'ORDER');
    const enemyTeam = (data.players||[]).filter(p => p.team === 'CHAOS');
    if (allyTeam.length >= 5 && enemyTeam.length >= 5) {
      const allyScore   = allyTeam.reduce((s,p)=>s+getScore(p),0) / allyTeam.length;
      const enemyScore  = enemyTeam.reduce((s,p)=>s+getScore(p),0) / enemyTeam.length;
      const winPct      = Math.round((allyScore / (allyScore + enemyScore)) * 100);
      const color       = winPct >= 55 ? '#3fcf6b' : winPct <= 45 ? '#ff4656' : '#f5c842';
      let winEl = document.getElementById('live-winpct');
      if (!winEl) {
        winEl = document.createElement('div');
        winEl.id = 'live-winpct';
        winEl.style.cssText = 'display:flex;align-items:center;gap:6px;padding:6px 2px 0;margin-top:4px';
        const minimapWrap = document.querySelector('.live-minimap-wrap');
        if (minimapWrap) minimapWrap.after(winEl);
      }
      const bar = Math.round(winPct * 1.4); // 0→140px
      winEl.innerHTML = `
        <div style="font-family:Tomorrow,sans-serif;font-size:8px;letter-spacing:2px;color:var(--dim);text-transform:uppercase;flex-shrink:0">Compo</div>
        <div style="flex:1;height:3px;background:var(--border);position:relative">
          <div style="position:absolute;left:0;top:0;height:100%;width:${winPct}%;background:${color};transition:width .5s"></div>
          <div style="position:absolute;left:50%;top:-4px;height:11px;width:1px;background:var(--border2)"></div>
        </div>
        <div style="font-family:Tomorrow,sans-serif;font-size:10px;font-weight:700;color:${color};flex-shrink:0">${winPct}%</div>`;
    } else {
      const winEl = document.getElementById('live-winpct');
      if (winEl) winEl.remove();
    }

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
      item.innerHTML = `<span style="color:var(--red)">${lastKill.killer}</span> <span style="opacity:.5">→</span> ${lastKill.victim}`;
      feedEl.appendChild(item);
      setTimeout(() => item.remove(), 3000);
    }

    // Phase — guard
    const phaseEl = document.getElementById('live-phase');
    const phase = data.roundPhase || data.mode || '—';
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
    const all = (data.players || []);
    // In deathmatch everyone is on same "team" — just show all
    const allies = all.filter(p => p.team === 'ORDER');
    const enemies = all.filter(p => p.team === 'CHAOS');
    const isDM = /deathmatch/i.test(data.mode || '') || all.some(p => p.team === 'NEUTRAL') || allies.length === all.length || enemies.length === 0;

    // Ranks arrive asynchronously after the roster. Include every displayed rank
    // field so the player rows refresh immediately without requiring an F5.
    const stableKey = all.map(p => {
      const rank = p.rank || {};
      return `${p.name}|${p.agent}|${p.team}|${rank.tier ?? ''}|${rank.rr ?? ''}|${rank.peakTier ?? ''}|${rank.level ?? ''}|${(rank.rrHistory || []).join('.')}|${rank.rrEarned ?? ''}`;
    }).join(',');
    if (playersEl && playersEl.dataset.key !== stableKey) {
      playersEl.dataset.key = stableKey;
      playersEl.innerHTML = isDM
        ? all.map(p => playerRow(p, myName)).join('')
        : `<div style="font-family:Tomorrow,sans-serif;font-size:9px;letter-spacing:2px;color:var(--dim);text-transform:uppercase;padding:4px 0 8px">Alliés</div>
           ${allies.map(p => playerRow(p, myName)).join('')}
           <div style="font-family:Tomorrow,sans-serif;font-size:9px;letter-spacing:2px;color:var(--dim);text-transform:uppercase;padding:12px 0 8px">Ennemis</div>
           ${enemies.map(p => playerRow(p, myName)).join('')}`;
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
      if (avgW !== null) parts.push(`<span style="color:#3fcf6b">+${avgW}</span>`);
      if (avgL !== null) parts.push(`<span style="color:#ff4656">${avgL}</span>`);
      if (!parts.length) return '';
      return `<span style="font-size:9px;font-family:Tomorrow,sans-serif;letter-spacing:1px;opacity:.85">${parts.join('<span style="opacity:.3"> / </span>')}</span>`;
    }
    if (rank.rrEarned !== undefined && rank.rrEarned !== 0) {
      const v = rank.rrEarned;
      const color = v > 0 ? '#3fcf6b' : '#ff4656';
      return `<span style="font-size:9px;font-family:Tomorrow,sans-serif;color:${color};letter-spacing:1px">${v>0?'+':''}${v} RR</span>`;
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
      return `<span style="font-size:8px;font-family:Tomorrow,sans-serif;letter-spacing:1px;color:#ff4656;border:1px solid rgba(255,70,86,.4);padding:1px 4px">SMURF</span>`;
    }
    if (bigGap && isHighPeak) {
      return `<span style="font-size:8px;font-family:Tomorrow,sans-serif;letter-spacing:1px;color:#f5c842;border:1px solid rgba(245,200,66,.3);padding:1px 4px">⚠</span>`;
    }
    return '';
  }

  const RANK_NAMES = [
    'Unranked','Unranked','Unranked',
    'Iron 1','Iron 2','Iron 3',
    'Bronze 1','Bronze 2','Bronze 3',
    'Silver 1','Silver 2','Silver 3',
    'Gold 1','Gold 2','Gold 3',
    'Platinum 1','Platinum 2','Platinum 3',
    'Diamond 1','Diamond 2','Diamond 3',
    'Ascendant 1','Ascendant 2','Ascendant 3',
    'Immortal 1','Immortal 2','Immortal 3',
    'Radiant'
  ];
  const RANK_COLORS = {
    'Iron':'#8b9bb4','Bronze':'#cd7f32','Silver':'#c0c0c0',
    'Gold':'#f5c842','Platinum':'#40c9c9','Diamond':'#9b59b6',
    'Ascendant':'#2ecc71','Immortal':'#e74c3c','Radiant':'#ffd700','Unranked':'#555'
  };
  function rankDisplay(rank) {
    if (!rank) return '';
    const name = RANK_NAMES[rank.tier] || 'Unranked';
    const base = name.split(' ')[0];
    const color = RANK_COLORS[base] || '#888';
    return `<span style="font-size:8px;font-family:Tomorrow,sans-serif;letter-spacing:1px;color:${color};opacity:.8">${name}</span>`;
  }

  // Agent UUID → icon URL cache
  const agentIconCache = {};
  let agentUuidMap = {}; // name → uuid
  const uuidToName = {}; // uuid → name (source de vérité API)
  fetch('https://valorant-api.com/v1/agents?isPlayableCharacter=true')
    .then(r=>r.json()).then(d=>{
      window._agentNameToUuid = window._agentNameToUuid || {};
      d.data?.forEach(a => { agentUuidMap[a.displayName] = a.uuid; uuidToName[a.uuid.toLowerCase()] = a.displayName; window._agentNameToUuid[a.displayName] = a.uuid; });
      if (currentLiveData) { lastDataKey = ''; updateUI(currentLiveData); } // re-render avec les bons noms
    }).catch(()=>{});

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
    const hit = _rosterCache[name.toLowerCase()];
    return hit?.member || null;
  }

  function playerRow(p, myName) {
    const hpPct = (p.maxHp && p.hp !== undefined) ? Math.round((p.hp/p.maxHp)*100) : 100;
    const hpColor = hpPct > 60 ? '#3fcf6b' : hpPct > 30 ? '#f9c74f' : '#ff4656';
    const isMe = myName && p.name?.includes(myName.split('#')[0]);
    const fixedAgent = fixAgentName(p);
    const imgUrl = agentIconUrl(fixedAgent, p.agentId);

    return `<div class="live-player-row ${p.alive===false ? 'dead' : ''} ${isMe ? 'me' : ''}">
      ${imgUrl ? `<img class="live-player-agent" src="${imgUrl}" onerror="this.style.visibility='hidden'">` : '<div class="live-player-agent" style="background:var(--surf3)"></div>'}
      <div style="flex:1;min-width:0">
        <div class="live-player-name" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
          ${p.incognito
            ? `<span style="opacity:.5;font-style:italic">${fixedAgent||'?'}</span> <span style="font-size:8px;letter-spacing:1px;color:#888;border:1px solid #333;padding:1px 4px">ANONYME</span>`
            : `${p.name || '—'} <span style="opacity:.4;font-size:9px;font-weight:400">${fixedAgent||''}</span>${olycityMember(p.name) ? ` <span style="font-size:8px;letter-spacing:1px;color:#ff4656;border:1px solid rgba(255,70,86,.5);padding:1px 5px;font-weight:700;vertical-align:middle">OLY · ${olycityMember(p.name)}</span>` : ''}`
          }
        </div>
        <div style="margin-top:3px;display:flex;align-items:center;gap:6px">
          ${rankDisplay(p.rank)}
          ${rrDisplay(p.rank)}
          ${smurfBadge(p.rank)}
        </div>
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;flex-shrink:0">

        ${!p.incognito && p.name && p.name.includes('#') ? `<a href="https://tracker.gg/valorant/profile/riot/${encodeURIComponent(p.name)}/overview" target="_blank" style="font-family:Tomorrow,sans-serif;font-size:8px;letter-spacing:1px;color:#ff4656;text-decoration:none;padding:2px 6px;border:1px solid rgba(255,70,86,.3);text-transform:uppercase">TRACKER</a>` : ''}
      </div>
    </div>`;
  }

  function drawMinimap(players) {
    if (!ctx) return;
    ctx.clearRect(0, 0, 400, 400);
    if (mapImg) {
      ctx.drawImage(mapImg, 0, 0, 400, 400);
      ctx.fillStyle = 'rgba(6,8,12,.3)';
      ctx.fillRect(0, 0, 400, 400);
    } else {
      ctx.fillStyle = '#0d1117';
      ctx.fillRect(0, 0, 400, 400);
    }

    // Draw player dots
    players.forEach(p => {
      if (!p.alive) return;
      const isAlly = p.team === 'ORDER';
      // Valorant coords are roughly -20000 to +20000 — normalize
      const nx = (p.position.x + 20000) / 40000;
      const ny = 1 - (p.position.y + 20000) / 40000; // Y inverted
      const x = nx * 400, y = ny * 400;
      const color = AGENT_COLORS[p.agent] || (isAlly ? '#3fcf6b' : '#ff4656');
      const r = isAlly ? 8 : 7;

      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI*2);
      ctx.fillStyle = color; ctx.fill();
      ctx.strokeStyle = isAlly ? '#fff' : 'rgba(255,255,255,.4)';
      ctx.lineWidth = 2; ctx.stroke();

      // Agent initial
      ctx.fillStyle = '#000'; ctx.font = `bold ${r}px Tomorrow`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText((p.agent||'?')[0], x, y);
    });
  }

  return () => {
    evtSource.close();
    clientsSource.close();
    clearInterval(staleChecker);
    clearInterval(diagnosticTicker);
    if (timerInterval) clearInterval(timerInterval);
  };
}

export async function initHistoryPage() {
  const FIREBASE_URL = 'https://realtime-database-5bb9f-default-rtdb.europe-west1.firebasedatabase.app';
  const el = document.getElementById('history-content');
  if (!el) return;
  await ensureAgentMap();
  el.innerHTML = '<div style="font-family:Tomorrow,sans-serif;font-size:10px;letter-spacing:3px;color:var(--dim);text-transform:uppercase;padding:32px 0">Chargement</div>';

  let games = [];
  try {
    const r = await fetch(`${FIREBASE_URL}/live/history.json`);
    const data = await r.json();
    if (data) games = Object.values(data).filter(g => g && g.map);
  } catch {}

  if (!games.length) {
    el.innerHTML = `<div style="border:1px solid var(--border);background:var(--surf);padding:40px 24px;text-align:center">
      <div style="font-family:Tomorrow,sans-serif;font-size:12px;letter-spacing:3px;text-transform:uppercase;color:var(--muted);margin-bottom:8px">Aucune game enregistrée</div>
      <div style="font-family:Tomorrow,sans-serif;font-size:9px;letter-spacing:1px;color:var(--dim);line-height:1.6">Les parties se sauvegardent automatiquement à la fin de chaque game.<br>Script v4.3 minimum requis.</div>
    </div>`;
    return;
  }

  games.sort((a,b) => (b.ts||0) - (a.ts||0));

  const comp = games.filter(g => (g.mode||'').toLowerCase().includes('comp'));
  const withResult = games.filter(g => g.result === 'win' || g.result === 'loss');
  const wins = withResult.filter(g => g.result === 'win').length;
  const wr = withResult.length ? Math.round(wins / withResult.length * 100) : null;

  const byMap = {};
  withResult.forEach(g => {
    if (!byMap[g.map]) byMap[g.map] = { w:0, n:0 };
    byMap[g.map].n++;
    if (g.result === 'win') byMap[g.map].w++;
  });
  const mapStats = Object.entries(byMap).map(([m,s]) => ({map:m, wr:Math.round(s.w/s.n*100), w:s.w, n:s.n}))
    .sort((a,b) => b.n - a.n);

  const agentCount = {};
  games.forEach(g => {
    const self = (g.players||[]).find(p => p.name === g.player);
    if (self?.agent && self.agent !== '?') agentCount[self.agent] = (agentCount[self.agent]||0)+1;
  });
  const topAgents = Object.entries(agentCount).sort((a,b)=>b[1]-a[1]).slice(0,6);

  const wrColor = v => v >= 55 ? '#3fcf6b' : v <= 45 ? '#ff4656' : '#e0b341';
  const relTime = ts => {
    const d = Date.now() - ts;
    if (d < 3600000) return Math.round(d/60000) + ' min';
    if (d < 86400000) return Math.round(d/3600000) + ' h';
    return Math.round(d/86400000) + ' j';
  };
  const durationLabel = ms => {
    if (!ms || ms < 0) return '—';
    const totalMinutes = Math.round(ms / 60000);
    return `${Math.floor(totalMinutes / 60) ? Math.floor(totalMinutes / 60) + ' h ' : ''}${totalMinutes % 60} min`;
  };
  const dateLabel = ts => ts ? new Date(ts).toLocaleString('fr-FR', {
    day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit'
  }) : '—';
  const dayKey = ts => {
    const date = new Date(ts || 0);
    return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  };
  const todayKey = dayKey(Date.now());
  const dailyGroups = Object.entries(games.reduce((groups, game) => {
    const key = dayKey(game.ts);
    if (!groups[key]) groups[key] = [];
    groups[key].push(game);
    return groups;
  }, {})).sort((a,b) => b[0].localeCompare(a[0]));

  const dailySummary = ([key, dayGames]) => {
    const decided = dayGames.filter(game => game.result === 'win' || game.result === 'loss');
    const dayWins = decided.filter(game => game.result === 'win').length;
    const rrValues = dayGames.map(game => game.rr?.delta).filter(value => Number.isFinite(value));
    const rrTotal = rrValues.reduce((sum, value) => sum + value, 0);
    const duration = dayGames.reduce((sum, game) => sum + (game.durationMs || Math.max(0, (game.endTs||0) - (game.ts||0))), 0);
    const maps = [...new Set(dayGames.map(game => game.map).filter(Boolean))];
    const agents = [...new Set(dayGames.map(game =>
      (game.players||[]).find(player => player.name === game.player || player.puuid === game.playerPuuid)?.agent
    ).filter(agent => agent && agent !== '?'))];
    const label = key === todayKey ? "Aujourd'hui" : new Date(`${key}T12:00:00`).toLocaleDateString('fr-FR', {
      weekday:'long', day:'2-digit', month:'long'
    });
    return { key, label, games:dayGames, decided, wins:dayWins, rrValues, rrTotal, duration, maps, agents };
  };
  const daily = dailyGroups.map(dailySummary);
  const sectionTitle = t => `<div style="font-family:Tomorrow,sans-serif;font-size:9px;letter-spacing:4px;color:var(--dim);text-transform:uppercase;margin:0 0 12px;padding-bottom:8px;border-bottom:1px solid var(--border)">${t}</div>`;

  const statCard = (label, value, color) => `
    <div style="flex:1;min-width:130px;border:1px solid var(--border);background:var(--surf);padding:16px 18px">
      <div style="font-family:Tomorrow,sans-serif;font-size:8px;letter-spacing:3px;color:var(--dim);text-transform:uppercase;margin-bottom:8px">${label}</div>
      <div style="font-family:Tomorrow,sans-serif;font-size:26px;font-weight:700;line-height:1;color:${color||'var(--text)'}">${value}</div>
    </div>`;

  el.innerHTML = `
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:32px">
      ${statCard('Games totales', games.length)}
      ${statCard('Compétitif', comp.length)}
      ${wr !== null ? statCard('Winrate', wr+'%', wrColor(wr)) : ''}
      ${withResult.length ? statCard('Bilan', wins+'V '+(withResult.length-wins)+'D') : ''}
    </div>

    ${daily.length ? `
    <div class="history-daily-section">
      ${sectionTitle('Récap par jour')}
      <div class="history-daily-grid">
        ${daily.slice(0,14).map(day => {
          const winrate = day.decided.length ? Math.round(day.wins / day.decided.length * 100) : null;
          return `
          <article class="history-day-card">
            <header>
              <span>${day.label}</span>
              <strong>${day.games.length} game${day.games.length > 1 ? 's' : ''}</strong>
            </header>
            <div class="history-day-metrics">
              <div><small>Bilan</small><strong>${day.decided.length ? `${day.wins}V ${day.decided.length-day.wins}D` : '—'}</strong></div>
              <div><small>Winrate</small><strong style="color:${winrate === null ? 'var(--dim)' : wrColor(winrate)}">${winrate === null ? '—' : winrate+'%'}</strong></div>
              <div><small>Durée</small><strong>${durationLabel(day.duration)}</strong></div>
              <div><small>RR</small><strong class="${day.rrTotal >= 0 ? 'positive' : 'negative'}">${day.rrValues.length ? `${day.rrTotal >= 0 ? '+' : ''}${day.rrTotal}` : '—'}</strong></div>
            </div>
            <div class="history-day-tags">
              ${day.maps.map(map => `<span>${map}</span>`).join('')}
              ${day.agents.map(agent => `<span class="agent">${agent}</span>`).join('')}
            </div>
          </article>`;
        }).join('')}
      </div>
    </div>` : ''}

    ${topAgents.length ? `
    <div style="margin-bottom:32px">
      ${sectionTitle('Agents les plus joués')}
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${topAgents.map(([a,n]) => `
          <div style="display:flex;align-items:center;gap:8px;border:1px solid var(--border);background:var(--surf);padding:6px 12px 6px 6px">
            <img src="${agentIconFromName(a)}" style="width:30px;height:30px;object-fit:cover" onerror="this.style.display='none'">
            <div>
              <div style="font-family:Tomorrow,sans-serif;font-size:10px;letter-spacing:1px;color:var(--text)">${a}</div>
              <div style="font-family:Tomorrow,sans-serif;font-size:8px;letter-spacing:1px;color:var(--dim)">${n} game${n>1?'s':''}</div>
            </div>
          </div>`).join('')}
      </div>
    </div>` : ''}

    ${mapStats.length ? `
    <div style="margin-bottom:32px">
      ${sectionTitle('Winrate par map')}
      <div style="display:flex;flex-direction:column;gap:6px">
        ${mapStats.map(s => `
          <div style="display:flex;align-items:center;gap:14px;border:1px solid var(--border);background:var(--surf);padding:10px 14px">
            <div style="font-family:Tomorrow,sans-serif;font-size:11px;font-weight:700;letter-spacing:2px;color:var(--text);width:90px;flex-shrink:0">${s.map.toUpperCase()}</div>
            <div style="flex:1;height:4px;background:var(--bg);position:relative;overflow:hidden">
              <div style="position:absolute;left:0;top:0;height:100%;width:${s.wr}%;background:${wrColor(s.wr)};transition:width .4s"></div>
            </div>
            <div style="font-family:Tomorrow,sans-serif;font-size:11px;font-weight:700;color:${wrColor(s.wr)};width:38px;text-align:right">${s.wr}%</div>
            <div style="font-family:Tomorrow,sans-serif;font-size:8px;letter-spacing:1px;color:var(--dim);width:54px;text-align:right">${s.w}V ${s.n-s.w}D</div>
          </div>`).join('')}
      </div>
    </div>` : ''}

    <div>
      ${sectionTitle('Dernières games')}
      <div style="display:flex;flex-direction:column;gap:5px">
        ${games.slice(0,40).map(g => {
          const r = g.result;
          const rColor = r==='win' ? '#3fcf6b' : r==='loss' ? '#ff4656' : 'var(--dim)';
          const rLabel = r==='win' ? 'V' : r==='loss' ? 'D' : '·';
          const score = g.score ? `${g.score.blue}–${g.score.red}` : '';
          const self = (g.players||[]).find(p => p.name === g.player || p.puuid === g.playerPuuid);
          const rrDelta = g.rr?.delta;
          const detailedPlayers = (g.players||[]).filter(p => p.stats);
          return `
          <details class="history-game" style="--result-color:${rColor}">
            <summary class="history-game-summary">
              <span class="history-result">${rLabel}</span>
              ${self?.agent ? `<img class="history-self-agent" src="${agentIconFromName(self.agent)}" alt="${self.agent}" onerror="this.style.display='none'">` : ''}
              <span class="history-game-main">
                <strong>${(g.map||'?').toUpperCase()}</strong>
                <small>${g.mode||''} · ${dateLabel(g.ts)}</small>
              </span>
              ${score ? `<strong class="history-score">${score}</strong>` : '<span class="history-score muted">—</span>'}
              ${rrDelta !== undefined && rrDelta !== null ? `<span class="history-rr ${rrDelta >= 0 ? 'positive' : 'negative'}">${rrDelta >= 0 ? '+' : ''}${rrDelta} RR</span>` : ''}
              <span class="history-duration">${durationLabel(g.durationMs || ((g.endTs||0)-(g.ts||0)))}</span>
              <span class="history-expand">⌄</span>
            </summary>
            <div class="history-game-detail">
              ${detailedPlayers.length ? `
                <div class="history-teams">
                  ${['ORDER','CHAOS'].map(team => `
                    <div class="history-team">
                      <div class="history-team-title">${team === g.selfTeam ? 'Votre équipe' : 'Adversaires'}</div>
                      ${detailedPlayers.filter(p => p.team === team).sort((a,b)=>(b.stats?.score||0)-(a.stats?.score||0)).map(p => `
                        <div class="history-player ${p.name === g.player || p.puuid === g.playerPuuid ? 'self' : ''}">
                          <img src="${agentIconFromName(p.agent)}" alt="${p.agent||''}" onerror="this.style.visibility='hidden'">
                          <span class="history-player-name">${(p.name||'?').split('#')[0]}<small>${p.agent||'?'}</small></span>
                          <strong>${p.stats?.kills||0}/${p.stats?.deaths||0}/${p.stats?.assists||0}</strong>
                          <span>${p.stats?.acs||0} ACS</span>
                        </div>`).join('')}
                    </div>`).join('')}
                </div>` : `<div class="history-legacy-note">Cette ancienne game ne contient pas encore les statistiques détaillées.</div>`}
            </div>
          </details>`;
        }).join('')}
      </div>
    </div>`;
}

async function ensureAgentMap() {
  if (window._agentNameToUuid) return;
  try {
    const r = await fetch('https://valorant-api.com/v1/agents?isPlayableCharacter=true');
    const d = await r.json();
    window._agentNameToUuid = {};
    d.data?.forEach(a => { window._agentNameToUuid[a.displayName] = a.uuid; });
  } catch { window._agentNameToUuid = {}; }
}
function agentIconFromName(name) {
  const map = window._agentNameToUuid || {};
  const uuid = map[name];
  return uuid ? `https://media.valorant-api.com/agents/${uuid}/displayicon.png` : '';
}
