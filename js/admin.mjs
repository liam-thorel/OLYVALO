/**
 * OLYCITY — Admin
 * Page cachée (pas de lien dans le nav, accès via #admin) pour gérer le
 * roster : assigner les comptes détectés en live à un membre, ajouter des
 * comptes secondaires et ajouter de nouveaux membres.
 *
 * Un compte Riot n'est pas rattaché à un jeu en particulier — le même compte
 * peut jouer Valorant et LoL, donc la liste des comptes par membre est unique.
 *
 * Verrouillée par un mot de passe partagé simple (cohérent avec le reste du
 * site, qui n'a aucune vraie authentification) — pas une vraie sécurité,
 * juste un garde-fou contre un visiteur qui tomberait sur l'URL.
 */

import { accountLiveState, accountRiotId, discoveryRows, normalizeGames } from './admin-account-utils.mjs?v=20260810-firebase-connection-fix';
import { buildScriptHealth, scriptDiagnosticText, scriptHealthSummary } from './admin-health-utils.mjs?v=20260810-firebase-connection-fix';
import { fetchJsonWithTimeout } from './request-utils.mjs?v=20260809-route-load-stable';
import { isLiveRecordExpired, liveDataStore, staleLiveRecords } from './live-data-store.mjs?v=20260810-firebase-connection-fix';

const FIREBASE_URL = 'https://realtime-database-5bb9f-default-rtdb.europe-west1.firebasedatabase.app';
// SHA-256 du mot de passe admin. Pour le changer : recalcule le hash d'un
// nouveau mot de passe et remplace la valeur ci-dessous.
const ADMIN_PASSWORD_HASH = '4ec69c8d367347db4dd4357d82c919af0e21fad86cf0432757b8de628c227af7';
const AUTH_STORAGE_KEY = 'olycity-admin-auth';
const ADMIN_LOAD_TIMEOUT_MS = 4_000;

let staticRoster = [];
let overlayMembers = {};
let overlayAccounts = {};
let overlayHiddenMembers = {};
let ignoredAccounts = {};
let discovered = {};
let lolClients = {};
let lolSessions = {};
let valorantClients = {};
let valorantSessions = {};
let latestScriptVersion = '';
let liveStoreStatus = {};
let adminLiveCleanup = null;
let adminLoadSequence = 0;
let adminDataLoaded = false;

function slugify(name) {
  return String(name || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-+|-+$)/g, '');
}

async function sha256Hex(text) {
  const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buffer)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// Reconfirmation du mot de passe admin avant une action destructive (ex:
// suppression d'un membre) — même mot de passe que celui qui déverrouille la
// page, mais redemandé explicitement pour éviter un clic accidentel.
async function confirmWithPassword(message) {
  const value = window.prompt(message);
  if (value === null) return false;
  const hash = await sha256Hex(value);
  return hash === ADMIN_PASSWORD_HASH;
}

async function fbGet(path, signal) {
  return fetchJsonWithTimeout(`${FIREBASE_URL}/${path}.json`, { signal, timeoutMs: ADMIN_LOAD_TIMEOUT_MS });
}
async function fbPut(path, data) {
  const res = await fetch(`${FIREBASE_URL}/${path}.json`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Firebase PUT ${path} — ${res.status}`);
  return res.json();
}
async function fbPost(path, data) {
  const res = await fetch(`${FIREBASE_URL}/${path}.json`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Firebase POST ${path} — ${res.status}`);
  return res.json();
}
async function fbDelete(path) {
  const res = await fetch(`${FIREBASE_URL}/${path}.json`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`Firebase DELETE ${path} — ${res.status}`);
}

// L'identité des membres (nom/rôle/avatar) vient de roster.json pour les 5 du
// roster + de rosterOverlay/members pour ceux ajoutés depuis l'admin. Les
// comptes, eux, sont TOUJOURS dans rosterOverlay/accounts — y compris pour les
// 5 du roster (migrés une fois depuis riot/smurfs) — donc tous supprimables
// de la même façon, sans compte "principal" protégé.
//
// roster.json est un fichier statique du site (pas dans Firebase) : on ne
// peut pas en retirer une entrée directement. Un membre "supprimé" depuis
// l'admin — y compris l'un des 5 du roster — est donc simplement masqué via
// rosterOverlay/hiddenMembers, sans toucher au fichier source.
function allMembers() {
  const staticList = staticRoster.map(player => ({
    id: slugify(player.name), name: player.name, role: player.role || '', avatar: player.avatar || '',
  }));
  const staticIds = new Set(staticList.map(member => member.id));
  const overlayList = Object.entries(overlayMembers)
    .filter(([id]) => !staticIds.has(id))
    .map(([id, member]) => ({ id, name: member.name, role: member.role || '', avatar: member.avatar || '' }));
  return [...staticList, ...overlayList].filter(member => !overlayHiddenMembers[member.id]);
}

function accountsForMember(memberId) {
  const extra = overlayAccounts[memberId] || {};
  return Object.entries(extra).map(([key, account]) => ({ ...account, games: normalizeGames(account), key }));
}

