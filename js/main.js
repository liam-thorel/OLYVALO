/**
 * OLYCITY · Main
 * Point d'entrée. Charge les données, orchestre les modules, expose window.OLYCITY.
 */

import { valorantApi } from './api.js';

const SITE_VERSION = '1780619210'; // Auto-updated on push
import { syncPlayer as henrikSyncPlayer, syncAllPlayers as henrikSyncAll, persistPlayerStats } from './henrik.js';
import { rosterHTML, guestCardHTML, mapSectionHTML, stierHTML, agentPageHTML, miniRosterHTML, agentsFiltersHTML, agentsGridHTML, compCompareHTML, compBuilderHTML, savedCompsHTML } from './render.js';
import { initTheme, initTilt, initParallax, initSearch, initKeyboard, updateFavCount, initHeroParticles, initWheelLogos, initLivePage } from './interactions.js';
import { storage } from './storage.js';

// ─── STATE ─────────────────────────────────────────
export const state = {
  COMPS_DATA: [],
  ROSTER: [],
  ROLES: {},
  ROLE_LABEL: {},
  ROLE_FULL: {},
  S_TIER: [],
  GLOBAL_NOTES: [],
  AGENT_FR: {},
  FAVS: [],
  PLAYER_STATS: {},
  currentAgentFilter: 'all',
  currentPage: 'home',
  compareSelections: [],
  builderSlots: [null,null,null,null,null],
  builderFocusSlot: 0,
  builderMapIdx: null,
  currentProfile: null,
  currentMapIdx: 0,
  builderMapIdx: null,
  LINEUPS: {},
  CALLOUTS: {},
  META: {},
  currentCompIdx: {},
};

// ─── LOAD JSON DATA ───────────────────────────────
async function loadData() {
  const [comps, roster, roles, agentsFr, lineups, callouts, meta] = await Promise.all([
    fetch('./data/comps.json').then(r => r.json()),
    fetch('./data/roster.json').then(r => r.json()),
    fetch('./data/roles.json').then(r => r.json()),
    fetch('./data/agents-fr.json').then(r => r.json()),
    fetch('./data/lineups.json').then(r => r.json()),
    fetch('./data/callouts.json').then(r => r.json()),
    fetch('./data/meta.json').then(r => r.json()),
  ]);

  state.COMPS_DATA = comps;
  state.ROSTER = roster;
  state.ROLES = roles.roles;
  state.ROLE_LABEL = { D: 'Duel', I: 'Init', S: 'Sent', C: 'Ctrl' };
  state.ROLE_FULL  = roles.labels;
  state.S_TIER = roles.sTier;
  state.GLOBAL_NOTES = roles.globalNotes;
  state.AGENT_FR = agentsFr;
  state.LINEUPS = lineups;
  state.CALLOUTS = callouts;
  state.META = meta;
  // Load custom players added at runtime
  try {
    const custom = JSON.parse(localStorage.getItem('olycity-custom-players') || '[]');
    custom.forEach(p => { if (!state.ROSTER.find(r => r.name === p.name)) state.ROSTER.push(p); });
  } catch(e) {}
  state.FAVS = storage.getFavs();
  state.PLAYER_STATS = storage.getPlayerStats();

  // Static mains from roster.json — not overridden by unreliable API topAgents
  state.ROSTER.forEach(p => {
    if (!Array.isArray(p.mains)) p.mains = [];
  });
}

// ─── SYNC HELPERS ─────────────────────────────────
function setBtnState(playerName, cls, label) {
  const btn = document.querySelector(`.player-sync-btn[data-player="${playerName}"]`);
  if (!btn) return;
  btn.classList.remove('syncing', 'error', 'synced');
  if (cls) btn.classList.add(cls);
  const spin = cls === 'syncing' ? '<span class="sync-spin">↻</span>' : (cls === 'synced' ? '✓' : cls === 'error' ? '✕' : '↻');
  btn.innerHTML = `${spin} ${label}`;
}

function setSyncStatus(html, type = 'info') {
  const el = document.getElementById('sync-status');
  if (!el) return;
  if (!html) { el.innerHTML = ''; return; }
  const icon = type === 'error' ? 'Erreur' : type === 'success' ? 'OK' : 'Info';
  el.innerHTML = `<div class="sync-banner ${type}">
    <span class="sync-banner-icon">${icon}</span>
    ${html}
  </div>`;
}

