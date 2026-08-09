import { groupLolSessions, lolKda, normalizeLolHistory, summarizeLolDays } from './lol-utils.mjs?v=20260810-firebase-connection-fix';
import { fetchJsonWithTimeout } from './request-utils.mjs?v=20260809-route-load-stable';
import { liveDataStore } from './live-data-store.mjs?v=20260810-firebase-connection-fix';

const FIREBASE_URL = 'https://realtime-database-5bb9f-default-rtdb.europe-west1.firebasedatabase.app';
let historyLoadSequence = 0;
const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[char]));
const image = value => typeof value === 'object' ? value?.image : value;
const name = value => typeof value === 'object' ? value?.name : value;

function rankLabel(rank) {
  if (!rank) return 'Non classé';
  if (typeof rank === 'string') return rank;
  return rank.tier || rank.name || rank.rank || 'Non classé';
}

function sessionCard(group) {
  const first = group.players[0] || {};
  const region = String(first.region || 'EUW').toUpperCase();
  const queue = first.queueDescription || first.queue || 'Partie en cours';
  return `<article class="lol-match-live">
    <header class="lol-match-live-header">
      <div><span>${esc(queue)}</span><strong>Faille de l’invocateur</strong></div>
      <div class="lol-region-badge">${esc(region)}</div>
    </header>
    <div class="lol-live-players">${group.players.map(player => {
      const champion = player.champion || {};
      const opponent = player.matchup || player.opponent || {};
      return `<div class="lol-live-player">
        <div class="lol-champion-frame">${image(champion) ? `<img src="${esc(image(champion))}" alt="${esc(name(champion))}">` : '<span>?</span>'}</div>
        <div class="lol-live-player-main"><small>${esc(player.position || player.role || 'Rôle inconnu')}</small><strong>${esc(player.playerName || player.riotId || 'Joueur')}</strong><span>${esc(name(champion) || 'Champion en chargement')}</span></div>
        <div class="lol-matchup">${image(opponent) ? `<img src="${esc(image(opponent))}" alt="">` : ''}<small>contre</small><strong>${esc(name(opponent) || '—')}</strong></div>
        <div class="lol-rank"><small>Rang</small><strong>${esc(rankLabel(player.rank))}</strong></div>
      </div>`;
    }).join('')}</div>
    <footer><span class="lol-status-dot"></span> Données actualisées automatiquement</footer>
  </article>`;
}

function renderLolLive(raw) {
  const el = document.getElementById('lol-live-content');
  if (!el) return;
  const groups = groupLolSessions(raw);
  if (document.documentElement.dataset.game === 'lol') {
    const dot = document.getElementById('live-dot');
    if (dot) dot.style.display = groups.length ? 'block' : 'none';
  }
  if (!groups.length) {
    el.innerHTML = '<div class="lol-empty-state"><span class="lol-empty-rune">L</span><strong>Aucune partie LoL en cours</strong><small>Le match apparaîtra ici dès qu’un script connecté entrera en partie.</small></div>';
    return;
  }
  el.innerHTML = groups.map(sessionCard).join('');
}

export function initLolLivePage() {
  let sessions = {};
  let timer = null;
  const render = () => renderLolLive(sessions);
  const unsubscribeLiveData = liveDataStore.subscribe(snapshot => {
    const nextSessions = snapshot.lolSessions || {};
    if (nextSessions === sessions) return;
    sessions = nextSessions;
    render();
  });
  timer = setInterval(render, 10_000);
  const handleGameChange = event => { if (event.detail?.mode === 'lol') render(); };
  document.addEventListener('olycity:gamechange', handleGameChange);
  return () => { unsubscribeLiveData(); clearInterval(timer); document.removeEventListener('olycity:gamechange', handleGameChange); };
}