function applyLiveSnapshot(snapshot = {}) {
  lolClients = snapshot.lolClients || {};
  lolSessions = snapshot.lolSessions || {};
  valorantClients = snapshot.valorantClients || {};
  valorantSessions = snapshot.valorantSessions || {};
  liveStoreStatus = snapshot.status || {};
}

async function loadAll(signal) {
  const [roster, overlay, discoveredData, liveSnapshot, updateManifest] = await Promise.all([
    fetchJsonWithTimeout(`./data/roster.json?v=${Date.now()}`, { signal, timeoutMs: ADMIN_LOAD_TIMEOUT_MS }),
    fbGet('rosterOverlay', signal).catch(() => null),
    fbGet('discovered', signal).catch(() => null),
    liveDataStore.refresh({ timeoutMs:ADMIN_LOAD_TIMEOUT_MS }).catch(() => liveDataStore.snapshot()),
    fetchJsonWithTimeout(`./live/update-manifest.json?v=${Date.now()}`, { signal, timeoutMs: ADMIN_LOAD_TIMEOUT_MS }).catch(() => null),
  ]);
  if (Array.isArray(roster)) staticRoster = roster;
  if (overlay !== null) {
    overlayMembers = overlay?.members || {};
    overlayAccounts = overlay?.accounts || {};
    overlayHiddenMembers = overlay?.hiddenMembers || {};
    ignoredAccounts = overlay?.ignoredAccounts || {};
  }
  if (discoveredData !== null) discovered = discoveredData || {};
  applyLiveSnapshot(liveSnapshot);
  if (updateManifest?.version) latestScriptVersion = updateManifest.version;
  adminDataLoaded = true;
}

function timeAgo(ts) {
  if (!Number(ts)) return 'jamais';
  const seconds = Math.max(0, Math.floor((Date.now() - Number(ts)) / 1000));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}min`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}j`;
}

function scriptHealthRows() {
  const accountLinks = Object.entries(overlayAccounts).flatMap(([memberId, accounts]) =>
    Object.values(accounts || {}).map(account => ({
      memberId,
      playerName: accountRiotId(account),
      puuid: account.puuid || '',
    }))
  );
  return buildScriptHealth({
    members: allMembers(), valorantClients, valorantSessions, lolClients, lolSessions,
    accountLinks, latestVersion: latestScriptVersion,
  });
}

function healthStateDetail(row) {
  if (row.state === 'in-game') return [row.map, row.mode, row.server].filter(Boolean).join(' · ') || 'Partie en cours';
  if (row.state === 'agent-select') return [row.map, row.server].filter(Boolean).join(' · ') || 'Sélection en cours';
  if (row.state === 'error') return row.issues[0] || 'Diagnostic nécessaire';
  if (row.state === 'ready') return row.riotClient === false ? 'Script actif · Riot fermé' : 'Prêt à détecter une partie';
  return row.heartbeatAt ? `Dernier signal il y a ${timeAgo(row.heartbeatAt)}` : 'Aucune installation détectée';
}

function renderHealthDashboardHTML() {
  const rows = scriptHealthRows();
  const summary = scriptHealthSummary(rows);
  return `
    <div class="admin-health-summary">
      <div><strong>${summary.connected}</strong><span>connectés</span></div>
      <div><strong>${summary.playing}</strong><span>en activité</span></div>
      <div class="${summary.issues ? 'attention' : ''}"><strong>${summary.issues}</strong><span>à vérifier</span></div>
      <div><strong>${summary.offline}</strong><span>hors ligne</span></div>
    </div>
    <div class="admin-health-grid" id="admin-health-grid">
      ${rows.map(row => {
        const memberName = row.member?.name || row.memberName || row.memberId || 'Installation inconnue';
        const versionLabel = row.version ? `v${row.version}` : 'Version inconnue';
        return `
          <article class="admin-health-card" data-state="${escapeHTML(row.state)}" data-health-id="${escapeHTML(row.id)}">
            <header class="admin-health-card-head">
              ${row.member?.avatar ? `<img class="admin-health-avatar" src="${escapeHTML(row.member.avatar)}" alt="">` : `<span class="admin-health-avatar admin-health-avatar-fallback">${escapeHTML(memberName.slice(0, 1).toUpperCase())}</span>`}
              <div><strong>${escapeHTML(memberName)}</strong><small>${escapeHTML(row.account || 'Aucun compte détecté')}</small></div>
              <span class="admin-health-state">${escapeHTML(row.stateLabel)}</span>
            </header>
            <p class="admin-health-current">${escapeHTML(healthStateDetail(row))}</p>
            <dl class="admin-health-facts">
              <div><dt>Signal</dt><dd>${row.heartbeatAt ? `il y a ${timeAgo(row.heartbeatAt)}` : 'jamais'}</dd></div>
              <div><dt>Version</dt><dd class="${row.outdated ? 'warning' : ''}">${escapeHTML(versionLabel)}${row.outdated ? ' · ancienne' : ''}</dd></div>
              <div><dt>Démarrage</dt><dd>${row.autoStart === 'managed' ? 'géré automatiquement' : 'non vérifiable'}</dd></div>
              <div><dt>Riot</dt><dd>${row.riotClient === null ? 'non observé' : row.riotClient ? 'client détecté' : 'client fermé'}</dd></div>
            </dl>
            ${row.issues.length ? `<div class="admin-health-issues">${row.issues.map(issue => `<span>${escapeHTML(issue)}</span>`).join('')}</div>` : '<div class="admin-health-ok">Aucun problème détecté</div>'}
            <button class="admin-btn admin-btn-small admin-health-copy" type="button" data-action="copy-health" data-health-id="${escapeHTML(row.id)}">Copier le diagnostic</button>
          </article>`;
      }).join('')}
    </div>`;
}

