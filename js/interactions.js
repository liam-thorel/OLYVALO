/**
 * OLYCITY · Interactions
 * 3D tilt, parallax, theme toggle, search, keyboard shortcuts.
 */

import { storage } from './storage.js?v=1779642952';
import { valorantApi } from './api.js?v=1779642952';
import { state } from './main.js?v=1779642952';

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
