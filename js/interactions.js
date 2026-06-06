/**
 * OLYCITY · Interactions
 * 3D tilt, parallax, theme toggle, search, keyboard shortcuts.
 */

import { storage } from './storage.js';
import { valorantApi } from './api.js';
import { state } from './main.js';

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
  let liveData = null;

  const canvas = document.getElementById('live-map-canvas');
  const ctx = canvas?.getContext('2d');

  // Firebase SSE listener
  const evtSource = new EventSource(`${FIREBASE_URL}/live/sessions.json`);
  let selectedSession = null;
  let lastSessions = {};
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
  function handleSSE(e) {
    try {
      const msg = JSON.parse(e.data);
      const path = msg.path || '/';
      const data = msg.data;

      if (path === '/') {
        // Full replace
        lastSessions = (data && typeof data === 'object') ? data : {};
      } else {
        // Partial update — path is like '/d70bdb3f-...'
        const puuid = path.replace(/^\//, '').split('/')[0];
        const subPath = path.replace(/^\/[^/]+/, '');
        if (puuid) {
          if (!lastSessions[puuid]) lastSessions[puuid] = {};
          if (subPath) {
            // Deep field update like /d70bdb3f/ts
            const field = subPath.replace(/^\//, '');
            lastSessions[puuid][field] = data;
          } else {
            // Full session update
            if (data && typeof data === 'object') Object.assign(lastSessions[puuid], data);
            else lastSessions[puuid] = data;
          }
        }
      }
      const sessions = lastSessions;
      updateSessionPicker(sessions);

      const now = Date.now();
      const active = Object.entries(sessions).filter(([,s]) => s?.active && (s?.mapClean || s?.map) && (now - (s.ts||0)) < 300000);
      if (active.length === 1) selectedSession = active[0][0];
      
      const liveData = selectedSession && sessions[selectedSession]?.active 
        ? sessions[selectedSession] 
        : active.length > 0 ? active[0][1] : null;

      const key = JSON.stringify({
        active: liveData?.active, map: liveData?.mapClean, mode: liveData?.mode,
        phase: liveData?.roundPhase, matchId: liveData?.matchId,
        roundStart: liveData?.roundStartTime,
        players: (liveData?.players||[]).map(p=>`${p.name}|${p.agent}|${p.team}|${p.rank?.tier||0}|${p.rank?.rrEarned||''}`)
      });
      if (key !== lastDataKey) {
        lastDataKey = key;
        updateUI(liveData);
      }
    } catch(err) { console.error(err); }
  }
  evtSource.addEventListener('put', handleSSE);
  evtSource.addEventListener('patch', handleSSE);

  function updateSessionPicker(sessions) {
    let picker = document.getElementById('live-session-picker');
    const page = document.getElementById('page-live');
    if (!page) return;

    const active = Object.entries(sessions).filter(([,s]) => s?.active && (s?.mapClean || s?.map));
    
    // Remove picker if 0 or 1 session
    if (active.length <= 1) {
      if (picker) picker.remove();
      return;
    }

    // Group by matchId, with fallback: group sessions that share players
    const byMatch = {};
    const assigned = new Set();

    active.forEach(([puuid, s]) => {
      if (assigned.has(puuid)) return;
      const mid = s.matchId || puuid;
      if (!byMatch[mid]) byMatch[mid] = [];
      byMatch[mid].push({ puuid, ...s });
      assigned.add(puuid);
    });

    // Merge sessions with overlapping players (same game, different matchId)
    const sessionPuuids = (s) => new Set((s.players||[]).map(p => p.puuid).filter(Boolean));
    const keys = Object.keys(byMatch);
    for (let i = 0; i < keys.length; i++) {
      for (let j = i + 1; j < keys.length; j++) {
        const groupA = byMatch[keys[i]];
        const groupB = byMatch[keys[j]];
        if (!groupA || !groupB) continue;
        // Check if any session in A shares players with any session in B
        const puuidsA = new Set(groupA.flatMap(s => [...sessionPuuids(s)]));
        const puuidsB = groupB.flatMap(s => [...sessionPuuids(s)]);
        const overlap = puuidsB.some(p => puuidsA.has(p));
        if (overlap || (groupA[0].matchId && groupA[0].matchId === groupB[0].matchId)) {
          byMatch[keys[i]] = [...groupA, ...groupB];
          delete byMatch[keys[j]];
        }
      }
    }

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

    picker.innerHTML = `
      <div style="font-family:Tomorrow,sans-serif;font-size:9px;letter-spacing:2px;color:var(--dim);text-transform:uppercase;margin-bottom:8px">Games en cours</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
      ${Object.entries(byMatch).map(([mid, players]) => {
        const first = players[0];
        const isSelected = players.some(p => p.puuid === renderSelected);
        const map = first.mapClean || first.map || '?';
        const names = players.length > 1
          ? players.map(p => p.playerName?.split('#')[0]).join(' & ')
          : first.playerName?.split('#')[0] || '?';
        const mode = first.mode || '';
        return `<button onclick="window._selectLiveSession('${players[0].puuid}')" style="
          font-family:Tomorrow,sans-serif;cursor:pointer;text-align:left;
          padding:10px 14px;border:1px solid ${isSelected ? 'var(--red)' : 'var(--border)'};
          background:${isSelected ? 'var(--red-low)' : 'var(--surf)'};
          transition:border-color .15s,background .15s;min-width:160px">
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
    const data = lastSessions[puuid] || null;
    if (data) updateUI(data);
  };

  async function loadMapImg(mapName) {
    if (mapName === lastMapName) return;
    lastMapName = mapName;
    try {
      const r = await fetch('https://valorant-api.com/v1/maps');
      const d = await r.json();
      const m = d.data?.find(m => m.displayName?.toLowerCase() === mapName?.toLowerCase()
        || m.mapUrl?.toLowerCase().includes(mapName?.toLowerCase()));
      const imgEl = document.getElementById('live-map-img');
      if (m?.splash && imgEl) imgEl.src = m.splash;
      else if (m?.displayIcon && imgEl) imgEl.src = m.displayIcon;
    } catch {}
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

    // Map — guard
    const mapName = data.mapClean || data.mapDisplay || data.map?.split('/')?.pop() || '—';
    const mapEl = document.getElementById('live-map-name');
    if (mapEl && mapEl.textContent !== mapName) {
      mapEl.textContent = mapName;
      loadMapImg(data.mapInternal || mapName);
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
    const isPregame = liveData?.phase === 'pregame' || liveData?.mode === 'agent-select';
    let compsEl = document.getElementById('live-comps-panel');
    if (isPregame && liveData?.mapClean) {
      if (!compsEl) {
        compsEl = document.createElement('div');
        compsEl.id = 'live-comps-panel';
        compsEl.style.cssText = 'margin:16px 0;display:flex;flex-direction:column;gap:8px';
        const livePage = document.getElementById('live-content');
        if (livePage) livePage.prepend(compsEl);
      }
      if (compsEl.dataset.map !== liveData.mapClean) {
        compsEl.dataset.map = liveData.mapClean;
        fetch('./data/comps.json').then(r=>r.json()).then(comps => {
          const mapData = comps.find(m => m.map === liveData.mapClean);
          if (!mapData) return;
          const show = ['S','PRO','FUN','F'].map(tier => mapData.comps.find(c => c.tier === tier || c.tierLabel === 'FUN')).filter(Boolean).slice(0,3);
          compsEl.innerHTML = `
            <div style="font-family:Tomorrow,sans-serif;font-size:9px;letter-spacing:3px;color:var(--dim);text-transform:uppercase;padding:4px 0">
              Agent Select — ${liveData.mapClean} — Comps recommandées
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
            ${show.map(c => `
              <div style="flex:1;min-width:200px;background:var(--surf);border:1px solid var(--border);padding:10px 12px">
                <div style="font-family:Tomorrow,sans-serif;font-size:8px;letter-spacing:2px;color:var(--muted);text-transform:uppercase;margin-bottom:6px">${c.tierLabel}</div>
                <div style="display:flex;gap:6px;align-items:center">
                  ${c.agents.map(a => `<img src="https://media.valorant-api.com/agents/${encodeURIComponent(a.toLowerCase())}/displayicon.png" style="width:28px;height:28px;object-fit:cover" title="${a}" onerror="this.style.display='none'">`).join('')}
                </div>
                <div style="font-family:Tomorrow,sans-serif;font-size:9px;color:var(--dim);margin-top:6px;letter-spacing:1px">${c.agents.join(' · ')}</div>
              </div>
            `).join('')}
            </div>`;
        }).catch(()=>{});
      }
    } else if (!isPregame && compsEl) {
      compsEl.remove();
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
    const isDM = allies.length === all.length || enemies.length === 0;

    // Stable key: only rebuild if player list (names+agents) actually changed
    const stableKey = all.map(p => `${p.name}|${p.agent}|${p.team}`).join(',');
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
    if (!rank?.rrEarned) return '';
    const v = rank.rrEarned;
    const color = v > 0 ? '#3fcf6b' : v < 0 ? '#ff4656' : '#888';
    const sign = v > 0 ? '+' : '';
    return `<span style="font-size:9px;font-family:Tomorrow,sans-serif;color:${color};letter-spacing:1px">${sign}${v} RR</span>`;
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
  fetch('https://valorant-api.com/v1/agents?isPlayableCharacter=true')
    .then(r=>r.json()).then(d=>{
      d.data?.forEach(a => { agentUuidMap[a.displayName] = a.uuid; });
    }).catch(()=>{});

  function agentIconUrl(agentName) {
    if (!agentName) return '';
    if (agentIconCache[agentName]) return agentIconCache[agentName];
    const uuid = agentUuidMap[agentName];
    if (uuid) {
      const url = `https://media.valorant-api.com/agents/${uuid}/displayicon.png`;
      agentIconCache[agentName] = url;
      return url;
    }
    return '';
  }

  function playerRow(p, myName) {
    const hpPct = (p.maxHp && p.hp !== undefined) ? Math.round((p.hp/p.maxHp)*100) : 100;
    const hpColor = hpPct > 60 ? '#3fcf6b' : hpPct > 30 ? '#f9c74f' : '#ff4656';
    const isMe = myName && p.name?.includes(myName.split('#')[0]);
    const imgUrl = agentIconUrl(p.agent);

    return `<div class="live-player-row ${p.alive===false ? 'dead' : ''} ${isMe ? 'me' : ''}">
      ${imgUrl ? `<img class="live-player-agent" src="${imgUrl}" onerror="this.style.visibility='hidden'">` : '<div class="live-player-agent" style="background:var(--surf3)"></div>'}
      <div style="flex:1;min-width:0">
        <div class="live-player-name" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
          ${p.incognito
            ? `<span style="opacity:.5;font-style:italic">${p.agent||'?'}</span> <span style="font-size:8px;letter-spacing:1px;color:#888;border:1px solid #333;padding:1px 4px">ANONYME</span>`
            : `${p.name || '—'} <span style="opacity:.4;font-size:9px;font-weight:400">${p.agent||''}</span>`
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

  return () => evtSource.close();
}