function renderHealthInto(root) {
  const dashboard = root.querySelector('#admin-health-dashboard');
  if (dashboard) dashboard.innerHTML = renderHealthDashboardHTML();
  const refreshed = root.querySelector('#admin-health-refreshed');
  if (refreshed) {
    const reconnecting = Object.values(liveStoreStatus).some(status => status?.error);
    refreshed.textContent = reconnecting
      ? 'reconnexion aux données…'
      : `actualisé à ${new Date().toLocaleTimeString('fr-FR', { hour:'2-digit', minute:'2-digit', second:'2-digit' })}`;
  }
  renderPurgeControl(root);
}

function renderPurgeControl(root) {
  const button = root.querySelector('#admin-purge-stale-btn');
  if (!button) return;
  const count = staleLiveRecords(liveDataStore.snapshot()).length;
  button.textContent = count ? `Purger ${count} entrée${count > 1 ? 's' : ''}` : 'Firebase propre';
  button.disabled = count === 0;
}

function renderAccountStatesInto(root) {
  root.querySelectorAll('.admin-account-row').forEach(row => {
    const account = overlayAccounts?.[row.dataset.member]?.[row.dataset.key];
    const status = row.querySelector('.admin-status');
    if (!account || !status) return;
    const live = accountLiveState(account, { lolClients, lolSessions, valorantClients, valorantSessions });
    status.className = `admin-status ${live.state}`;
    status.textContent = live.label;
  });
}

function startHealthRefresh(root) {
  adminLiveCleanup?.();
  adminLiveCleanup = liveDataStore.subscribe(snapshot => {
    if (location.hash !== '#admin' || !root.isConnected) return;
    applyLiveSnapshot(snapshot);
    renderHealthInto(root);
    renderAccountStatesInto(root);
  }, { refreshOnStart:false });
}

function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderDiscoveredHTML() {
  const rows = discoveryRows(discovered, lolClients, overlayAccounts, ignoredAccounts);
  if (rows.length === 0) return '<p class="admin-empty">Aucun compte détecté en attente d\'assignation.</p>';

  const memberOptions = allMembers().map(m => `<option value="${escapeHTML(m.id)}">${escapeHTML(m.name)}</option>`).join('');
  return `<div class="admin-table">${rows.map(row => `
    <div class="admin-row" data-discovered-key="${escapeHTML(row.key)}" data-source-key="${escapeHTML(row.sourceKey || '')}" data-source="${escapeHTML(row.source || 'valorant')}">
      <span class="admin-game-badge ${row.source === 'lol' ? 'lol' : 'valorant'}">${row.source === 'lol' ? 'LOL' : 'VAL'}</span>
      <span class="admin-account-stack"><strong>${escapeHTML(row.playerName)}</strong><small>${escapeHTML(row.region || 'Région inconnue')}${row.puuid ? ` · PUUID ${escapeHTML(String(row.puuid).slice(0, 8))}…` : ''}</small></span>
      <span class="admin-status ${row.connected === false ? 'offline' : 'online'}">${row.connected === false ? 'Hors ligne' : escapeHTML(row.phase || 'Détecté')}</span>
      <span class="admin-dim">vu il y a ${timeAgo(row.lastSeen || row.ts || row.firstSeen)}</span>
      <select class="admin-select-member">
        <option value="">— assigner à —</option>
        ${memberOptions}
      </select>
      <button class="admin-btn admin-btn-primary" data-action="assign-discovered">Assigner</button>
      <button class="admin-btn admin-btn-danger" data-action="dismiss-discovered">Ignorer</button>
    </div>`).join('')}</div>`;
}

