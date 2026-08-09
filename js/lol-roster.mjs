import { mergeFirebaseEvent, normalizeLolHistory } from './lol-utils.mjs';
import { state } from './state.mjs?v=20260806-lol-roster';

const FIREBASE_URL = 'https://realtime-database-5bb9f-default-rtdb.europe-west1.firebasedatabase.app';
const PLAYERS = [
  { name: 'Nico', riotId: 'phileas fogg#OLY' },
  { name: 'Liam', riotId: 'FakePlasticTrees#1706' },
  { name: 'Noé', riotId: 'NoWaY#alone' },
  { name: 'Rayhan', riotId: 'RayBaz#OLY' },
  { name: 'Mathis', riotId: 'M A I R#LGND' },
  {
    name: 'Logan',
    riotId: 'Stupefiant#NOXUS',
    avatar: 'https://cdn.discordapp.com/avatars/241287549719412746/39da0611d8869e0b82374fbea0331bbd.png?size=256',
  },
];
const ROLE_LABELS = { top:'Top', jungle:'Jungle', mid:'Mid', adc:'ADC', support:'Support' };
const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[char]));
const normalizeId = value => String(value || '').trim().toLocaleLowerCase('fr');
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function rankLabel(rank) {
  if (!rank?.tier) return 'Non classé';
  const tier = String(rank.tier).toUpperCase();
  const division = ['MASTER', 'GRANDMASTER', 'CHALLENGER'].includes(tier) ? '' : ` ${rank.division || ''}`;
  return `${tier}${division}`.trim();
}

function rankClass(rank) {
  return `rank-${String(rank?.tier || 'unranked').toLowerCase()}`;
}

function avatarFor(player) {
  return player.avatar || state.ROSTER.find(member => normalizeId(member.name) === normalizeId(player.name))?.avatar || '';
}

function historyFallback(matches, riotId) {
  const currentYear = new Date().getFullYear();
  const own = matches.filter(match => normalizeId(match.playerName) === normalizeId(riotId) && new Date(Number(match.ts || 0)).getFullYear() === currentYear);
  const championMap = new Map();
  const roles = { top:0, jungle:0, mid:0, adc:0, support:0 };
  own.forEach(match => {
    const champion = match.champion || {};
    const championName = typeof champion === 'object' ? champion.name : champion;
    if (championName) {
      const current = championMap.get(championName) || { name:championName, image:champion.image || '', games:0, wins:0, kills:0, deaths:0, assists:0 };
      current.games += 1;
      current.wins += match.win ? 1 : 0;
      current.kills += Number(match.kills || 0);
      current.deaths += Number(match.deaths || 0);
      current.assists += Number(match.assists || 0);
      championMap.set(championName, current);
    }
    const rawRole = String(match.position || '').toLowerCase();
    const role = rawRole === 'middle' ? 'mid' : rawRole === 'bottom' ? 'adc' : rawRole === 'utility' ? 'support' : rawRole;
    if (role in roles) roles[role] += 1;
  });
  const topChampions = [...championMap.values()].sort((a,b) => b.games-a.games || b.wins-a.wins).slice(0,3).map(champion => ({
    ...champion,
    losses: champion.games - champion.wins,
    winRate: champion.games ? Math.round(champion.wins / champion.games * 100) : 0,
    kda: Number(((champion.kills + champion.assists) / Math.max(1, champion.deaths)).toFixed(2)),
  }));
  const mainRole = Object.entries(roles).sort((a,b) => b[1]-a[1])[0];
  const latest = [...own].sort((a,b) => Number(b.ts || 0)-Number(a.ts || 0)).find(match => match.rankAfter || match.rankBefore);
  const wins = own.filter(match => match.win).length;
  return {
    rank: latest?.rankAfter || latest?.rankBefore || null,
    soloQueue: { games:own.length, wins, losses:own.length-wins, winRate:own.length ? Math.round(wins/own.length*100) : 0, roles, mainRole:mainRole?.[1] ? mainRole[0] : '' },
    topChampions,
  };
}

