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
  drawWheel(document.getElementById('logo-canvas-hero'), 300, 0.003, 0.12);
}