function renderMembersHTML() {
  return allMembers().map(member => {
    const accounts = accountsForMember(member.id);
    const accountRows = accounts.map(account => {
      const live = accountLiveState(account, { lolClients, lolSessions, valorantClients, valorantSessions });
      const scope = account.games.length === 2 ? 'both' : account.games[0];
      return `
        <div class="admin-account-row" data-member="${member.id}" data-key="${escapeHTML(account.key)}">
          <div class="admin-account-details"><strong>${escapeHTML(accountRiotId(account))}</strong><small>${account.puuid ? `PUUID ${escapeHTML(String(account.puuid).slice(0, 10))}… · ` : ''}${escapeHTML(account.region || 'région inconnue')}</small></div>
          <select class="admin-account-game" data-action="change-games" title="Jeux surveillés">
            <option value="valorant" ${scope === 'valorant' ? 'selected' : ''}>VAL</option>
            <option value="lol" ${scope === 'lol' ? 'selected' : ''}>LOL</option>
            <option value="both" ${scope === 'both' ? 'selected' : ''}>VAL + LOL</option>
          </select>
          <span class="admin-status ${live.state}">${escapeHTML(live.label)}</span>
          <button class="admin-btn admin-btn-small ${account.monitoring ? 'admin-monitor-on' : ''}" data-action="toggle-monitoring" title="Surveillance API centrale" ${account.games.includes('lol') ? '' : 'disabled'}>${account.games.includes('lol') ? (account.monitoring ? '● Suivi actif' : '○ Suivi inactif') : 'API LoL uniquement'}</button>
          <button class="admin-btn admin-btn-small admin-btn-danger" data-action="remove-account" data-member="${member.id}" data-key="${escapeHTML(account.key)}">✕</button>
        </div>`;
    }).join('') || '<span class="admin-dim">Aucun</span>';

    return `
      <div class="admin-member-card">
        <div class="admin-member-head">
          ${member.avatar ? `<img class="admin-member-avatar" src="${escapeHTML(member.avatar)}" alt="">` : ''}
          <strong>${escapeHTML(member.name)}</strong>
          <span class="admin-dim">${escapeHTML(member.role)}</span>
          <button class="admin-btn admin-btn-small admin-btn-danger admin-delete-member" data-action="delete-member" data-member="${member.id}" title="Supprimer ce membre">🗑</button>
        </div>
        <div class="admin-member-accounts">${accountRows}</div>
        <form class="admin-add-account-form" data-member="${member.id}">
          <input name="name" placeholder="Pseudo" required>
          <span>#</span>
          <input name="tag" placeholder="TAG" required>
          <select name="games" title="Jeu du compte"><option value="valorant">VAL</option><option value="lol">LOL</option><option value="both">VAL + LOL</option></select>
          <input name="puuid" placeholder="PUUID (optionnel)">
          <input name="region" placeholder="Région (ex: euw1)">
          <button type="submit" class="admin-btn admin-btn-small">+ Ajouter</button>
        </form>
      </div>`;
  }).join('');
}

function render() {
  const root = document.getElementById('admin-content');
  if (!root) return;
  root.innerHTML = `
    <div class="admin-wrap">
      <div class="admin-header">
        <h2 class="admin-title">Admin OLYCITY</h2>
        <button class="admin-btn admin-btn-small" id="admin-refresh-btn">↻ Rafraîchir</button>
      </div>

      <section class="admin-section admin-health-section">
        <div class="admin-section-head admin-health-heading">
          <div>
            <h3>Centre de santé des scripts</h3>
            <p class="admin-dim">État des installations OLYCITY Live · VAL et LoL réunis</p>
          </div>
          <div class="admin-health-actions">
            <span class="admin-dim" id="admin-health-refreshed">actualisé maintenant</span>
            <button type="button" class="admin-btn admin-btn-small admin-btn-danger" id="admin-purge-stale-btn">Firebase propre</button>
          </div>
        </div>
        <div id="admin-health-dashboard">${renderHealthDashboardHTML()}</div>
      </section>

      <section class="admin-section">
        <h3>Comptes détectés non assignés</h3>
        <div id="admin-discovered">${renderDiscoveredHTML()}</div>
      </section>

      <section class="admin-section">
        <div class="admin-section-head">
          <h3>Membres &amp; comptes</h3>
          <button class="admin-btn admin-btn-small" id="admin-add-member-btn">+ Ajouter un membre</button>
        </div>
        <div id="admin-add-member-form-wrap"></div>
        <div id="admin-members" class="admin-members-grid">${renderMembersHTML()}</div>
      </section>
    </div>`;
  wireEvents(root);
  startHealthRefresh(root);
}

async function reloadAndRender(root) {
  root.querySelector('.admin-wrap')?.style.setProperty('opacity', '0.5');
  await loadAll();
  render();
}

