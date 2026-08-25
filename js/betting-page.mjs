/**
 * OLYCITY — Paris
 * Page publique affichant le classement des points de pari du bot Discord
 * (voir discord-bot/). Lecture seule — les paris se placent depuis Discord.
 */

import { mergeFirebaseEvent } from './lol-utils.mjs?v=20260810-firebase-connection-fix';
import { fetchJsonWithRetry } from './request-utils.mjs?v=20260825-first-load-recovery';

const FIREBASE_URL = 'https://realtime-database-5bb9f-default-rtdb.europe-west1.firebasedatabase.app';
const BETTING_CACHE_KEY = 'olycity-betting-wallets-cache-v1';
let walletsState = {};
let initialized = false;
let stream = null;
let loadSequence = 0;
let realtimeRevision = 0;

function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function fbGet(path) {
  return fetchJsonWithRetry(`${FIREBASE_URL}/${path}.json`, {
    timeoutMs:8_000,
    init:{ cache:'no-store' },
  });
}

function readCache() {
  try {
    const cached = JSON.parse(localStorage.getItem(BETTING_CACHE_KEY) || 'null');
    return cached?.wallets && typeof cached.wallets === 'object' ? cached : null;
  } catch { return null; }
}

function writeCache() {
  try { localStorage.setItem(BETTING_CACHE_KEY, JSON.stringify({ savedAt:Date.now(), wallets:walletsState })); }
  catch { /* Le stockage local peut être indisponible. */ }
}

function renderLeaderboard(title, rows, emptyText) {
  if (rows.length === 0) return `<div class="betting-board"><h3>${title}</h3><p class="betting-empty">${emptyText}</p></div>`;
  const medals = ['🥇', '🥈', '🥉'];
  const items = rows.map((row, index) => `
    <div class="betting-row">
      <span class="betting-rank">${medals[index] || `${index + 1}.`}</span>
      <span class="betting-name">${escapeHTML(row.name)}</span>
      <span class="betting-value">${row.value}</span>
    </div>`).join('');
  return `<div class="betting-board"><h3>${title}</h3>${items}</div>`;
}

function renderWallets({ offline = false } = {}) {
  const root = document.getElementById('betting-content');
  if (!root) return;
  const entries = Object.values(walletsState || {});

    const overall = entries
      .filter(w => (w.balance || 0) > 0)
      .sort((a, b) => (b.balance || 0) - (a.balance || 0))
      .slice(0, 10)
      .map(w => ({ name: w.username || '???', value: `${w.balance} pts` }));

    const weekly = entries
      .map(w => ({ name: w.username || '???', delta: (w.balance || 0) - (w.weekStartBalance ?? w.balance ?? 0) }))
      .filter(w => w.delta !== 0)
      .sort((a, b) => b.delta - a.delta)
      .slice(0, 10)
      .map(w => ({ name: w.name, value: `${w.delta >= 0 ? '+' : ''}${w.delta} pts` }));

    const bestStreak = entries
      .filter(w => (w.bestStreak || 0) > 0)
      .sort((a, b) => (b.bestStreak || 0) - (a.bestStreak || 0))
      .slice(0, 5)
      .map(w => ({ name: w.username || '???', value: `🔥 ${w.bestStreak}` }));

  root.innerHTML = `
      <div class="betting-wrap">
        ${offline ? '<div class="betting-sync-note" role="status"><strong>Copie enregistrée</strong><span>La synchronisation reprendra automatiquement.</span></div>' : ''}
        <p class="betting-intro">
          Chaque membre du serveur Discord gagne 500 points par jour et peut parier sur les games
          Valorant/LoL du roster OLYCITY suivies par le bot (<code>/bet</code> ou les boutons sur la
          notification de game). Classement mis à jour en temps réel.
        </p>
        <div class="betting-grid">
          ${renderLeaderboard('🏆 Classement général', overall, 'Personne n\'a encore parié.')}
          ${renderLeaderboard('📅 Cette semaine', weekly, 'Pas encore de mouvement cette semaine.')}
          ${renderLeaderboard('🔥 Meilleures séries', bestStreak, 'Aucune série gagnante enregistrée.')}
        </div>
      </div>`;
}