function viewFor(player, profiles, matches, verifiedProfiles = {}) {
  const profile = Object.values(profiles || {}).find(value => normalizeId(value?.playerName) === normalizeId(player.riotId)) || {};
  const verified = Object.values(verifiedProfiles || {}).find(value => normalizeId(value?.playerName) === normalizeId(player.riotId)) || {};
  const fallback = historyFallback(matches, player.riotId);
  const observed = profile.soloQueue?.mainRole ? profile.soloQueue : fallback.soloQueue;
  const season = profile.seasonVerified ? profile : verified.seasonVerified ? verified : null;
  const rank = profile.rank || verified.rank || fallback.rank;
  const soloQueue = season
    ? {
        ...season.soloQueue,
        roles: observed.roles || {},
        mainRole: season.soloQueue?.mainRole || observed.mainRole || '',
        mainRoleSource: season.soloQueue?.mainRoleSource || (observed.mainRole ? 'recent-games' : ''),
      }
    : profile.soloQueue?.games ? profile.soloQueue : fallback.soloQueue;
  const topChampions = season ? season.topChampions : profile.topChampions?.length ? profile.topChampions : fallback.topChampions;
  return { ...player, avatar:avatarFor(player), rank, soloQueue, topChampions, seasonVerified:Boolean(season), updatedAt:season?.updatedAt || profile.updatedAt || 0 };
}

function championRow(champion) {
  return `<div class="lol-roster-champion">
    <div class="lol-roster-champion-img">${champion.image ? `<img src="${esc(champion.image)}" alt="${esc(champion.name)}" loading="lazy">` : '<span>?</span>'}</div>
    <div><strong>${esc(champion.name)}</strong><small>${Number(champion.games || 0)} games · ${Number(champion.winRate || 0)}% WR</small></div>
    <b>${Number(champion.kda || 0).toFixed(2)}<small>KDA</small></b>
  </div>`;
}

function homeCard(player) {
  const rank = player.rank;
  const games = Number(rank?.games ?? player.soloQueue?.games ?? 0);
  const wins = Number(rank?.wins ?? player.soloQueue?.wins ?? 0);
  const losses = Number(rank?.losses ?? player.soloQueue?.losses ?? 0);
  return `<article class="lol-home-rank-card ${rankClass(rank)}">
    <div class="lol-home-rank-avatar">${player.avatar ? `<img src="${esc(player.avatar)}" alt="">` : `<span>${esc(player.name[0])}</span>`}</div>
    <div class="lol-home-rank-player"><small>${esc(player.riotId)}</small><strong>${esc(player.name)}</strong></div>
    <div class="lol-home-rank-value"><small>SoloQ</small><strong>${esc(rankLabel(rank))}</strong><span>${rank?.lp != null ? `${Number(rank.lp)} LP` : player.seasonVerified ? 'Aucune SoloQ cette saison' : 'En attente du script'}</span></div>
    <div class="lol-home-rank-record"><b>${games || '—'}</b><small>${games ? `${wins}V · ${losses}D` : player.seasonVerified ? '0 partie' : 'Aucune donnée'}</small></div>
  </article>`;
}

function rosterCard(player) {
  const rank = player.rank;
  const queue = player.soloQueue || {};
  const rankGames = Number(rank?.games || 0);
  const games = rankGames || Number(queue.games || 0);
  const wins = rankGames ? Number(rank.wins || 0) : Number(queue.wins || 0);
  const losses = rankGames ? Number(rank.losses || 0) : Number(queue.losses || 0);
  const winRate = rankGames ? Number(rank.winRate || 0) : Number(queue.winRate || 0);
  const mainRole = ROLE_LABELS[queue.mainRole] || 'À déterminer';
  const roleGames = Number(queue.roles?.[queue.mainRole] || 0);
  const seasonRole = queue.mainRoleSource === 'season-champions';
  return `<article class="lol-roster-card ${rankClass(rank)}">
    <header>
      <div class="lol-roster-avatar">${player.avatar ? `<img src="${esc(player.avatar)}" alt="">` : `<span>${esc(player.name[0])}</span>`}</div>
      <div><span>${esc(player.riotId)}</span><h3>${esc(player.name)}</h3></div>
      <div class="lol-roster-rank"><small>SoloQ</small><strong>${esc(rankLabel(rank))}</strong><span>${rank?.lp != null ? `${Number(rank.lp)} LP` : player.seasonVerified ? 'Aucune partie classée' : 'Non synchronisé'}</span></div>
    </header>
    <div class="lol-roster-stats">
      <div><small>Parties saison</small><strong>${games || '—'}</strong><span>${games ? `${wins}V · ${losses}D` : player.seasonVerified ? '0V · 0D' : 'En attente'}</span></div>
      <div><small>Winrate</small><strong>${games ? `${winRate}%` : '—'}</strong><span>SoloQ</span></div>
      <div><small>${seasonRole ? 'Rôle principal estimé' : 'Rôle observé'}</small><strong>${esc(mainRole)}</strong><span>${seasonRole ? 'D’après les champions de saison' : roleGames ? `${roleGames} parties vues par le script` : 'Données insuffisantes'}</span></div>
    </div>
    <div class="lol-roster-mains"><div class="lol-roster-mains-title"><span>Top 3 champions SoloQ</span><small>Portraits Riot Data Dragon</small></div>
      ${player.topChampions?.length ? player.topChampions.map(championRow).join('') : `<div class="lol-roster-empty">${player.seasonVerified ? 'Aucune partie SoloQ cette saison.' : 'Le top champions apparaîtra après la synchronisation.'}</div>`}
    </div>
  </article>`;
}