// ─── WINDOW.OLYCITY — handlers inline HTML ─────────
window.OLYCITY = {

  nav(page, pushHistory = true) {
    // Dynamic title
    const titles = {
      home: 'OLYCITY — Accueil',
      maps: 'OLYCITY — Maps & Comps',
      roster: 'OLYCITY — Roster',
      agents: 'OLYCITY — Agents',
      builder: 'OLYCITY — Comp Builder',
    };
    document.title = titles[page] || 'OLYCITY — Valorant Meta Comps';
    // Close agent page if open
    const agentPage = document.getElementById('agent-page');
    if (agentPage && agentPage.classList.contains('active')) {
      agentPage.classList.remove('active');
      agentPage.innerHTML = '';
      document.body.classList.remove('agent-mode');
    }
    // Hide all pages
    document.querySelectorAll('.spa-page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.page-nav-btn').forEach(b => b.classList.remove('active'));

    // Show target page
    const pageEl = document.getElementById(`page-${page}`);
    if (pageEl) pageEl.classList.add('active');
    // Lazy render builder
    if (page === 'builder') {
      window.OLYCITY._renderBuilder();
    }
    if (page === 'live') {
      if (!window._liveCleanup) {
        window._liveCleanup = initLivePage();
      }
    }
    const navBtn = document.querySelector(`.page-nav-btn[data-page="${page}"]`);
    if (navBtn) navBtn.classList.add('active');

    // Show/hide map nav



    window.scrollTo({ top: 0, behavior: 'smooth' });
    state.currentPage = page;

    // Push to browser history
    if (pushHistory) {
      const url = page === 'home' ? window.location.pathname : `${window.location.pathname}#${page}`;
      window.history.pushState({ page }, '', url);
    }

    // Re-init tilt on map page
    if (page === 'maps') {
      setTimeout(() => initTilt(), 100);
      const al = document.getElementById('map-arrow-left');
      const ar = document.getElementById('map-arrow-right');
      const total = state.COMPS_DATA.length;
      const mi = state.currentMapIdx || 0;
      if (al) { al.style.display = 'flex'; al.disabled = mi === 0; al.style.opacity = mi === 0 ? '0.3' : '1'; }
      if (ar) { ar.style.display = 'flex'; ar.disabled = mi === total-1; ar.style.opacity = mi === total-1 ? '0.3' : '1'; }
    }
    // Update mini roster on home
    if (page === 'home') {
      const el = document.getElementById('mini-roster');
      if (el) el.innerHTML = miniRosterHTML();
      setTimeout(() => initHeroParticles(), 50);
    }
  },


  showMap(idx, btn) {
    state.currentMapIdx = idx;
    document.querySelectorAll('.map-section').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.nav-map-btn').forEach(b => b.classList.remove('active'));
    const section = document.getElementById(`map-${idx}`);
    if (section) section.classList.add('active');
    if (btn) btn.classList.add('active');

    setTimeout(() => initTilt(), 50);
  },

  switchComp(mapIdx, compIdx, btn) {
    state.currentCompIdx[mapIdx] = compIdx;
    const _lp = document.getElementById(`maptab-${mapIdx}-lineups`);
    if (_lp?.classList.contains('active')) window.OLYCITY._refreshLineupTabs(mapIdx);
    document.querySelectorAll(`#map-${mapIdx} .comp-panel`).forEach(p => p.classList.remove('active'));
    document.querySelectorAll(`#map-${mapIdx} .comp-tab`).forEach(b => b.classList.remove('active'));
    const panel = document.getElementById(`panel-${mapIdx}-${compIdx}`);
    if (panel) panel.classList.add('active');
    if (btn) btn.classList.add('active');
    setTimeout(() => initTilt(), 50);
  },

  toggleFav(cid) {
    const idx = state.FAVS.indexOf(cid);
    if (idx >= 0) state.FAVS.splice(idx, 1);
    else state.FAVS.push(cid);
    storage.setFavs(state.FAVS);
    document.querySelectorAll(`.fav-btn[data-fav="${cid}"]`).forEach(btn => {
      btn.classList.toggle('active', state.FAVS.includes(cid));
    });
    updateFavCount();
  },

  showAgentPage(name) {
    // Push agent page to history so back button works
    window.history.pushState({ page: 'agent', agent: name }, '', `${window.location.pathname}#agent-${encodeURIComponent(name)}`);
    const page = document.getElementById('agent-page');
    if (!page) return;
    page.innerHTML = agentPageHTML(name);
    page.classList.add('active');
    document.body.classList.add('agent-mode');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setTimeout(() => initTilt(), 100);
  },

  closeAgentPage() {
    const page = document.getElementById('agent-page');
    if (page) { page.classList.remove('active'); page.innerHTML = ''; }
    document.body.classList.remove('agent-mode');
    // Restore current SPA page visibility
    const curPage = state.currentPage || 'home';
    document.querySelectorAll('.spa-page').forEach(p => p.classList.remove('active'));
    const curEl = document.getElementById(`page-${curPage}`);
    if (curEl) curEl.classList.add('active');
    // Go back in history
    window.history.back();
  },

  goToComp(mapIdx, compIdx) {
    window.OLYCITY.closeAgentPage();
    setTimeout(() => {
      const mapBtn = document.querySelector(`[data-map-idx="${mapIdx}"]`);
      window.OLYCITY.showMap(mapIdx, mapBtn);
      const tabBtns = document.querySelectorAll(`#map-${mapIdx} .comp-tab`);
      if (tabBtns[compIdx]) window.OLYCITY.switchComp(mapIdx, compIdx, tabBtns[compIdx]);
      document.getElementById('roster')?.scrollIntoView({ behavior: 'smooth' });
    }, 100);
  },

  // ─── SHARE COMP ──────────────────────────────
  shareComp(mapIdx, compIdx, btn) {
    const hash = `comp-${mapIdx}-${compIdx}`;
    const url = `${window.location.origin}${window.location.pathname}#${hash}`;
    navigator.clipboard.writeText(url).then(() => {
      if (btn) {
        btn.textContent = '✓ Copié !';
        btn.classList.add('copied');
        setTimeout(() => { btn.innerHTML = '↗ Partager'; btn.classList.remove('copied'); }, 2000);
      }
    }).catch(() => {
      prompt('Copie ce lien :', url);
    });
  },

  // ─── COMPARE COMP ────────────────────────────
  selectCompare(mapIdx, compIdx, btn) {
    const existing = state.compareSelections.findIndex(s => s.mapIdx === mapIdx && s.compIdx === compIdx);
    if (existing >= 0) {
      state.compareSelections.splice(existing, 1);
      if (btn) btn.classList.remove('selected');
    } else {
      if (state.compareSelections.length >= 2) {
        // Reset old selection
        document.querySelectorAll('.compare-btn.selected').forEach(b => b.classList.remove('selected'));
        state.compareSelections = [];
      }
      state.compareSelections.push({ mapIdx, compIdx });
      if (btn) btn.classList.add('selected');
    }
    if (state.compareSelections.length === 2) {
      const [a, b] = state.compareSelections;
      const compA = state.COMPS_DATA[a.mapIdx].comps[a.compIdx];
      const compB = state.COMPS_DATA[b.mapIdx].comps[b.compIdx];
      const wrap = document.getElementById('compare-panel-wrap');
      const inner = document.getElementById('compare-panel-content');
      if (wrap && inner) {
        inner.innerHTML = compCompareHTML(compA, compB);
        wrap.style.display = 'block';
        wrap.scrollTo(0, 0);
      }
    }
  },

  closeCompare() {
    const wrap = document.getElementById('compare-panel-wrap');
    if (wrap) wrap.style.display = 'none';
    document.querySelectorAll('.compare-btn.selected').forEach(b => b.classList.remove('selected'));
    state.compareSelections = [];
  },

  // ─── COMP BUILDER ────────────────────────────
  _renderBuilder(profile) {
    const wrap = document.getElementById('comp-builder-wrap');
    const p = profile || state.currentProfile || 'guest';
    if (wrap) wrap.innerHTML = compBuilderHTML(state.builderSlots) + savedCompsHTML(p);
  },

  builderFocusSlot(i) {
    state.builderFocusSlot = i;
    document.querySelectorAll('.comp-builder-slot').forEach((el, idx) => {
      el.style.borderColor = idx === i ? 'var(--red)' : '';
    });
  },

  builderAddAgent(name) {
    const slot = state.builderFocusSlot;
    if (state.builderSlots[slot] === null || state.builderSlots[slot] !== name) {
      state.builderSlots[slot] = name;
      const next = state.builderSlots.findIndex((s, i) => i > slot && s === null);
      state.builderFocusSlot = next >= 0 ? next : slot;
    }
    localStorage.setItem('olycity-builder', JSON.stringify(state.builderSlots));
    window.OLYCITY._updateBuilderSlots();
  },

  builderRemove(i) {
    state.builderSlots[i] = null;
    state.builderFocusSlot = i;
    localStorage.setItem('olycity-builder', JSON.stringify(state.builderSlots));
    window.OLYCITY._updateBuilderSlots();
  },

  builderClear() {
    state.builderSlots = [null,null,null,null,null];
    state.builderFocusSlot = 0;
    localStorage.removeItem('olycity-builder');
    window.OLYCITY._renderBuilder(state.currentProfile);
  },

  // Partial update: only slots + used markers, no full re-render
  _updateBuilderSlots() {
    const { compBuilderSlotsHTML, compBuilderAgilityHTML } = window._builderPartials || {};
    if (!compBuilderSlotsHTML) {
      // Fallback: full re-render if partials not available
      window.OLYCITY._renderBuilder(state.currentProfile);
      return;
    }
    // Update slots
    const slotsEl = document.getElementById('builder-slots-wrap');
    if (slotsEl) slotsEl.innerHTML = compBuilderSlotsHTML(state.builderSlots);
    // Update agility
    const agilEl = document.getElementById('builder-agility-wrap');
    if (agilEl) agilEl.innerHTML = compBuilderAgilityHTML(state.builderSlots);
    // Update used markers on agent grid
    const usedSet = new Set(state.builderSlots.filter(Boolean));
    document.querySelectorAll('.comp-builder-agent[data-agent]').forEach(el => {
      el.classList.toggle('used', usedSet.has(el.dataset.agent));
    });
  },

  builderSetMap(mapIdx) {
    state.builderMapIdx = mapIdx !== '' ? +mapIdx : null;
    // Update context label
    const ctx = document.getElementById('builder-map-context');
    if (ctx && mapIdx !== '') {
      const m = state.COMPS_DATA[+mapIdx];
      ctx.textContent = m ? `${m.stats.difficulty} · ${m.stats.sides}` : '';
    } else if (ctx) ctx.textContent = '';
  },

  savedCompCompare(i) {
    try {
      const saved = JSON.parse(localStorage.getItem(`olycity-saved-comps-${state.currentProfile||'guest'}`) || '[]');
      if (!saved[i]) return;
      const comp = saved[i];
      const roleScores = {
        D:{antiRush:2,postPlant:2,retake:3,split:4},
        I:{antiRush:4,postPlant:3,retake:3,split:3},
        S:{antiRush:4,postPlant:4,retake:2,split:2},
        C:{antiRush:3,postPlant:5,retake:3,split:3},
      };
      const keys = ['antiRush','postPlant','retake','split'];
      const agility = {};
      keys.forEach(k => {
        let total = 0;
        (comp.agents||[]).forEach(a => { total += (roleScores[state.ROLES[a]||'D']?.[k]||3); });
        agility[k] = comp.agents.length > 0 ? Math.min(5, Math.round(total/comp.agents.length)) : 0;
      });
      const savedComp = {
        label: comp.name, tierLabel: 'CUSTOM', tier: 'X',
        agents: comp.agents, winrate: 0,
        tip: 'Comp sauvegardée depuis le Builder OLYCITY', agility,
      };
      // Open picker to choose what to compare against
      window.OLYCITY._compareAgainst = savedComp;
      const list = document.getElementById('builder-compare-list');
      if (list) {
        list.innerHTML = state.COMPS_DATA.flatMap((mapData, mi) =>
          mapData.comps.filter(c => c.tier !== 'F').map((metaComp, ci) => {
            const tierCls = metaComp.tier === 'S' ? 'tier-s' : 'tier-a';
            const agentImgs = metaComp.agents.slice(0,5).map(a => {
              const img = valorantApi.agentImg(a);
              return img ? `<img src="${img}" style="width:28px;height:36px;object-fit:cover;object-position:top center;border:1px solid var(--border)">` : '';
            }).join('');
            return `<div style="display:flex;align-items:center;gap:12px;padding:10px 14px;background:var(--surf2);border:1px solid var(--border);cursor:pointer;transition:border-color .15s"
              onmouseover="this.style.borderColor='var(--gold)'" onmouseout="this.style.borderColor='var(--border)'"
              onclick="window.OLYCITY._runSavedCompare(${mi},${ci})">
              <span style="font-family:Tomorrow,sans-serif;font-size:9px;letter-spacing:1px;color:var(--muted);min-width:52px">${mapData.map}</span>
              <span class="comp-tier ${tierCls}" style="font-size:8px;padding:1px 6px">${metaComp.tierLabel}</span>
              <span style="font-family:Tomorrow,sans-serif;font-size:11px;font-weight:600;color:var(--text);flex:1">${metaComp.label}</span>
              <div style="display:flex;gap:3px">${agentImgs}</div>
            </div>`;
          })
        ).join('');
      }
      document.getElementById('builder-compare-modal').style.display = 'block';
    } catch(e) { console.error(e); }
  },

  _runSavedCompare(mapIdx, compIdx) {
    document.getElementById('builder-compare-modal').style.display = 'none';
    const metaComp = state.COMPS_DATA[mapIdx]?.comps[compIdx];
    const savedComp = window.OLYCITY._compareAgainst;
    if (!metaComp || !savedComp) return;
    const wrap = document.getElementById('compare-panel-wrap');
    const inner = document.getElementById('compare-panel-content');
    if (wrap && inner) {
      inner.innerHTML = compCompareHTML(savedComp, metaComp);
      wrap.style.display = 'block';
      wrap.scrollTo(0, 0);
    }
  },

  builderLoad(i) {
    try {
      const saved = JSON.parse(localStorage.getItem(`olycity-saved-comps-${state.currentProfile||'guest'}`) || '[]');
      if (saved[i]) {
        const agents = saved[i].agents || [];
        state.builderSlots = [...agents.slice(0,5), ...Array(5).fill(null)].slice(0,5);
        state.builderFocusSlot = 0;
        window.OLYCITY._renderBuilder();
      }
    } catch(e) {}
  },

  savedCompDelete(i) {
    try {
      const saved = JSON.parse(localStorage.getItem(`olycity-saved-comps-${state.currentProfile||'guest'}`) || '[]');
      saved.splice(i, 1);
      localStorage.setItem(`olycity-saved-comps-${state.currentProfile||'guest'}`, JSON.stringify(saved));
      window.OLYCITY._renderBuilder();
    } catch(e) {}
  },

  builderSave() {
    const filled = state.builderSlots.filter(Boolean);
    if (filled.length < 2) { alert('Ajoute au moins 2 agents avant de sauvegarder.'); return; }
    const name = prompt('Nom de cette comp :', 'Ma Comp Custom');
    if (!name) return;
    const key = `olycity-saved-comps-${state.currentProfile||'guest'}`;
    const saved = JSON.parse(localStorage.getItem(key) || '[]');
    saved.push({ name, agents: filled, map: state.builderMapIdx != null ? state.COMPS_DATA[state.builderMapIdx]?.map : null, createdAt: Date.now() });
    localStorage.setItem(key, JSON.stringify(saved));
    window.OLYCITY._renderBuilder(state.currentProfile);
  },

  _refreshLineupTabs(mapIdx) {
    const mapName = state.COMPS_DATA[mapIdx]?.map;
    if (!mapName) return;
    const compIdx = state.currentCompIdx[mapIdx] ?? 0;
    const comp = state.COMPS_DATA[mapIdx]?.comps[compIdx];
    const compAgents = comp?.agents || [];
    const mapLineups = state.LINEUPS[mapName] || {};
    const lineupAgents = Object.keys(mapLineups);

    // Find agents that are both in current comp AND have lineups
    const relevantAgents = compAgents.filter(a => lineupAgents.includes(a));
    const showAgents = relevantAgents.length > 0 ? relevantAgents : lineupAgents;

    document.querySelectorAll(`.lineup-agent-tab[data-map="${mapName}"]`).forEach(tab => {
      const agent = tab.dataset.agent;
      tab.style.display = showAgents.includes(agent) ? '' : 'none';
    });

    // Auto-select first visible agent
    const firstVisible = showAgents.find(a => lineupAgents.includes(a));
    if (firstVisible) {
      const tabEl = document.querySelector(`.lineup-agent-tab[data-map="${mapName}"][data-agent="${firstVisible}"]`);
      window.OLYCITY.switchLineupAgent(mapName, firstVisible, tabEl);
    }
  },

  builderSetMap(idx) {
    state.builderMapIdx = idx !== '' ? +idx : null;
    const ctx = document.getElementById('builder-map-context');
    if (ctx && idx !== '') {
      const m = state.COMPS_DATA[+idx];
      ctx.textContent = m ? `${m.stats.difficulty} · ${m.stats.sides}` : '';
    } else if (ctx) ctx.textContent = '';
  },

  builderCompare() {
    const filled = state.builderSlots.filter(Boolean);
    if (filled.length < 2) return;

    // Build picker list of all meta comps
    const list = document.getElementById('builder-compare-list');
    if (!list) return;

    list.innerHTML = state.COMPS_DATA.flatMap((mapData, mi) =>
      mapData.comps
        .filter(c => c.tier !== 'F')
        .map((comp, ci) => {
          const tierCls = comp.tier === 'S' ? 'tier-s' : 'tier-a';
          const agentImgs = comp.agents.slice(0,5).map(a => {
            const img = valorantApi.agentImg(a);
            return img ? `<img src="${img}" style="width:28px;height:36px;object-fit:cover;object-position:top center;border:1px solid var(--border)">` : '';
          }).join('');
          return `<div style="display:flex;align-items:center;gap:12px;padding:10px 14px;background:var(--surf2);border:1px solid var(--border);cursor:pointer;transition:border-color .15s"
            onmouseover="this.style.borderColor='var(--gold)'" onmouseout="this.style.borderColor='var(--border)'"
            onclick="window.OLYCITY.builderCompareWith(${mi},${ci})">
            <span style="font-family:Tomorrow,sans-serif;font-size:9px;letter-spacing:1px;color:var(--muted);min-width:52px">${mapData.map}</span>
            <span class="comp-tier ${tierCls}" style="font-size:8px;padding:1px 6px">${comp.tierLabel}</span>
            <span style="font-family:Tomorrow,sans-serif;font-size:11px;font-weight:600;color:var(--text);flex:1">${comp.label}</span>
            <div style="display:flex;gap:3px">${agentImgs}</div>
          </div>`;
        })
    ).join('');

    document.getElementById('builder-compare-modal').style.display = 'block';
  },

  builderCompareWith(mapIdx, compIdx) {
    document.getElementById('builder-compare-modal').style.display = 'none';
    const metaComp = state.COMPS_DATA[mapIdx]?.comps[compIdx];
    if (!metaComp) return;

    const filled = state.builderSlots.filter(Boolean);
    const builderComp = {
      label: 'Ma Comp Builder',
      tierLabel: 'CUSTOM',
      tier: 'X',
      agents: filled,
      winrate: 0,
      tip: 'Comp créée dans le Builder OLYCITY',
      agility: (() => {
        const roleScores = {
          D: { antiRush:2, postPlant:2, retake:3, split:4 },
          I: { antiRush:4, postPlant:3, retake:3, split:3 },
          S: { antiRush:4, postPlant:4, retake:2, split:2 },
          C: { antiRush:3, postPlant:5, retake:3, split:3 },
        };
        const keys = ['antiRush','postPlant','retake','split'];
        const result = {};
        keys.forEach(k => {
          let total = 0;
          filled.forEach(a => { total += (roleScores[state.ROLES[a]||'D']?.[k] || 3); });
          result[k] = filled.length > 0 ? Math.min(5, Math.round(total/filled.length)) : 0;
        });
        return result;
      })(),
    };

    const wrap = document.getElementById('compare-panel-wrap');
    const inner = document.getElementById('compare-panel-content');
    if (wrap && inner) {
      inner.innerHTML = compCompareHTML(builderComp, metaComp);
      wrap.style.display = 'block';
      wrap.scrollTo(0, 0);
    }
  },

  openLineupCard(el) {
    const vid   = el.dataset.vid;
    const start = parseInt(el.dataset.start) || 0;
    const name  = el.dataset.name;
    const type  = el.dataset.type;
    const diff  = el.dataset.diff;
    const desc  = el.dataset.desc;
    window.OLYCITY.openVideoModal(vid, start, name, type, diff, desc);
  },

  openVideoModal(videoId, start, name, type, diff, desc) {
    const modal = document.getElementById('video-modal');
    const frame = document.getElementById('video-modal-frame');
    const title = document.getElementById('video-modal-title');
    const descEl = document.getElementById('video-modal-desc');
    if (!modal || !frame) return;

    const src = 'https://www.youtube.com/embed/' + videoId
      + '?start=' + (start || 0)
      + '&autoplay=1&mute=0&rel=0&modestbranding=1&controls=1';

    title.innerHTML = `<span style="color:var(--text)">${name}</span>
      <span class="lineup-type-badge ${type}" style="font-size:9px">${type}</span>
      <span class="lineup-diff-badge" style="font-size:9px">${diff}</span>`;
    frame.innerHTML = `<iframe src="${src}" allow="autoplay; encrypted-media" style="position:absolute;inset:0;width:100%;height:100%;border:none" title="${name}"></iframe>`;
    descEl.textContent = desc;
    modal.style.display = 'block';
    document.body.style.overflow = 'hidden';
  },

  closeVideoModal(e) {
    if (e && e.target !== e.currentTarget) return;
    const modal = document.getElementById('video-modal');
    const frame = document.getElementById('video-modal-frame');
    if (modal) modal.style.display = 'none';
    if (frame) frame.innerHTML = '';
    document.body.style.overflow = '';
  },

  switchMapTab(mapIdx, tab, btn) {
    // Init draw board on first open
    if (tab === 'draw') {
      const boardEl = document.getElementById(`draw-board-${mapIdx}`);
      if (boardEl && !boardEl.hasChildNodes()) {
        const mapName = state.COMPS_DATA[mapIdx]?.map;
        if (mapName) {
          import('./firebase-draw.js').then(m => m.initDrawBoard(mapName, boardEl));
        }
      }
    }
    const prefix = `maptab-${mapIdx}-`;
    document.querySelectorAll(`[id^="${prefix}"]`).forEach(el => el.classList.remove('active'));
    document.querySelectorAll(`#map-${mapIdx} .map-section-tab`).forEach(b => b.classList.remove('active'));
    const panel = document.getElementById(`${prefix}${tab}`);
    if (panel) panel.classList.add('active');
    if (btn) btn.classList.add('active');
    if (tab === 'comps') setTimeout(() => initTilt(), 50);
    if (tab === 'lineups') setTimeout(() => window.OLYCITY._refreshLineupTabs(mapIdx), 50);
  },

  goToLineups(mapIdx, agentName) {
    window.OLYCITY.closeAgentPage();
    setTimeout(() => {
      window.OLYCITY.nav('maps');
      const mapBtn = document.querySelector(`[data-map-idx="${mapIdx}"]`);
      window.OLYCITY.showMap(mapIdx, mapBtn);
      // Switch to lineups tab
      const lineupsTabBtn = document.querySelector(`#map-${mapIdx} .map-section-tab:nth-child(3)`);
      window.OLYCITY.switchMapTab(mapIdx, 'lineups', lineupsTabBtn);
      // Switch to the right agent
      setTimeout(() => {
        const agentTab = document.querySelector(`[data-map="${state.COMPS_DATA[mapIdx]?.map}"][data-agent="${agentName}"]`);
        if (agentTab) {
          window.OLYCITY.switchLineupAgent(state.COMPS_DATA[mapIdx]?.map, agentName, agentTab);
        }
      }, 100);
    }, 50);
  },

  switchLineupAgent(mapName, agent, btn) {
    // Switch active tab
    document.querySelectorAll(`.lineup-agent-tab[data-map="${mapName}"]`)
      .forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    // Show/hide agent cards
    document.querySelectorAll(`[data-lineup-map="${mapName}"]`).forEach(el => {
      el.classList.toggle('hidden', el.dataset.lineupAgent !== agent);
    });
  },

  guestOpen(site, event) {
    const name = document.getElementById('guest-name')?.value.trim();
    const tag  = document.getElementById('guest-tag')?.value.trim();
    if (!name || !tag) { event?.preventDefault(); return false; }
    const encoded = encodeURIComponent(name);
    const url = site === 'tracker'
      ? `https://tracker.gg/valorant/profile/riot/${encoded}%23${tag}/overview`
      : `https://valorant.op.gg/profile/${encoded}-${encodeURIComponent(tag)}`;
    window.open(url, '_blank');
    event?.preventDefault();
    return false;
  },

  showAddPlayerForm() {
    document.getElementById('add-player-modal').classList.add('open');
    setTimeout(() => document.getElementById('ap-name')?.focus(), 50);
  },

  hideAddPlayerForm() {
    document.getElementById('add-player-modal').classList.remove('open');
    ['ap-name','ap-riot-name','ap-mains','ap-avatar'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
  },

  submitAddPlayer() {
    const name = document.getElementById('ap-name')?.value.trim();
    if (!name) { alert('Le nom est obligatoire.'); return; }

    const riotRaw = document.getElementById('ap-riot-name')?.value.trim();
    const riotParts = riotRaw?.split('#');
    const riot = riotParts?.length === 2
      ? { name: riotParts[0].trim(), tag: riotParts[1].trim(), region: 'eu' }
      : null;

    const role = document.getElementById('ap-role')?.value || 'Fill';
    const mainsRaw = document.getElementById('ap-mains')?.value || '';
    const mains = mainsRaw.split(',').map(s => s.trim()).filter(Boolean);
    const avatar = document.getElementById('ap-avatar')?.value.trim() || null;

    const player = { name, tag: name, role, mains, riot, avatar };
    state.ROSTER.push(player);

    // Persist in localStorage
    const custom = JSON.parse(localStorage.getItem('olycity-custom-players') || '[]');
    custom.push(player);
    localStorage.setItem('olycity-custom-players', JSON.stringify(custom));

    window.OLYCITY.hideAddPlayerForm();
    document.getElementById('roster-grid').innerHTML = rosterHTML() + guestCardHTML();
    window.OLYCITY._showProfilePicker(); // refresh picker with new player
  },

  toggleAudio() {
    const audio = document.getElementById('site-audio');
    const btn = document.getElementById('audio-toggle');
    if (!audio) { console.error('audio element not found'); return; }
    if (audio.paused) {
      audio.volume = (document.getElementById('audio-vol')?.value || 30) / 100;
      audio.play().then(() => {
        if (btn) btn.innerHTML = '⏸';
      }).catch(() => {});
    } else {
      audio.pause();
      if (btn) btn.innerHTML = '▶';
    }
  },

  setVolume(val) {
    const audio = document.getElementById('site-audio');
    if (audio) audio.volume = val / 100;
  },

  _showProfilePicker() {
    // Toujours rebuild pour avoir les données Firebase fraîches
    const old = document.getElementById('profile-picker');
    if (old) old.remove();
    let picker = null;
    const needsBuild = true;
    if (true) {
      picker = document.createElement('div');
      picker.id = 'profile-picker';
      Object.assign(picker.style, {
        position:'fixed', inset:'0', zIndex:'8000',
        background:'#0a0c10', display:'flex',
        flexDirection:'column', alignItems:'center',
        justifyContent:'center', gap:'40px'
      });
      document.body.appendChild(picker);
    }
    const profiles = [
      ...state.ROSTER,
      { name: 'Guest', tag: 'Visiteur', role: 'Fill', mains: [], avatar: null }
    ];
    picker.innerHTML = `
      <h1 style="font-family:'Tomorrow',sans-serif;font-size:28px;font-weight:700;letter-spacing:6px;text-transform:uppercase;color:#fff">Qui joue ?</h1>
      <div style="display:flex;gap:20px;flex-wrap:wrap;justify-content:center;max-width:800px">
        ${profiles.map(p => {
          const discordImg = p.avatar;
          const agentImg = valorantApi.agentImg(p.mains?.[0]);
          const imgSrc = discordImg || agentImg;
          const imgEl = imgSrc
            ? `<img src="${imgSrc}" style="width:100%;height:100%;object-fit:cover;object-position:center top">`
            : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-family:Tomorrow,sans-serif;font-size:28px;font-weight:700;color:rgba(255,255,255,.3)">${p.name[0]}</div>`;
          const savedCount = JSON.parse(localStorage.getItem(`olycity-saved-comps-${p.name}`) || '[]').length;
          const badge = savedCount > 0 ? `<span style="position:absolute;bottom:4px;right:4px;background:#ff4656;color:#fff;font-family:Tomorrow,sans-serif;font-size:8px;font-weight:700;letter-spacing:1px;padding:2px 5px">${savedCount}</span>` : '';
          const currentProfile = localStorage.getItem('olycity-profile');
          const isActive = window._activeProfiles?.has(p.name) && p.name !== currentProfile;
          const activeLabel = isActive ? `<div style="position:absolute;top:6px;right:6px;width:10px;height:10px;border-radius:50%;background:#3fcf6b;border:2px solid #0a0c10;box-shadow:0 0 6px rgba(63,207,107,.7)"></div>` : '';
          return `<div class="profile-card" onclick="${isActive ? '' : `window.OLYCITY._selectProfile('${p.name}')`}" style="${isActive ? 'opacity:0.5;cursor:not-allowed;filter:grayscale(.3)' : ''}">
            <div class="profile-avatar" style="position:relative">${imgEl}${badge}</div>
            <div class="profile-name">${p.name}</div>
            <div class="profile-role">${p.tag || p.role || ''}</div>
          </div>`;
        }).join('')}
      </div>
      <div style="font-family:'Tomorrow',sans-serif;font-size:10px;letter-spacing:2px;text-transform:uppercase;color:rgba(255,255,255,.25)">Ton profil sauvegarde tes comps custom</div>
    `;
    // Always show (whether freshly created or existing)
    picker.style.display = 'flex';
    picker.style.opacity = '1';
    picker.style.transition = '';
  },

  _refreshPickerDots() {
    const picker = document.getElementById('profile-picker');
    if (picker && picker.style.display !== 'none' && picker.style.opacity !== '0') {
      window.OLYCITY._showProfilePicker();
    }
  },

  _selectProfile(name) {
    localStorage.setItem('olycity-profile', name);
    const picker = document.getElementById('profile-picker');
    if (picker) { picker.style.opacity = '0'; picker.style.transition = 'opacity .3s'; }
    setTimeout(() => location.reload(), 300);
  },

  _applyProfileIndicator(name) {
    const el = document.getElementById('profile-indicator');
    if (!el) return;
    const player = state.ROSTER.find(p => p.name === name);
    const img = player?.avatar
      ? `<img src="${player.avatar}" style="width:22px;height:22px;object-fit:cover;object-position:center top;border-radius:1px">`
      : '';
    el.innerHTML = `${img}<span class="profile-indicator-name">${name}</span>`;
  },

  filterAgents(role, btn) {
    // Update active button
    document.querySelectorAll('.agent-filter-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    state.currentAgentFilter = role;
    const search = document.getElementById('agents-search-input')?.value || '';
    document.getElementById('agents-full-grid').innerHTML = agentsGridHTML(role, search);
    setTimeout(() => initTilt(), 50);
  },

  async syncPlayer(playerName) {
    const player = state.ROSTER.find(p => p.name === playerName);
    if (!player) return;
    setBtnState(playerName, 'syncing', 'Sync en cours…');
    try {
      const stats = await henrikSyncPlayer(player);
      state.PLAYER_STATS[playerName] = stats;
      persistPlayerStats(playerName, stats);

      // Static mains preserved — HenrikDev only gives 10 matches, not enough for reliable top agents
      document.getElementById('roster-grid').innerHTML = rosterHTML() + guestCardHTML();
  // Guest card Enter key listener (re-attach after render)
  setTimeout(() => {
    const gn = document.getElementById('guest-name');
    const gt = document.getElementById('guest-tag');
    [gn, gt].forEach(el => el?.addEventListener('keydown', e => {
      if (e.key === 'Enter') window.OLYCITY.guestOpen('tracker', e);
    }));
  }, 50);
      setBtnState(playerName, 'synced', 'Synced ✓');
    } catch (e) {
      const msgs = {
        AUTH_REQUIRED: 'Clé invalide',
        COMPTE_PRIVE: 'Compte privé Riot',
        RATE_LIMIT: 'Rate limit — attends 1min',
        NOT_FOUND: 'Compte privé ou introuvable',
        NETWORK: 'Pas de réseau',
        NO_RIOT_ID: 'Pas de Riot ID',
      };
      setBtnState(playerName, 'error', msgs[e.message] || ('Err: ' + e.message));
      console.error('[OLYCITY] Sync error for', playerName, e.message);
    }
  },

  async syncAllPlayers() {
    const btn = document.getElementById('sync-all-btn');
    if (!btn) return;
    btn.classList.add('syncing');
    btn.innerHTML = `<span class="sync-spin">↻</span> Sync en cours…`;
    setSyncStatus('Synchronisation en cours… (1 joueur / 1.5s)', 'info');

    const result = await henrikSyncAll(state.ROSTER, {
      onPlayerSynced(playerName, stats) {
        state.PLAYER_STATS[playerName] = stats;
        persistPlayerStats(playerName, stats);
        const player = state.ROSTER.find(p => p.name === playerName);
        // Static mains preserved
        document.getElementById('roster-grid').innerHTML = rosterHTML() + guestCardHTML();
      },
      onPlayerError(playerName, msg) {
        setBtnState(playerName, 'error', msg === 'NOT_FOUND' ? 'Introuvable' : 'Erreur');
      },
    });

    btn.classList.remove('syncing');
    btn.innerHTML = `<span class="sync-spin">↻</span> Sync tout`;

    if (result.halted && result.haltReason === 'AUTH_REQUIRED') {
      setSyncStatus(`Clé API refusée. Régénère-en une sur <a href="https://api.henrikdev.xyz/dashboard" target="_blank">api.henrikdev.xyz</a>.`, 'error');
    } else if (result.halted && result.haltReason === 'RATE_LIMIT') {
      setSyncStatus(`Rate limit atteint après ${result.successCount} joueur(s). Attends 30s.`, 'error');
    } else if (result.successCount === state.ROSTER.filter(p => p.riot).length) {
      setSyncStatus(`<strong>${result.successCount}</strong> joueurs synchronisés — rank, WR, agents joués.`, 'success');
      setTimeout(() => setSyncStatus(''), 8000);
    } else {
      setSyncStatus(`${result.successCount} synchronisés, ${result.errors.length} erreurs.`, 'info');
    }
  },
};

// ─── RENDER ───────────────────────────────────────
function renderAll() {
  // Populate hover dropdown
  const mapsMenu = document.getElementById('nav-maps-menu');
  if (mapsMenu) {
    mapsMenu.innerHTML = state.COMPS_DATA.map((m, i) => {
      const icon = valorantApi.mapIcon(m.map);
      return `<button class="nav-maps-menu-item" data-map-idx="${i}">
        ${icon ? `<img src="${icon}" alt="${m.map}">` : ''}
        ${m.map}
      </button>`;
    }).join('');
    mapsMenu.querySelectorAll('.nav-maps-menu-item').forEach(btn => {
      btn.addEventListener('click', () => {
        const mi = +btn.dataset.mapIdx;
        document.querySelector('.nav-maps-dropdown')?.classList.remove('open');
        window.OLYCITY.nav('maps');
        setTimeout(() => {
          const mapBtn = document.querySelector(`[data-map-idx="${mi}"]`);
          window.OLYCITY.showMap(mi, mapBtn);
        }, 60);
      });
    });
  }
  // Map sections
  document.getElementById('main').innerHTML = state.COMPS_DATA.map((d, i) => mapSectionHTML(d, i)).join('');
  // Roster (full + mini)
  document.getElementById('roster-grid').innerHTML = rosterHTML() + guestCardHTML();
  document.getElementById('mini-roster').innerHTML = miniRosterHTML();
  // Agents page
  document.getElementById('agents-filters').innerHTML = agentsFiltersHTML();
  document.getElementById('agents-full-grid').innerHTML = agentsGridHTML();
  // Comp builder — lazy, loaded on first nav to builder page
  try {
    const savedBuilder = localStorage.getItem('olycity-builder');
    if (savedBuilder) state.builderSlots = JSON.parse(savedBuilder);
  } catch(e) {}
  // S-Tier
  document.getElementById('stier-row').innerHTML = stierHTML();
  // Global notes
  const gnGrid = document.getElementById('global-notes-grid');
  if (gnGrid) gnGrid.innerHTML = globalNotesHTML();
}

// ─── BOOT ─────────────────────────────────────────
async function boot() {
  // Auto-clear localStorage if version changed
  const storedVersion = localStorage.getItem('olycity-version');
  if (storedVersion !== SITE_VERSION) {
    // Clear cache but KEEP player stats (expensive to re-sync, don't change with code updates)
    const keys = Object.keys(localStorage).filter(k =>
      k.startsWith('olycity-') && k !== 'olycity-player-stats' && k !== 'olycity-profile' && !k.startsWith('olycity-saved-comps-')
    );
    keys.forEach(k => localStorage.removeItem(k));
    localStorage.setItem('olycity-version', SITE_VERSION);
    console.log('[OLYCITY] Cache cleared — new version', SITE_VERSION);
  }

  initHeroParticles();
  initWheelLogos();
  initTheme();
  initParallax();
  initKeyboard(() => window.OLYCITY.closeAgentPage());

  // Clear stale localStorage from old versions (different data format)
  try {
    const raw = localStorage.getItem('olycity-player-stats');
    if (raw) {
      const parsed = JSON.parse(raw);
      const firstVal = Object.values(parsed)[0];
      // If topAgents is not an array of strings, nuke it
      if (firstVal && !Array.isArray(firstVal.topAgents)) {
        localStorage.removeItem('olycity-player-stats');
        console.log('[OLYCITY] Cleared stale player stats from localStorage');
      }
    }
  } catch(e) {
    localStorage.removeItem('olycity-player-stats');
  }

  // Loading indicator
  document.getElementById('main').innerHTML = `<div class="loading">Chargement des données…</div>`;

  try {
    await Promise.all([loadData(), valorantApi.load()]);
  } catch (e) {
    console.error('[OLYCITY] Load error', e);
    document.getElementById('main').innerHTML = `<div class="loading" style="color:var(--D)">Erreur de chargement — vérifie ta connexion et recharge.</div>`;
    return;
  }

  // Expose map icons for firebase-draw.js
  window._valorantApiMaps = valorantApi.maps;
  renderAll();
  initSearch((name) => window.OLYCITY.showAgentPage(name));

  // Guest card — Enter key support
  document.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      const active = document.activeElement;
      if (active?.id === 'guest-name' || active?.id === 'guest-tag') {
        window.OLYCITY.guestOpen('tracker', null);
      }
    }
  });

  // Agents page search
  const agentsInput = document.getElementById('agents-search-input');
  if (agentsInput) {
    agentsInput.addEventListener('input', (e) => {
      const role = state.currentAgentFilter || 'all';
      document.getElementById('agents-full-grid').innerHTML = agentsGridHTML(role, e.target.value);
      setTimeout(() => initTilt(), 50);
    });
  }
  setTimeout(() => initTilt(), 200);

  // Restore last fav comp
  if (state.FAVS.length > 0) {
    const [first] = state.FAVS;
    const match = first.match(/comp-(\d+)-(\d+)/);
    if (match) {
      const mi = +match[1], ci = +match[2];
      const mapBtn = document.querySelector(`[data-map-idx="${mi}"]`);
      window.OLYCITY.showMap(mi, mapBtn);
      const tabBtns = document.querySelectorAll(`#map-${mi} .comp-tab`);
      if (tabBtns[ci]) window.OLYCITY.switchComp(mi, ci, tabBtns[ci]);
    }
  }

  // URL hash — shared comp link
  if (window.location.hash) {
    const m = window.location.hash.replace('#','').match(/comp-(\d+)-(\d+)/);
    if (m) {
      const mi = +m[1], ci = +m[2];
      window.OLYCITY.nav('maps');
      const mapBtn = document.querySelector(`[data-map-idx="${mi}"]`);
      window.OLYCITY.showMap(mi, mapBtn);
      const tabBtns = document.querySelectorAll(`#map-${mi} .comp-tab`);
      if (tabBtns[ci]) window.OLYCITY.switchComp(mi, ci, tabBtns[ci]);
    }
  }
  // Browser back/forward button support
  window.addEventListener('popstate', (e) => {
    const state_data = e.state;
    // Close video modal if open
    window.OLYCITY.closeVideoModal();
    // Close compare panel if open
    const compareWrap = document.getElementById('compare-panel-wrap');
    if (compareWrap) compareWrap.style.display = 'none';

    if (state_data?.page === 'agent') {
      // Re-open agent page
      if (state_data.agent) window.OLYCITY.showAgentPage(state_data.agent);
    } else if (state_data?.page) {
      window.OLYCITY.nav(state_data.page, false);
    } else {
      // No state = home or hash-based
      const hash = window.location.hash.replace('#', '');
      if (hash && ['maps','roster','agents','builder'].includes(hash)) {
        window.OLYCITY.nav(hash, false);
      } else if (!hash || hash === 'home') {
        window.OLYCITY.nav('home', false);
      }
    }
  });

  // Close video modal on Escape
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') window.OLYCITY.closeVideoModal();
  });
  // Browser back/forward button support
  window.addEventListener('popstate', (e) => {
    const s = e.state;
    window.OLYCITY.closeVideoModal();
    const compareWrap = document.getElementById('compare-panel-wrap');
    if (compareWrap) compareWrap.style.display = 'none';
    if (s?.page === 'agent' && s.agent) {
      window.OLYCITY.showAgentPage(s.agent);
    } else if (s?.page) {
      window.OLYCITY.nav(s.page, false);
    } else {
      const hash = window.location.hash.replace('#', '');
      if (['maps','roster','agents','builder'].includes(hash)) {
        window.OLYCITY.nav(hash, false);
      } else {
        window.OLYCITY.nav('home', false);
      }
    }
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') window.OLYCITY.closeVideoModal();
  });
  // Push initial history state
  const initHash = window.location.hash.replace('#','');
  const initPage = ['maps','roster','agents','builder'].includes(initHash) ? initHash : 'home';
  window.history.replaceState({ page: initPage }, '', window.location.href);
  // Hide loading screen
  const ls = document.getElementById('loading-screen');
  if (ls) {
    ls.style.opacity = '0';
    setTimeout(() => ls.remove(), 500);
  }
  // Lancer Firebase EN PREMIER et attendre qu'il soit prêt
  window._initPresence?.();
  await new Promise(resolve => {
    const t = Date.now();
    const check = () => (window._presenceReady || Date.now()-t > 2000) ? resolve() : setTimeout(check, 100);
    check();
  });

  // Profile system
  const savedProfile = localStorage.getItem('olycity-profile');
  if (savedProfile) {
    state.currentProfile = savedProfile;
    window.OLYCITY._applyProfileIndicator(savedProfile);
  } else {
    window.OLYCITY._showProfilePicker();
  }
  window.OLYCITY.showMap(0, null);
  console.log('[OLYCITY] Ready ✓');
}

boot();
