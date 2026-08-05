/**
 * OLYCITY — Paris
 * Page publique affichant le classement des points de pari du bot Discord
 * (voir discord-bot/). Lecture seule — les paris se placent depuis Discord.
 */

const FIREBASE_URL = 'https://realtime-database-5bb9f-default-rtdb.europe-west1.firebasedatabase.app';

function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function fbGet(path) {
  const res = await fetch(`${FIREBASE_URL}/${path}.json`);
  if (!res.ok) throw new Error(`Firebase GET ${path} — ${res.status}`);
  return res.json();
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

async function loadAndRender() {
  const root = document.getElementById('betting-content');
  if (!root) return;
  root.innerHTML = '<p class="betting-dim">Chargement…</p>';

  try {
    const wallets = await fbGet('betting/wallets');
    const entries = Object.values(wallets || {});

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
  } catch (error) {
    root.innerHTML = `<p class="betting-dim">Erreur de chargement : ${escapeHTML(error.message)}</p>`;
  }
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
  await loadAndRender();
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
`;
