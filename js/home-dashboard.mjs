import { avatarLayersHTML } from './avatars.mjs';
import { freshLiveClients, liveClientSummary, liveSessionSignal } from './live-clients.mjs?v=20261005-return-live';
import { liveClientSummaryText, normalizeLolClientState } from './live-status.mjs?v=20261003-party-count';
import { liveDataStore, liveTimestamp } from './live-data-store.mjs?v=20261005-return-live';
import { activeLolSessions, isTftSession, lolMapLabel } from './lol-utils.mjs?v=20261005-all-modes';
import { getGameMode } from './game-mode.mjs?v=20260824-home-title';

function activeValorantSessions(raw = {}, now = Date.now()) {
  return Object.entries(raw)
    .map(([id, session]) => ({ id, ...(session || {}) }))
    .filter(session => liveSessionSignal(session, now) === 'live')
    .sort((left, right) => Number(isPregame(left)) - Number(isPregame(right)) || Number(right.ts || 0) - Number(left.ts || 0));
}

function isPregame(session) { return session.phase === 'pregame' || session.mode === 'agent-select'; }

function freshLeagueClients(snapshot, now) {
  return Object.values(snapshot.lolClients || {}).filter(client => {
    const timestamp = liveTimestamp(client, now);
    return client?.connected === true && timestamp > 0 && now - timestamp < 55_000;
  }).map(normalizeLolClientState);
}

function onlineMemberIds(snapshot, now = Date.now()) {
  const valorant = freshLiveClients(snapshot.valorantClients, snapshot.valorantSessions, now);
  const league = freshLeagueClients(snapshot, now);
  return new Set([...valorant, ...league].map(client => String(client.memberId || '').toLowerCase()).filter(Boolean));
}

export function homeDashboardState(snapshot = {}, now = Date.now(), context = {}) {
  const mode = context.game === 'lol' ? 'lol' : 'valorant';
  const valorantSessions = mode === 'valorant' ? activeValorantSessions(snapshot.valorantSessions, now) : [];
  const leagueSessions = mode === 'lol' ? activeLolSessions(snapshot.lolSessions, now) : [];
  const onlineIds = onlineMemberIds(snapshot, now);

  if (valorantSessions.length) {
    const session = valorantSessions[0];
    const players = new Set(valorantSessions.map(item => item.memberId).filter(Boolean)).size || valorantSessions.length;
    const selecting = isPregame(session);
    return {
      state:'valorant', kicker:selecting ? 'Sélection · Valorant' : 'Live · Valorant', title:session.mapClean || session.map || 'Partie en cours',
      detail:`${players} membre${players > 1 ? 's' : ''} suivi${players > 1 ? 's' : ''} · ${selecting ? 'Sélection des agents' : 'Partie en cours'}`, action:'Voir le Live', page:'live', onlineIds,
    };
  }
  if (leagueSessions.length) {
    const players = new Set(leagueSessions.map(item => item.memberId).filter(Boolean)).size || leagueSessions.length;
    return {
      state:'lol', kicker:isTftSession(leagueSessions[0]) ? 'Live · Teamfight Tactics' : 'Live · League of Legends', title:isTftSession(leagueSessions[0]) ? 'Partie TFT en cours' : 'Partie en cours',
      detail:`${players} membre${players > 1 ? 's' : ''} · ${leagueSessions[0].queueDescription || lolMapLabel(leagueSessions[0]) || 'Mode en cours de détection'}`, action:'Voir le Live', page:'live', onlineIds,
    };
  }
  {
    const valorantClients = freshLiveClients(snapshot.valorantClients, snapshot.valorantSessions, now);
    const leagueClients = freshLeagueClients(snapshot, now);
    const clients = mode === 'lol' ? leagueClients : valorantClients;
    if (clients.length) {
    const summary = liveClientSummary(clients);
    const detail = liveClientSummaryText(summary);
    return {
      state:mode, kicker:`En ce moment · ${mode === 'lol' ? 'League of Legends' : 'Valorant'}`,
      title:summary.inGame ? 'Partie détectée' : summary.agentSelect ? 'Sélection en cours' : summary.queue ? 'Recherche de partie' : `${clients.length} membre${clients.length > 1 ? 's' : ''} connecté${clients.length > 1 ? 's' : ''}`,
      detail:detail || 'Scripts connectés · état de jeu inconnu', action:'Voir le Live', page:'live', onlineIds,
    };
    }
  }
  return {
    state:mode, kicker:`En ce moment · ${mode === 'lol' ? 'League of Legends' : 'Valorant'}`, title:'Pas de partie en cours',
    detail:mode === 'lol' ? 'Retrouve les rangs et les champions du groupe.' : 'Prépare la prochaine partie avec les compositions par map.',
    action:mode === 'lol' ? 'Voir le roster' : 'Explorer les maps', page:mode === 'lol' ? 'roster' : 'maps', onlineIds,
  };
}

function memberFaces(members, onlineIds) {
  return members.map(member => `
    <span class="home-member-face${onlineIds.has(String(member.id || '').toLowerCase()) ? ' online' : ''}" title="${member.name}">
      ${avatarLayersHTML(member.name, member.avatar)}
    </span>`).join('');
}

function renderSnapshot(snapshot, members, context = {}) {
  const card = document.getElementById('home-now-card');
  const kicker = document.getElementById('home-now-kicker');
  const title = document.getElementById('home-now-title');
  const detail = document.getElementById('home-now-detail');
  const action = document.getElementById('home-now-action');
  const faces = document.getElementById('home-member-faces');
  const onlineLabel = document.getElementById('home-online-label');
  if (!card || !kicker || !title || !detail || !action || !faces || !onlineLabel) return;

  const model = homeDashboardState(snapshot, Date.now(), { ...context, game:getGameMode() });
  faces.innerHTML = memberFaces(members, model.onlineIds);
  onlineLabel.textContent = `${model.onlineIds.size} en ligne`;
  card.dataset.state = model.state;
  kicker.textContent = model.kicker;
  title.textContent = model.title;
  detail.textContent = model.detail;
  action.textContent = model.action;
  card.onclick = () => window.OLYCITY?.nav(model.page);
}

export function initHomeDashboard({ members = [], navigate, openUniverse } = {}) {
  const worldButtons = [...document.querySelectorAll('[data-home-world][data-home-page]')];
  const handleWorldClick = event => {
    const { homeWorld, homePage } = event.currentTarget.dataset;
    if (homeWorld === 'coop') (navigate || window.OLYCITY?.nav?.bind(window.OLYCITY))?.(homePage);
    else (openUniverse || window.OLYCITY?.openUniverse?.bind(window.OLYCITY))?.(homeWorld, homePage);
  };
  worldButtons.forEach(button => button.addEventListener('click', handleWorldClick));
  const render = snapshot => renderSnapshot(snapshot, members);
  const handleGameChange = () => render(liveDataStore.snapshot());
  document.addEventListener('olycity:gamechange', handleGameChange);
  const unsubscribe = liveDataStore.subscribe(render);
  const timer = window.setInterval(() => render(liveDataStore.snapshot()), 10_000);
  return () => {
    worldButtons.forEach(button => button.removeEventListener('click', handleWorldClick));
    document.removeEventListener('olycity:gamechange', handleGameChange);
    unsubscribe();
    window.clearInterval(timer);
  };
}