function wireEvents(root) {
  root.querySelector('#admin-refresh-btn')?.addEventListener('click', () => reloadAndRender(root));

  root.querySelector('#admin-purge-stale-btn')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    const candidates = staleLiveRecords(liveDataStore.snapshot());
    if (!candidates.length) return;
    const confirmed = await confirmWithPassword(`Tape le mot de passe admin pour purger ${candidates.length} entrée(s) Firebase expirée(s) :`);
    if (!confirmed) return;
    button.disabled = true;
    button.textContent = 'Vérification…';
    try {
      let removed = 0;
      for (const candidate of candidates) {
        const current = await fbGet(candidate.path).catch(() => null);
        if (!isLiveRecordExpired(candidate.channel, current)) continue;
        await fbDelete(candidate.path);
        removed += 1;
      }
      await liveDataStore.refresh({ timeoutMs:ADMIN_LOAD_TIMEOUT_MS });
      await loadAll();
      render();
      const refreshed = document.querySelector('#admin-health-refreshed');
      if (refreshed && removed) refreshed.textContent = `${removed} entrée${removed > 1 ? 's' : ''} supprimée${removed > 1 ? 's' : ''}`;
    } catch (error) {
      button.disabled = false;
      button.textContent = 'Réessayer la purge';
      button.title = error?.message || 'La purge Firebase a échoué';
    }
  });

  root.querySelector('#admin-health-dashboard')?.addEventListener('click', async event => {
    const button = event.target.closest('button[data-action="copy-health"]');
    if (!button) return;
    const row = scriptHealthRows().find(candidate => candidate.id === button.dataset.healthId);
    if (!row) return;
    try {
      await navigator.clipboard.writeText(scriptDiagnosticText(row));
      const original = button.textContent;
      button.textContent = 'Diagnostic copié';
      setTimeout(() => { if (button.isConnected) button.textContent = original; }, 1800);
    } catch {
      button.textContent = 'Copie impossible';
    }
  });

  root.querySelector('#admin-discovered')?.addEventListener('click', async event => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const row = button.closest('.admin-row');
    const key = row.dataset.discoveredKey;
    const entry = discoveryRows(discovered, lolClients, overlayAccounts, ignoredAccounts).find(candidate => candidate.key === key);
    if (!entry) return;

    if (button.dataset.action === 'dismiss-discovered') {
      if (entry.source === 'lol' && entry.sourceKey) await fbPut(`rosterOverlay/ignoredAccounts/${entry.sourceKey}`, true);
      else await fbDelete(`discovered/${key}`);
      await reloadAndRender(root);
      return;
    }
    if (button.dataset.action === 'assign-discovered') {
      const memberId = row.querySelector('.admin-select-member').value;
      if (!memberId) { alert('Choisis un membre à assigner.'); return; }
      const [name, tag] = entry.playerName.split('#');
      const games = normalizeGames(entry);
      await fbPost(`rosterOverlay/accounts/${memberId}`, {
        name, tag: tag || '', puuid: entry.puuid || '', region: entry.region || '', games,
        monitoring: games.includes('lol'), source: entry.source || entry.game || 'valorant',
        firstSeen: entry.firstSeen || entry.lastSeen || entry.ts || Date.now(), addedAt: Date.now(),
      });
      if (entry.source !== 'lol') await fbDelete(`discovered/${key}`);
      await reloadAndRender(root);
    }
  });

  root.querySelector('#admin-members')?.addEventListener('click', async event => {
    const monitorBtn = event.target.closest('button[data-action="toggle-monitoring"]');
    if (monitorBtn) {
      const row = monitorBtn.closest('.admin-account-row');
      const { member, key } = row.dataset;
      const account = overlayAccounts?.[member]?.[key] || {};
      await fbPut(`rosterOverlay/accounts/${member}/${key}/monitoring`, !account.monitoring);
      await reloadAndRender(root);
      return;
    }

    const removeAccountBtn = event.target.closest('button[data-action="remove-account"]');
    if (removeAccountBtn) {
      const { member, key } = removeAccountBtn.dataset;
      await fbDelete(`rosterOverlay/accounts/${member}/${key}`);
      await reloadAndRender(root);
      return;
    }

    const deleteMemberBtn = event.target.closest('button[data-action="delete-member"]');
    if (deleteMemberBtn) {
      const { member: memberId } = deleteMemberBtn.dataset;
      const member = allMembers().find(m => m.id === memberId);
      const ok = await confirmWithPassword(`Tape le mot de passe admin pour confirmer la suppression de "${member?.name || memberId}" :`);
      if (!ok) return;
      await fbPut(`rosterOverlay/hiddenMembers/${memberId}`, true);
      await fbDelete(`rosterOverlay/members/${memberId}`);
      await fbDelete(`rosterOverlay/accounts/${memberId}`);
      await reloadAndRender(root);
    }
  });

  root.querySelector('#admin-members')?.addEventListener('change', async event => {
    const select = event.target.closest('select[data-action="change-games"]');
    if (!select) return;
    const row = select.closest('.admin-account-row');
    const { member, key } = row.dataset;
    const games = select.value === 'both' ? ['valorant', 'lol'] : [select.value];
    await fbPut(`rosterOverlay/accounts/${member}/${key}/games`, games);
    if (!games.includes('lol')) await fbPut(`rosterOverlay/accounts/${member}/${key}/monitoring`, false);
    await reloadAndRender(root);
  });

  root.querySelector('#admin-members')?.addEventListener('submit', async event => {
    const form = event.target.closest('.admin-add-account-form');
    if (!form) return;
    event.preventDefault();
    const memberId = form.dataset.member;
    const formData = new FormData(form);
    const name = String(formData.get('name') || '').trim();
    const tag = String(formData.get('tag') || '').trim();
    if (!name || !tag) return;
    const gameValue = String(formData.get('games') || 'valorant');
    const games = gameValue === 'both' ? ['valorant', 'lol'] : [gameValue];
    await fbPost(`rosterOverlay/accounts/${memberId}`, {
      name, tag, games, puuid: String(formData.get('puuid') || '').trim(),
      region: String(formData.get('region') || '').trim(), monitoring: games.includes('lol'),
      source: 'manual', addedAt: Date.now(),
    });
    await reloadAndRender(root);
  });

  root.querySelector('#admin-add-member-btn')?.addEventListener('click', () => {
    const wrap = root.querySelector('#admin-add-member-form-wrap');
    wrap.innerHTML = `
      <form class="admin-add-member-form" id="admin-add-member-form">
        <input name="name" placeholder="Nom" required>
        <input name="role" placeholder="Rôle (optionnel)">
        <input name="avatar" placeholder="URL avatar (optionnel)">
        <button type="submit" class="admin-btn admin-btn-primary">Ajouter</button>
        <button type="button" class="admin-btn" id="admin-cancel-member">Annuler</button>
      </form>`;
    wrap.querySelector('#admin-cancel-member').addEventListener('click', () => { wrap.innerHTML = ''; });
    wrap.querySelector('#admin-add-member-form').addEventListener('submit', async event => {
      event.preventDefault();
      const formData = new FormData(event.target);
      const name = String(formData.get('name') || '').trim();
      if (!name) return;
      const id = slugify(name);
      if (allMembers().some(m => m.id === id)) { alert('Un membre avec ce nom existe déjà.'); return; }
      await fbPut(`rosterOverlay/members/${id}`, {
        name, role: String(formData.get('role') || '').trim(), avatar: String(formData.get('avatar') || '').trim(),
      });
      // Un membre précédemment supprimé (masqué via hiddenMembers) qu'on rajoute
      // explicitement doit redevenir visible, sinon il resterait caché malgré
      // la nouvelle fiche qu'on vient d'écrire.
      await fbDelete(`rosterOverlay/hiddenMembers/${id}`);
      await reloadAndRender(root);
    });
  });
}

