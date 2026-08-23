import { avatarLayersHTML } from './avatars.mjs';
import { freshLiveClients } from './live-clients.mjs?v=20260810-firebase-connection-fix';
import { liveDataStore, liveTimestamp } from './live-data-store.mjs?v=20260810-firebase-connection-fix';
import { activeLolSessions } from './lol-utils.mjs?v=20260806-lol-live';

const VAL_FRESH_MS = 30_000;

function activeValorantSessions(raw = {}, now = Date.now()) {
  return Object.entries(raw)
    .map(([id, session]) => ({ id, ...(session || {}) }))
    .filter(session => session.active && liveTimestamp(session, now) > 0 && now - liveTimestamp(session, now) < VAL_FRESH_MS)
    .sort((left, right) => Number(right.ts || 0) - Number(left.ts || 0));
}

function onlineMemberIds(snapshot, now = Date.now()) {
  const valorant = freshLiveClients(snapshot.valorantClients, snapshot.valorantSessions, now);
  const league = Object.values(snapshot.lolClients || {}).filter(client => {
    const timestamp = liveTimestamp(client, now);
    return client?.connected !== false && timestamp > 0 && now - timestamp < 55_000;
  });
  return new Set([...valorant, ...league].map(client => String(client.memberId || '').toLowerCase()).filter(Boolean));
}

export function homeDashboardState(snapshot = {}, now = Date.now()) {
  const valorantSessions = activeValorantSessions(snapshot.valorantSessions, now);
  const leagueSessions = activeLolSessions(snapshot.lolSessions, now);
  const onlineIds = onlineMemberIds(snapshot, now);

  if (valorantSessions.length) {
    const session = valorantSessions[0];
    const players = new Set(valorantSessions.map(item => item.memberId).filter(Boolean)).size || valorantSessions.length;
    return {
      state:'valorant', kicker:'Live · Valorant', title:session.mapClean || session.map || 'Partie en cours',
      detail:`${players} membre${players > 1 ? 's' : ''} en partie`, action:'Voir le Live', page:'live', onlineIds,
    };
  }
  if (leagueSessions.length) {
    const players = new Set(leagueSessions.map(item => item.memberId).filter(Boolean)).size || leagueSessions.length;
    return {
      state:'lol', kicker:'Live · League', title:'Partie en cours',
      detail:`${players} membre${players > 1 ? 's' : ''} sur la Faille`, action:'Voir le Live', page:'live', onlineIds,
    };
  }
  if (onlineIds.size) return {
    state:'idle', kicker:'En ce moment',
    title:`${onlineIds.size} membre${onlineIds.size > 1 ? 's' : ''} connecté${onlineIds.size > 1 ? 's' : ''}`,
    detail:'Le groupe se prépare', action:'Voir le Live', page:'live', onlineIds,
  };
  return {
    state:'idle', kicker:'Prochaine soirée', title:'On joue à quoi ?',
    detail:'Découvrir les propositions coop', action:'Voir les jeux', page:'games', onlineIds,
  };
}

function memberFaces(members, onlineIds) {
  return members.map(member => `
    <span class="home-member-face${onlineIds.has(member.id) ? ' online' : ''}" title="${member.name}">
      ${avatarLayersHTML(member.name, member.avatar)}
    </span>`).join('');
}

function renderSnapshot(snapshot, members) {
  const card = document.getElementById('home-now-card');
  const kicker = document.getElementById('home-now-kicker');
  const title = document.getElementById('home-now-title');
  const detail = document.getElementById('home-now-detail');
  const action = document.getElementById('home-now-action');
  const faces = document.getElementById('home-member-faces');
  const onlineLabel = document.getElementById('home-online-label');
  if (!card || !kicker || !title || !detail || !action || !faces || !onlineLabel) return;

  const model = homeDashboardState(snapshot);
  faces.innerHTML = memberFaces(members, model.onlineIds);
  onlineLabel.textContent = model.onlineIds.size ? `${model.onlineIds.size} en ligne` : 'Personne en ligne';
  card.dataset.state = model.state;
  kicker.textContent = model.kicker;
  title.textContent = model.title;
  detail.textContent = model.detail;
  action.textContent = model.action;
  card.onclick = () => window.OLYCITY?.nav(model.page);
}

export function initHomeDashboard({ members = [], valorantImage = '' } = {}) {
  const valorantCard = document.querySelector('[data-home-world="valorant"]');
  if (valorantCard && valorantImage) valorantCard.style.setProperty('--home-world-image', `url("${valorantImage}")`);
  const render = snapshot => renderSnapshot(snapshot, members);
  const unsubscribe = liveDataStore.subscribe(render);
  const timer = window.setInterval(() => render(liveDataStore.snapshot()), 10_000);
  return () => {
    unsubscribe();
    window.clearInterval(timer);
  };
}