function render(profiles, historyRaw, verifiedProfiles) {
  const matches = normalizeLolHistory(historyRaw || {});
  const players = PLAYERS.map(player => viewFor(player, profiles, matches, verifiedProfiles));
  const home = document.getElementById('lol-home-ranks');
  if (home) home.innerHTML = players.map(homeCard).join('');
  const roster = document.getElementById('lol-roster-grid');
  if (roster) roster.innerHTML = players.map(rosterCard).join('');
}

export function initLolRosterPages() {
  let profiles = {};
  let history = {};
  let verifiedProfiles = {};
  const rerender = () => render(profiles, history, verifiedProfiles);
  Promise.all([
    fetch(`${FIREBASE_URL}/live/lolProfiles.json`).then(response => response.ok ? response.json() : {}),
    fetch(`${FIREBASE_URL}/live/lolHistory.json`).then(response => response.ok ? response.json() : {}),
    fetch('./data/lol-roster-stats.json').then(response => response.ok ? response.json() : {}),
  ]).then(([profileData, historyData, verifiedData]) => {
    profiles = profileData || {};
    history = historyData || {};
    verifiedProfiles = verifiedData?.profiles || {};
    rerender();
  }).catch(rerender);
  const profileSource = new EventSource(`${FIREBASE_URL}/live/lolProfiles.json`);
  const historySource = new EventSource(`${FIREBASE_URL}/live/lolHistory.json`);
  ['put','patch'].forEach(type => {
    profileSource.addEventListener(type, event => { try { profiles = mergeFirebaseEvent(profiles, JSON.parse(event.data)); rerender(); } catch {} });
    historySource.addEventListener(type, event => { try { history = mergeFirebaseEvent(history, JSON.parse(event.data)); rerender(); } catch {} });
  });
  const syncButton = document.getElementById('lol-sync-all-btn');
  const syncStatus = document.getElementById('lol-sync-status');
  const setSyncState = (message, kind = '') => {
    if (syncStatus) {
      syncStatus.textContent = message;
      syncStatus.className = `lol-sync-status${kind ? ` is-${kind}` : ''}`;
    }
  };
  const requestFullSync = async () => {
    if (!syncButton || syncButton.disabled) return;
    const requestedAt = Date.now();
    syncButton.disabled = true;
    syncButton.classList.add('is-syncing');
    setSyncState('Demande envoyée aux scripts LoL connectés…', 'waiting');
    try {
      const response = await fetch(`${FIREBASE_URL}/live/lolRosterSyncRequest.json?print=silent`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestedAt, status:'pending', requestedBy:localStorage.getItem('olycity-profile') || 'Site' }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      let result = null;
      for (let attempt = 0; attempt < 24; attempt += 1) {
        await wait(2000);
        const statusResponse = await fetch(`${FIREBASE_URL}/live/lolRosterSyncRequest.json`);
        if (!statusResponse.ok) continue;
        const current = await statusResponse.json();
        if (Number(current?.requestedAt) !== requestedAt) break;
        if (current?.status === 'running') setSyncState(`Synchronisation par ${current.worker || 'un script'}…`, 'waiting');
        if (current?.status === 'complete' || current?.status === 'error') { result = current; break; }
      }
      if (!result) setSyncState('Aucun script LoL n’a répondu. Laisse au moins un script OLYCITY actif puis réessaie.', 'error');
      else if (result.status === 'complete') setSyncState(`${Number(result.updated || 0)} profils actualisés.`, 'ok');
      else setSyncState(result.message || 'La synchronisation a échoué.', 'error');
    } catch {
      setSyncState('Impossible d’envoyer la demande de synchronisation.', 'error');
    } finally {
      syncButton.disabled = false;
      syncButton.classList.remove('is-syncing');
    }
  };
  syncButton?.addEventListener('click', requestFullSync);
  rerender();
  return () => { profileSource.close(); historySource.close(); syncButton?.removeEventListener('click', requestFullSync); };
}

export { PLAYERS, historyFallback, rankLabel, viewFor };
