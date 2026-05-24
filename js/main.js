/**
 * OLYCITY · Main
 * Point d'entrée. Charge les données, orchestre les modules, expose window.OLYCITY.
 */

import { valorantApi } from './api.js';

const SITE_VERSION = '1779594793'; // Auto-updated on push
import { syncPlayer as henrikSyncPlayer, syncAllPlayers as henrikSyncAll, persistPlayerStats } from './henrik.js';
import { rosterHTML, mapSectionHTML, stierHTML, globalNotesHTML, navMapsHTML, agentPageHTML, miniRosterHTML, agentsFiltersHTML, agentsGridHTML, compCompareHTML, compBuilderHTML, savedCompsHTML, calloutsHTML } from './render.js';
import { initTheme, initTilt, initParallax, initSearch, initKeyboard, updateFavCount } from './interactions.js';
import { storage } from './storage.js';

// ─── STATE (partagé avec render.js) ───────────────
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
  LINEUPS: {},
  CALLOUTS: {},
  currentCompIdx: {},
};

// ─── LOAD JSON DATA ───────────────────────────────
async function loadData() {
  const [comps, roster, roles, agentsFr, lineups, callouts] = await Promise.all([
    fetch('./data/comps.json').then(r => r.json()),
    fetch('./data/roster.json').then(r => r.json()),
    fetch('./data/roles.json').then(r => r.json()),
    fetch('./data/agents-fr.json').then(r => r.json()),
    fetch('./data/lineups.json').then(r => r.json()),
    fetch('./data/callouts.json').then(r => r.json()),
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
  state.FAVS = storage.getFavs();
  state.PLAYER_STATS = storage.getPlayerStats();

  // Restore mains from last sync if available
  state.ROSTER.forEach(p => {
    if (!Array.isArray(p.mains)) p.mains = [];
    const ps = state.PLAYER_STATS[p.name];
    if (Array.isArray(ps?.topAgents) && ps.topAgents.length >= 1) {
      const realMains = ps.topAgents.filter(Boolean).slice(0, 3);
      const originalMains = Array.isArray(p.mains) ? p.mains : [];
      while (realMains.length < 3 && originalMains[realMains.length]) {
        realMains.push(originalMains[realMains.length]);
      }
      if (realMains.length > 0) p.mains = realMains;
    }
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
      const wrap = document.getElementById('comp-builder-wrap');
      if (wrap && !wrap.hasChildNodes()) window.OLYCITY._renderBuilder();
    }
    const navBtn = document.querySelector(`.page-nav-btn[data-page="${page}"]`);
    if (navBtn) navBtn.classList.add('active');

    // Show/hide map nav
    const mapNav = document.getElementById('nav-maps');
    if (mapNav) mapNav.style.display = page === 'maps' ? 'flex' : 'none';

    window.scrollTo({ top: 0, behavior: 'smooth' });
    state.currentPage = page;

    // Push to browser history
    if (pushHistory) {
      const url = page === 'home' ? window.location.pathname : `${window.location.pathname}#${page}`;
      window.history.pushState({ page }, '', url);
    }

    // Re-init tilt on map page
    if (page === 'maps') setTimeout(() => initTilt(), 100);
    // Update mini roster on home
    if (page === 'home') {
      const el = document.getElementById('mini-roster');
      if (el) el.innerHTML = miniRosterHTML();
    }
  },


  showMap(idx, btn) {
    document.querySelectorAll('.map-section').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.nav-map-btn').forEach(b => b.classList.remove('active'));
    const section = document.getElementById(`map-${idx}`);
    if (section) section.classList.add('active');
    if (btn) btn.classList.add('active');
    state.currentMap = idx;
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
  _renderBuilder() {
    const wrap = document.getElementById('comp-builder-wrap');
    if (wrap) wrap.innerHTML = compBuilderHTML(state.builderSlots) + savedCompsHTML();
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
      // Advance to next empty slot
      const next = state.builderSlots.findIndex((s, i) => i > slot && s === null);
      state.builderFocusSlot = next >= 0 ? next : slot;
    }
    window.OLYCITY._renderBuilder();
    storage.setPlayerStats && localStorage.setItem('olycity-builder', JSON.stringify(state.builderSlots));
  },

  builderRemove(i) {
    state.builderSlots[i] = null;
    state.builderFocusSlot = i;
    window.OLYCITY._renderBuilder();
    localStorage.setItem('olycity-builder', JSON.stringify(state.builderSlots));
  },

  builderClear() {
    state.builderSlots = [null,null,null,null,null];
    state.builderFocusSlot = 0;
    window.OLYCITY._renderBuilder();
    localStorage.removeItem('olycity-builder');
  },

  builderLoad(i) {
    try {
      const saved = JSON.parse(localStorage.getItem('olycity-saved-comps') || '[]');
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
      const saved = JSON.parse(localStorage.getItem('olycity-saved-comps') || '[]');
      saved.splice(i, 1);
      localStorage.setItem('olycity-saved-comps', JSON.stringify(saved));
      window.OLYCITY._renderBuilder();
    } catch(e) {}
  },

  builderSave() {
    const filled = state.builderSlots.filter(Boolean);
    if (filled.length < 2) { alert('Ajoute au moins 2 agents avant de sauvegarder.'); return; }
    const name = prompt('Nom de cette comp :', 'Ma Comp Custom');
    if (!name) return;
    const saved = JSON.parse(localStorage.getItem('olycity-saved-comps') || '[]');
    saved.push({ name, agents: filled, createdAt: Date.now() });
    localStorage.setItem('olycity-saved-comps', JSON.stringify(saved));
    alert('Comp sauvegardée !');
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

      // Update mains from real data
      if (Array.isArray(stats.topAgents) && stats.topAgents.length >= 1) {
        const realMains = stats.topAgents.filter(Boolean).slice(0, 3);
        const originalMains = Array.isArray(player.mains) ? [...player.mains] : [];
        while (realMains.length < 3 && originalMains[realMains.length]) {
          realMains.push(originalMains[realMains.length]);
        }
        if (realMains.length > 0) player.mains = realMains;
      }

      document.getElementById('roster-grid').innerHTML = rosterHTML();
      setBtnState(playerName, 'synced', 'Synced ✓');
    } catch (e) {
      const msgs = {
        AUTH_REQUIRED: 'Clé invalide',
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
        if (player && Array.isArray(stats.topAgents) && stats.topAgents.length >= 1) {
          const realMains = stats.topAgents.filter(Boolean).slice(0, 3);
          const originalMains = Array.isArray(player.mains) ? [...player.mains] : [];
          while (realMains.length < 3 && originalMains[realMains.length]) {
            realMains.push(originalMains[realMains.length]);
          }
          if (realMains.length > 0) player.mains = realMains;
        }
        document.getElementById('roster-grid').innerHTML = rosterHTML();
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
  // Nav maps
  document.getElementById('nav-maps').innerHTML = navMapsHTML();
  // Map sections
  document.getElementById('main').innerHTML = state.COMPS_DATA.map((d, i) => mapSectionHTML(d, i)).join('');
  // Roster (full + mini)
  document.getElementById('roster-grid').innerHTML = rosterHTML();
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
  document.getElementById('global-notes-grid').innerHTML = globalNotesHTML();
}

// ─── BOOT ─────────────────────────────────────────
async function boot() {
  // Auto-clear localStorage if version changed
  const storedVersion = localStorage.getItem('olycity-version');
  if (storedVersion !== SITE_VERSION) {
    const keys = Object.keys(localStorage).filter(k => k.startsWith('olycity-'));
    keys.forEach(k => localStorage.removeItem(k));
    localStorage.setItem('olycity-version', SITE_VERSION);
    console.log('[OLYCITY] Cache cleared — new version', SITE_VERSION);
  }

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

  renderAll();
  initSearch((name) => window.OLYCITY.showAgentPage(name));

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
  // Push initial history state
  const initHash = window.location.hash.replace('#','');
  const initPage = ['maps','roster','agents','builder'].includes(initHash) ? initHash : 'home';
  window.history.replaceState({ page: initPage }, '', window.location.href);
  console.log('[OLYCITY] Ready ✓');
}

boot();