function matchRow(match) {
  const champion = match.champion || {};
  const date = new Date(Number(match.ts || 0));
  const result = match.win ? 'Victoire' : 'Défaite';
  const items = (match.items || []).filter(Boolean);
  return `<details class="lol-history-match ${match.win ? 'win' : 'loss'}">
    <summary>
      <span class="lol-result">${result}</span>
      <span class="lol-history-champion">${image(champion) ? `<img src="${esc(image(champion))}" alt="">` : ''}<span><strong>${esc(name(champion) || 'Champion')}</strong><small>${esc(match.queueDescription || 'Partie')}</small></span></span>
      <span class="lol-history-kda"><strong>${Number(match.kills || 0)} / ${Number(match.deaths || 0)} / ${Number(match.assists || 0)}</strong><small>${lolKda(match)} KDA</small></span>
      <span class="lol-history-stat"><strong>${Number(match.cs || 0)}</strong><small>CS</small></span>
      <span class="lol-history-duration"><strong>${esc(match.durationLabel || '—')}</strong><small>${date.toLocaleTimeString('fr-FR', { hour:'2-digit', minute:'2-digit' })}</small></span>
      <span class="lol-history-chevron">⌄</span>
    </summary>
    <div class="lol-history-detail">
      <div><small>Joueur</small><strong>${esc(match.playerName || 'Inconnu')}</strong></div>
      <div><small>Participation</small><strong>${Number(match.killParticipation || 0)}%</strong></div>
      <div><small>Niveau</small><strong>${Number(match.level || 0)}</strong></div>
      <div><small>Build final</small><span class="lol-items">${items.length ? items.map(item => `<img src="${esc(image(item))}" title="${esc(name(item))}" alt="${esc(name(item))}">`).join('') : '—'}</span></div>
    </div>
  </details>`;
}

function renderHistory(matches, player = 'all', period = 'all') {
  const el = document.getElementById('lol-history-content');
  if (!el) return;
  const now = Date.now();
  const maxAge = period === 'today' ? 86_400_000 : period === '7d' ? 604_800_000 : Infinity;
  const filtered = matches.filter(match => (player === 'all' || match.playerName === player) && now - Number(match.ts || 0) <= maxAge);
  const players = [...new Set(matches.map(match => match.playerName).filter(Boolean))];
  const days = summarizeLolDays(filtered);
  el.innerHTML = `<div class="lol-history-toolbar">
    <div class="lol-filter-group"><span>Joueur</span><select id="lol-history-player"><option value="all">Tous</option>${players.map(value => `<option value="${esc(value)}" ${value === player ? 'selected' : ''}>${esc(value)}</option>`).join('')}</select></div>
    <div class="lol-history-periods">${[['all','Tout'],['7d','7 jours'],['today','Aujourd’hui']].map(([value,label]) => `<button data-lol-period="${value}" class="${period === value ? 'active' : ''}">${label}</button>`).join('')}</div>
  </div>
  ${filtered.length ? `<section class="lol-day-recap"><span>Résumé</span>${days.map(day => `<div><strong>${esc(day.date)}</strong><span>${day.games} game${day.games > 1 ? 's' : ''}</span><b>${day.wins}V · ${day.games-day.wins}D</b><small>${day.games ? Math.round(day.wins/day.games*100) : 0}% WR</small></div>`).join('')}</section><div class="lol-history-list">${filtered.map(matchRow).join('')}</div>` : '<div class="lol-empty-state"><span class="lol-empty-rune">L</span><strong>Aucune partie dans cette période</strong><small>L’historique LoL est indépendant de Valorant.</small></div>'}`;
  document.getElementById('lol-history-player')?.addEventListener('change', event => renderHistory(matches, event.target.value, period));
  el.querySelectorAll('[data-lol-period]').forEach(button => button.addEventListener('click', () => renderHistory(matches, player, button.dataset.lolPeriod)));
}

export async function initLolHistoryPage() {
  const el = document.getElementById('lol-history-content');
  if (!el) return;
  const loadSequence = ++historyLoadSequence;
  el.innerHTML = '<div class="lol-empty-state"><span class="lol-empty-rune">L</span><strong>Chargement de l’historique…</strong></div>';
  try {
    const data = await fetchJsonWithTimeout(`${FIREBASE_URL}/live/lolHistory.json`);
    if (loadSequence !== historyLoadSequence) return;
    const matches = normalizeLolHistory(data || {});
    renderHistory(matches);
  } catch {
    if (loadSequence !== historyLoadSequence) return;
    el.innerHTML = '<div class="lol-empty-state"><strong>Historique indisponible</strong><small>La connexion a pris trop de temps.</small><button type="button" data-lol-history-retry class="btn btn-primary">Réessayer</button></div>';
    el.querySelector('[data-lol-history-retry]')?.addEventListener('click', initLolHistoryPage);
  }
}