async function loadAndRender({ quiet = false } = {}) {
  const root = document.getElementById('betting-content');
  if (!root) return;
  const sequence = ++loadSequence;
  const revision = realtimeRevision;
  if (!quiet && !Object.keys(walletsState).length) root.innerHTML = '<p class="betting-dim">Chargement…</p>';

  try {
    const wallets = await fbGet('betting/wallets');
    if (sequence !== loadSequence || revision !== realtimeRevision) return;
    walletsState = wallets || {};
    writeCache();
    renderWallets();
  } catch (error) {
    if (Object.keys(walletsState).length) {
      renderWallets({ offline:true });
      return;
    }
    if (root) root.innerHTML = `<div class="betting-load-error"><strong>Classements indisponibles</strong><span>La connexion a été interrompue.</span><button type="button" data-betting-retry>Réessayer</button></div>`;
  }
}

function applyRealtimeWallets(event) {
  try {
    realtimeRevision += 1;
    loadSequence += 1;
    walletsState = mergeFirebaseEvent(walletsState, JSON.parse(event.data));
    writeCache();
    renderWallets();
  } catch (error) {
    console.warn('[OLYCITY] Mise à jour Paris illisible', error);
  }
}

function startRealtime() {
  if (stream || typeof EventSource === 'undefined') return;
  stream = new EventSource(`${FIREBASE_URL}/betting/wallets.json`);
  stream.addEventListener('put', applyRealtimeWallets);
  stream.addEventListener('patch', applyRealtimeWallets);
  stream.addEventListener('error', () => {
    if (Object.keys(walletsState).length) renderWallets({ offline:true });
  });
}

function restartRealtime() {
  stream?.close();
  stream = null;
  startRealtime();
}

let stylesInjected = false;
function injectStylesOnce() {
  if (stylesInjected) return;
  stylesInjected = true;
  const style = document.createElement('style');
  style.textContent = BETTING_CSS;
  document.head.appendChild(style);
}

export async function initBettingPage() {
  injectStylesOnce();
  if (!initialized) {
    initialized = true;
    const cached = readCache();
    if (cached) {
      walletsState = cached.wallets;
      renderWallets({ offline:true });
    }
    document.getElementById('betting-content')?.addEventListener('click', event => {
      if (event.target.closest('[data-betting-retry]')) {
        restartRealtime();
        void loadAndRender();
      }
    });
    startRealtime();
  } else if (Object.keys(walletsState).length) {
    renderWallets();
  }
  await loadAndRender({ quiet:Object.keys(walletsState).length > 0 });
}

const BETTING_CSS = `
.betting-wrap{max-width:960px;margin:0 auto}
.betting-intro{color:rgba(232,232,236,.7);font-size:13px;line-height:1.6;margin-bottom:24px;max-width:640px}
.betting-intro code{background:rgba(255,255,255,.08);padding:2px 6px;border-radius:4px}
.betting-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px}
.betting-board{background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:8px;padding:16px}
.betting-board h3{font-family:Tomorrow,sans-serif;font-size:13px;letter-spacing:1px;text-transform:uppercase;margin:0 0 12px}
.betting-row{display:flex;align-items:center;gap:10px;padding:6px 0;border-top:1px solid rgba(255,255,255,.06)}
.betting-row:first-of-type{border-top:none}
.betting-rank{width:24px;flex-shrink:0;text-align:center}
.betting-name{flex:1;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.betting-value{color:var(--S,#3fcfcf);font-weight:700;font-size:13px}
.betting-empty,.betting-dim{color:rgba(232,232,236,.5);font-size:13px}
.betting-sync-note,.betting-load-error{display:flex;align-items:center;gap:10px;margin:0 0 16px;padding:12px 14px;border:1px solid rgba(255,255,255,.1);border-radius:8px;color:rgba(232,232,236,.72);font-size:12px}
.betting-sync-note strong,.betting-load-error strong{color:#f1f1f4}
.betting-sync-note span,.betting-load-error span{flex:1}
.betting-load-error{flex-wrap:wrap}
.betting-load-error button{margin-left:auto;padding:8px 12px;border:1px solid var(--S,#3fcfcf);background:transparent;color:var(--S,#3fcfcf);cursor:pointer}
`;