function renderPasswordGate(root) {
  root.innerHTML = `
    <div class="admin-wrap admin-gate">
      <h2 class="admin-title">Admin OLYCITY</h2>
      <form id="admin-password-form">
        <input type="password" id="admin-password-input" placeholder="Mot de passe" autofocus>
        <button type="submit" class="admin-btn admin-btn-primary">Entrer</button>
      </form>
      <p class="admin-dim admin-error" id="admin-password-error" style="display:none">Mot de passe incorrect.</p>
    </div>`;
  root.querySelector('#admin-password-form').addEventListener('submit', async event => {
    event.preventDefault();
    const value = root.querySelector('#admin-password-input').value;
    const hash = await sha256Hex(value);
    if (hash === ADMIN_PASSWORD_HASH) {
      localStorage.setItem(AUTH_STORAGE_KEY, '1');
      await initAdminPage();
    } else {
      root.querySelector('#admin-password-error').style.display = 'block';
    }
  });
}

let stylesInjected = false;
function injectStylesOnce() {
  if (stylesInjected) return;
  stylesInjected = true;
  const style = document.createElement('style');
  style.textContent = ADMIN_CSS;
  document.head.appendChild(style);
}

export async function initAdminPage() {
  const root = document.getElementById('admin-content');
  if (!root) return;
  injectStylesOnce();

  if (localStorage.getItem(AUTH_STORAGE_KEY) !== '1') {
    renderPasswordGate(root);
    return;
  }

  const loadSequence = ++adminLoadSequence;
  if (adminDataLoaded) {
    // Le bouton retour doit rendre instantanément le dernier état connu. Le
    // store temps réel continue ensuite à rafraîchir les cartes sans écran vide.
    render();
    try {
      await loadAll();
      if (loadSequence !== adminLoadSequence) return;
      render();
    } catch (error) {
      console.warn('[OLYCITY] Actualisation Admin différée', error);
    }
    return;
  }

  root.innerHTML = '<div class="admin-wrap"><p class="admin-dim">Chargement…</p></div>';
  try {
    await loadAll();
    if (loadSequence !== adminLoadSequence) return;
    render();
  } catch (error) {
    if (loadSequence !== adminLoadSequence) return;
    root.innerHTML = `<div class="admin-wrap admin-load-error"><p class="admin-error">Impossible de charger l’admin : ${escapeHTML(error.message)}</p><button type="button" class="admin-btn admin-btn-primary" data-admin-retry>Réessayer</button></div>`;
    root.querySelector('[data-admin-retry]')?.addEventListener('click', initAdminPage);
  }
}

