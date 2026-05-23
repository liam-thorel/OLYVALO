/**
 * OLYCITY · Main
 * Point d'entrée. Charge les données, orchestre les modules, expose window.OLYCITY.
 */

import { valorantApi } from './api.js';
import { syncPlayer as henrikSyncPlayer, syncAllPlayers as henrikSyncAll, persistPlayerStats } from './henrik.js';
import { rosterHTML, mapSectionHTML, stierHTML, globalNotesHTML, navMapsHTML, agentPageHTML } from './render.js';
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
};

// ─── LOAD JSON DATA ───────────────────────────────
async function loadData() {
  const [comps, roster, roles, agentsFr] = await Promise.all([
    fetch('./data/comps.json').then(r => r.json()),
    fetch('./data/roster.json').then(r => r.json()),
    fetch('./data/roles.json').then(r => r.json()),
    fetch('./data/agents-fr.json').then(r => r.json()),
  ]);

  state.COMPS_DATA = comps;
  state.ROSTER = roster;
  state.ROLES = roles.roles;
  state.ROLE_LABEL = { D: 'Duel', I: 'Init', S: 'Sent', C: 'Ctrl' };
  state.ROLE_FULL  = roles.labels;
  state.S_TIER = roles.sTier;
  state.GLOBAL_NOTES = roles.globalNotes;
  state.AGENT_FR = agentsFr;
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
  // Roster
  document.getElementById('roster-grid').innerHTML = rosterHTML();
  // S-Tier
  document.getElementById('stier-row').innerHTML = stierHTML();
  // Global notes
  document.getElementById('global-notes-grid').innerHTML = globalNotesHTML();
}

// ─── BOOT ─────────────────────────────────────────
async function boot() {
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

  console.log('[OLYCITY] Ready ✓');
}

boot();
