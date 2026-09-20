/**
 * Vue compacte affichée par l'application overlay, par-dessus le jeu.
 *
 * Elle ne charge PAS le site complet : à 420 px de large au-dessus d'une
 * partie, la coquille SPA, son routeur et ses caches ne servent à rien et
 * coûtent cher. On réutilise en revanche liveDataStore, déjà éprouvé par le
 * site pour la connexion temps réel à Firebase.
 */

import { liveDataStore, FIREBASE_URL } from './live-data-store.mjs?v=20260920-live-resilience';
import {
  groupActiveGames, isAgentSelect, displayNameFor, openBets, countdownLabel, escapeHtml, matchSkins,
  modeLabelFor, gameHeadline,
} from './overlay-utils.mjs';

const ROSTER_URL = './data/roster.json';
const BETS_REFRESH_MS = 10_000;   // les paris n'ont pas de flux temps réel
const TICK_MS = 1_000;            // pour les comptes à rebours

let roster = [];
let rounds = {};
let lastSnapshot = null;

const el = id => document.getElementById(id);

// Les pseudos viennent de Riot et de Firebase, que n'importe qui peut écrire :
// tout passe par escapeHtml avant d'atteindre le DOM.
function playerRow(session) {
  const name = displayNameFor(session, roster);
  const agent = session.agent?.name || session.agent || session.champion?.name || '';
  const icon = session.agent?.image || session.champion?.image || '';
  const rank = session.rank?.label || session.rank?.tier || '';
  // En LoL, le poste et l'adversaire de voie valent mieux que le seul nom
  // du champion, déjà porté par le titre du bloc.
  const against = session.matchup?.name ? `vs ${session.matchup.name}` : '';
  const lane = session.position || '';
  const meta = [against || agent, lane, rank].filter(Boolean).join(' · ');
  return `
    <div class="player">
      ${icon ? `<img src="${escapeHtml(icon)}" alt="" loading="lazy">` : '<img alt="">'}
      <span class="player-name">${escapeHtml(name)}</span>
      <span class="player-meta">${escapeHtml(meta)}</span>
    </div>`;
}

/**
 * Sessions des deux jeux, chacune marquée de sa provenance. L'application
 * overlay indique le jeu lancé dans le fragment d'URL (#lol / #valorant) :
 * on ne garde alors que celui-là, plutôt que de mélanger une game LoL en
 * cours avec une session Valorant encore fraîche de la partie d'avant.
 */
function sessionsFor(snapshot) {
  const wanted = location.hash.replace(/^#/, '');
  const all = {
    ...Object.fromEntries(Object.entries(snapshot.valorantSessions || {})
      .map(([key, value]) => [`valorant:${key}`, { ...value, game: 'valorant' }])),
    ...Object.fromEntries(Object.entries(snapshot.lolSessions || {})
      .map(([key, value]) => [`lol:${key}`, { ...value, game: 'lol' }])),
  };
  if (wanted !== 'lol' && wanted !== 'valorant') return all;
  return Object.fromEntries(Object.entries(all).filter(([, value]) => value.game === wanted));
}

function renderGame(snapshot) {
  const [game] = groupActiveGames(sessionsFor(snapshot));

  if (!game) {
    const loading = !snapshot.status?.valorantSessions?.loaded;
    el('game').innerHTML = `<div class="empty">${loading ? 'Connexion au Live…' : 'Aucune partie en cours'}</div>`;
    return;
  }

  const pregame = isAgentSelect(game);
  el('game').innerHTML = `
    <div class="game-head">
      <span class="game-map">${escapeHtml(gameHeadline(game))}</span>
      <span class="badge ${pregame ? '' : 'live'}">${pregame ? 'Agent Select' : escapeHtml(modeLabelFor(game))}</span>
    </div>
    ${game.sessions.map(playerRow).join('')}`;
}

function renderSkins(snapshot) {
  const [game] = groupActiveGames(sessionsFor(snapshot));
  const players = game ? matchSkins(game) : [];

  // Section entièrement masquée quand personne n'a de skin notable : au-dessus
  // d'une partie, un bloc vide ne fait que voler de la place.
  el('skins-section').hidden = players.length === 0;
  if (players.length === 0) return;

  el('skins').innerHTML = players.map(player => `
    <div class="skin-row">
      <span class="skin-side ${player.ally === true ? 'ally' : player.ally === false ? 'enemy' : ''}"></span>
      <span class="skin-name">${escapeHtml(player.name)}</span>
      <span class="skin-list">${player.skins.map(item => escapeHtml(item.skin)).join(' · ')}</span>
    </div>`).join('');
}

function renderBets() {
  const open = openBets(rounds);
  // La section entière disparaît quand il n'y a rien : au-dessus d'une partie,
  // un bloc vide ne fait que voler de la place.
  el('bets-section').hidden = open.length === 0;
  if (open.length === 0) return;

  el('bets').innerHTML = open.map(round => `
    <div class="bet">
      <div class="bet-main">
        <div class="bet-players">${escapeHtml((round.players || []).join(', ') || 'OLYCITY')}</div>
        <div class="bet-odds">Victoire x${escapeHtml(round.oddsWin)} · Défaite x${escapeHtml(round.oddsLose)}</div>
      </div>
      <div class="bet-timer">${escapeHtml(countdownLabel(round.closesAt))}</div>
    </div>`).join('');
}

function renderStatus(snapshot) {
  const channels = [snapshot.status?.valorantSessions, snapshot.status?.valorantClients].filter(Boolean);
  const broken = channels.some(status => status.error);
  el('status').className = broken ? 'offline' : '';
  el('status').textContent = broken
    ? 'Connexion interrompue — dernières données affichées'
    : 'OLYCITY Live';
}

function render() {
  if (!lastSnapshot) return;
  renderGame(lastSnapshot);
  renderSkins(lastSnapshot);
  renderBets();
  renderStatus(lastSnapshot);
}

async function refreshBets() {
  try {
    const response = await fetch(`${FIREBASE_URL}/betting/rounds.json`, { cache: 'no-store' });
    if (response.ok) rounds = (await response.json()) || {};
  } catch {
    // Sans paris affichés la vue reste utile : on retentera au prochain tour.
  }
  renderBets();
}

async function loadRoster() {
  try {
    const response = await fetch(ROSTER_URL, { cache: 'no-store' });
    const data = await response.json();
    roster = Array.isArray(data) ? data : (data.members || []);
  } catch {
    // Sans roster les joueurs s'affichent sous leur pseudo Riot : dégradé,
    // mais pas cassé.
    roster = [];
  }
  render();
}

liveDataStore.subscribe(snapshot => { lastSnapshot = snapshot; render(); });
// L'application overlay change le fragment quand le jeu lancé change.
window.addEventListener('hashchange', render);

loadRoster();
refreshBets();
setInterval(refreshBets, BETS_REFRESH_MS);
// Les comptes à rebours des paris doivent avancer même sans nouvel évènement.
setInterval(renderBets, TICK_MS);