const ADMIN_CSS = `
.admin-wrap{max-width:960px;margin:0 auto;padding:32px 20px 80px;font-family:system-ui,sans-serif;color:var(--text,#e8e8ec);transition:opacity .2s}
.admin-title{font-family:Tomorrow,sans-serif;letter-spacing:2px;text-transform:uppercase;margin:0 0 20px}
.admin-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}
.admin-section{margin-top:32px;padding-top:24px;border-top:1px solid rgba(255,255,255,.08)}
.admin-section-head{display:flex;align-items:center;justify-content:space-between}
.admin-health-section{margin-top:14px;padding:20px;border:1px solid var(--border,rgba(255,255,255,.08));background:linear-gradient(145deg,rgba(255,255,255,.035),rgba(255,255,255,.012));border-radius:10px}
.admin-health-heading h3{margin:0 0 4px;font:700 14px Tomorrow,sans-serif;letter-spacing:1.4px;text-transform:uppercase}.admin-health-heading p{margin:0}
.admin-health-actions{display:flex;align-items:flex-end;gap:8px;flex-direction:column}.admin-health-actions .admin-btn:disabled{opacity:.45;cursor:default}
.admin-health-summary{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:18px 0 14px}.admin-health-summary>div{display:grid;gap:2px;padding:12px 14px;border:1px solid var(--border,rgba(255,255,255,.08));background:rgba(0,0,0,.16);border-radius:7px}.admin-health-summary strong{font:700 22px Tomorrow,sans-serif;color:var(--text)}.admin-health-summary span{font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--dim)}.admin-health-summary .attention strong{color:#f5c842}
.admin-health-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.admin-health-card{position:relative;min-width:0;padding:14px;border:1px solid var(--border,rgba(255,255,255,.08));border-left:3px solid rgba(130,140,155,.45);background:rgba(8,11,16,.52);border-radius:7px}.admin-health-card[data-state="ready"]{border-left-color:#44d17a}.admin-health-card[data-state="in-game"]{border-left-color:#ff4656}.admin-health-card[data-state="agent-select"]{border-left-color:#f5c842}.admin-health-card[data-state="error"]{border-left-color:#ff9f43}
.admin-health-card-head{display:grid;grid-template-columns:34px minmax(0,1fr) auto;align-items:center;gap:9px}.admin-health-card-head>div{display:grid;gap:2px;min-width:0}.admin-health-card-head strong{font:700 12px Tomorrow,sans-serif;letter-spacing:.8px;text-transform:uppercase;overflow:hidden;text-overflow:ellipsis}.admin-health-card-head small{font-size:10px;color:var(--dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.admin-health-avatar{width:34px;height:34px;border-radius:50%;object-fit:cover}.admin-health-avatar-fallback{display:grid;place-items:center;background:rgba(255,255,255,.06);font:700 12px Tomorrow,sans-serif;color:var(--dim)}
.admin-health-state{padding:4px 7px;border-radius:10px;background:rgba(130,140,155,.1);font:700 9px Tomorrow,sans-serif;letter-spacing:.6px;text-transform:uppercase;white-space:nowrap}.admin-health-card[data-state="ready"] .admin-health-state{color:#59d986;background:rgba(68,209,122,.11)}.admin-health-card[data-state="in-game"] .admin-health-state{color:#ff6877;background:rgba(255,70,86,.12)}.admin-health-card[data-state="agent-select"] .admin-health-state{color:#f5c842;background:rgba(245,200,66,.12)}.admin-health-card[data-state="error"] .admin-health-state{color:#ffad5c;background:rgba(255,159,67,.12)}
.admin-health-current{margin:12px 0 10px;padding:8px 10px;background:rgba(255,255,255,.025);border-radius:5px;color:rgba(232,232,236,.78);font-size:11px}.admin-health-facts{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:0}.admin-health-facts>div{min-width:0}.admin-health-facts dt{font-size:8px;letter-spacing:1.1px;text-transform:uppercase;color:var(--dim)}.admin-health-facts dd{margin:2px 0 0;font-size:10px;color:rgba(232,232,236,.72);overflow-wrap:anywhere}.admin-health-facts dd.warning{color:#f5c842}
.admin-health-issues{display:flex;flex-wrap:wrap;gap:5px;margin-top:11px}.admin-health-issues span{padding:4px 6px;border:1px solid rgba(255,159,67,.22);background:rgba(255,159,67,.08);color:#ffbd7d;border-radius:4px;font-size:9px}.admin-health-ok{margin-top:11px;color:rgba(89,217,134,.75);font-size:9px}.admin-health-copy{margin-top:11px;width:100%;color:var(--dim)}
.admin-dim{color:rgba(232,232,236,.5);font-size:12px}
.admin-error{color:#ff5f6d}
.admin-empty{color:rgba(232,232,236,.5);font-size:13px}
.admin-table{display:flex;flex-direction:column;gap:8px;margin-top:12px}
.admin-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap;background:var(--surf,rgba(255,255,255,.04));border:1px solid var(--border,rgba(255,255,255,.08));border-radius:6px;padding:10px 12px}
.admin-account{font-weight:600}.admin-account-stack,.admin-account-details{display:grid;gap:2px;min-width:150px;flex:1}.admin-account-stack small,.admin-account-details small{color:var(--dim);font-size:10px}.admin-game-badge{padding:4px 7px;border:1px solid;font:700 9px Tomorrow,sans-serif;letter-spacing:1px}.admin-game-badge.valorant{color:#ff6877;border-color:rgba(255,70,86,.38);background:rgba(255,70,86,.1)}.admin-game-badge.lol{color:#e4bd65;border-color:rgba(201,155,63,.42);background:rgba(201,155,63,.1)}
.admin-status{padding:4px 7px;border-radius:10px;background:rgba(130,140,155,.1);color:var(--muted);font-size:10px;white-space:nowrap}.admin-status.ingame{color:#59d986;background:rgba(68,209,122,.11)}.admin-status.online{color:#62b9d4;background:rgba(35,137,185,.13)}.admin-status.offline,.admin-status.unknown{color:var(--dim)}
.admin-select-member{background:#161a22;color:inherit;border:1px solid rgba(255,255,255,.15);border-radius:4px;padding:6px 8px}
.admin-btn{background:rgba(255,255,255,.08);color:inherit;border:1px solid rgba(255,255,255,.15);border-radius:4px;padding:6px 12px;font-size:12px;cursor:pointer}
.admin-btn:hover{background:rgba(255,255,255,.14)}
.admin-btn:disabled{cursor:not-allowed;opacity:.38}
.admin-btn-primary{background:rgba(63,207,207,.18);border-color:rgba(63,207,207,.4);color:#3fcfcf}
.admin-btn-danger{background:rgba(255,95,109,.12);border-color:rgba(255,95,109,.35);color:#ff5f6d}
.admin-btn-small{padding:4px 8px;font-size:11px}
.admin-members-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(360px,100%),1fr));gap:16px;margin-top:16px}
.admin-member-card{min-width:0;overflow:hidden;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:8px;padding:16px}
.admin-member-head{display:flex;align-items:center;gap:10px;margin-bottom:12px}
.admin-delete-member{margin-left:auto}
.admin-member-avatar{width:32px;height:32px;border-radius:50%;object-fit:cover}
.admin-member-accounts{display:flex;flex-direction:column;gap:8px;margin-bottom:12px;font-size:13px}
.admin-account-row{display:grid;grid-template-columns:minmax(0,1fr) auto;grid-template-areas:"details details" "game status" "monitor remove";align-items:center;gap:7px 10px;padding:10px 0;border-bottom:1px solid var(--border,rgba(255,255,255,.06))}.admin-account-row:last-child{border-bottom:0}.admin-account-details{grid-area:details;min-width:0}.admin-account-details strong{overflow-wrap:anywhere}.admin-account-game{grid-area:game;width:auto;min-width:82px;background:var(--surf2,#161a22);color:inherit;border:1px solid var(--border2,rgba(255,255,255,.15));border-radius:4px;padding:5px}.admin-account-row .admin-status{grid-area:status;justify-self:end;max-width:100%;overflow:hidden;text-overflow:ellipsis}.admin-account-row [data-action="toggle-monitoring"]{grid-area:monitor;justify-self:start;max-width:100%;white-space:normal;text-align:left}.admin-account-row [data-action="remove-account"]{grid-area:remove;justify-self:end}.admin-monitor-on{color:#59d986;border-color:rgba(68,209,122,.35);background:rgba(68,209,122,.1)}
.admin-add-account-form{display:grid;grid-template-columns:minmax(0,1.35fr) auto minmax(0,.8fr);gap:6px;align-items:center;margin-top:12px;padding-top:12px;border-top:1px solid var(--border,rgba(255,255,255,.06))}.admin-add-account-form input[name="name"]{grid-column:1}.admin-add-account-form>span{grid-column:2;text-align:center}.admin-add-account-form input[name="tag"]{grid-column:3}.admin-add-account-form select{grid-column:1}.admin-add-account-form input[name="puuid"]{grid-column:2/4}.admin-add-account-form input[name="region"]{grid-column:1/3}.admin-add-account-form button{grid-column:3}.admin-add-member-form{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:8px}
.admin-add-account-form input,.admin-add-member-form input,.admin-add-account-form select{width:100%;box-sizing:border-box;background:#161a22;color:inherit;border:1px solid rgba(255,255,255,.15);border-radius:4px;padding:6px 8px;font-size:12px;min-width:0}.admin-add-member-form input{flex:1}
.admin-gate{max-width:360px;text-align:center;padding-top:120px}
.admin-gate input{width:100%;background:#161a22;color:inherit;border:1px solid rgba(255,255,255,.15);border-radius:4px;padding:10px 12px;margin-bottom:10px}
.admin-gate form{display:flex;flex-direction:column;gap:10px}
@media(max-width:700px){.admin-wrap{padding-inline:14px}.admin-row .admin-select-member{flex:1}.admin-section-head{align-items:flex-start;gap:10px}.admin-members-grid,.admin-health-grid{grid-template-columns:1fr}.admin-health-summary{grid-template-columns:1fr 1fr}.admin-health-section{padding:14px}.admin-health-heading{flex-direction:column}.admin-health-card-head{grid-template-columns:34px minmax(0,1fr)}.admin-health-state{grid-column:1/3;justify-self:start}.admin-health-facts{grid-template-columns:1fr}}
`;
