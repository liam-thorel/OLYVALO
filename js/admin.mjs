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

const FIREBASE_URL = 'https://realtime-database-5bb9f-default-rtdb.europe-west1.firebasedatabase.app';
// SHA-256 du mot de passe admin. Pour le changer : recalcule le hash d'un
// nouveau mot de passe et remplace la valeur ci-dessous.
const ADMIN_PASSWORD_HASH = '4ec69c8d367347db4dd4357d82c919af0e21fad86cf0432757b8de628c227af7';
const AUTH_STORAGE_KEY = 'olycity-admin-auth';

let staticRoster = [];
let overlayMembers = {};
let overlayAccounts = {};
let overlayHiddenMembers = {};
let discovered = {};

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

async function fbGet(path) {
  const res = await fetch(`${FIREBASE_URL}/${path}.json`);
  if (!res.ok) throw new Error(`Firebase GET ${path} — ${res.status}`);
  return res.json();
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
  return Object.entries(extra).map(([key, account]) => ({ ...account, key }));
}

async function loadAll() {
  const [roster, overlay, discoveredData] = await Promise.all([
    fetch(`./data/roster.json?v=${Date.now()}`).then(r => r.json()),
    fbGet('rosterOverlay').catch(() => null),
    fbGet('discovered').catch(() => null),
  ]);
  staticRoster = roster || [];
  overlayMembers = overlay?.members || {};
  overlayAccounts = overlay?.accounts || {};
  overlayHiddenMembers = overlay?.hiddenMembers || {};
  discovered = discoveredData || {};
}

function timeAgo(ts) {
  const seconds = Math.floor((Date.now() - (ts || Date.now())) / 1000);
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}min`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}j`;
}

function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderDiscoveredHTML() {
  const rows = Object.entries(discovered).map(([key, entry]) => ({ key, ...entry }));
  if (rows.length === 0) return '<p class="admin-empty">Aucun compte détecté en attente d\'assignation.</p>';

  const memberOptions = allMembers().map(m => `<option value="${escapeHTML(m.id)}">${escapeHTML(m.name)}</option>`).join('');
  return `<div class="admin-table">${rows.map(row => `
    <div class="admin-row" data-discovered-key="${escapeHTML(row.key)}">
      <span class="admin-account">${escapeHTML(row.playerName)}</span>
      <span class="admin-dim">vu il y a ${timeAgo(row.lastSeen || row.firstSeen)}</span>
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
    const accountRows = accounts.map(account => `
        <div class="admin-account-row">
          <span>${escapeHTML(account.name)}#${escapeHTML(account.tag)}</span>
          <button class="admin-btn admin-btn-small admin-btn-danger" data-action="remove-account" data-member="${member.id}" data-key="${escapeHTML(account.key)}">✕</button>
        </div>`).join('') || '<span class="admin-dim">Aucun</span>';

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
}

async function reloadAndRender(root) {
  root.querySelector('.admin-wrap')?.style.setProperty('opacity', '0.5');
  await loadAll();
  render();
}

function wireEvents(root) {
  root.querySelector('#admin-refresh-btn')?.addEventListener('click', () => reloadAndRender(root));

  root.querySelector('#admin-discovered')?.addEventListener('click', async event => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const row = button.closest('.admin-row');
    const key = row.dataset.discoveredKey;

    if (button.dataset.action === 'dismiss-discovered') {
      await fbDelete(`discovered/${key}`);
      await reloadAndRender(root);
      return;
    }
    if (button.dataset.action === 'assign-discovered') {
      const memberId = row.querySelector('.admin-select-member').value;
      if (!memberId) { alert('Choisis un membre à assigner.'); return; }
      const entry = discovered[key];
      if (!entry) return;
      const [name, tag] = entry.playerName.split('#');
      await fbPost(`rosterOverlay/accounts/${memberId}`, { name, tag: tag || '', addedAt: Date.now() });
      await fbDelete(`discovered/${key}`);
      await reloadAndRender(root);
    }
  });

  root.querySelector('#admin-members')?.addEventListener('click', async event => {
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

  root.querySelector('#admin-members')?.addEventListener('submit', async event => {
    const form = event.target.closest('.admin-add-account-form');
    if (!form) return;
    event.preventDefault();
    const memberId = form.dataset.member;
    const formData = new FormData(form);
    const name = String(formData.get('name') || '').trim();
    const tag = String(formData.get('tag') || '').trim();
    if (!name || !tag) return;
    await fbPost(`rosterOverlay/accounts/${memberId}`, { name, tag, addedAt: Date.now() });
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

  root.innerHTML = '<div class="admin-wrap"><p class="admin-dim">Chargement…</p></div>';
  try {
    await loadAll();
    render();
  } catch (error) {
    root.innerHTML = `<div class="admin-wrap"><p class="admin-error">Erreur de chargement : ${escapeHTML(error.message)}</p></div>`;
  }
}

const ADMIN_CSS = `
.admin-wrap{max-width:960px;margin:0 auto;padding:32px 20px 80px;font-family:system-ui,sans-serif;color:var(--text,#e8e8ec);transition:opacity .2s}
.admin-title{font-family:Tomorrow,sans-serif;letter-spacing:2px;text-transform:uppercase;margin:0 0 20px}
.admin-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}
.admin-section{margin-top:32px;padding-top:24px;border-top:1px solid rgba(255,255,255,.08)}
.admin-section-head{display:flex;align-items:center;justify-content:space-between}
.admin-dim{color:rgba(232,232,236,.5);font-size:12px}
.admin-error{color:#ff5f6d}
.admin-empty{color:rgba(232,232,236,.5);font-size:13px}
.admin-table{display:flex;flex-direction:column;gap:8px;margin-top:12px}
.admin-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:6px;padding:10px 12px}
.admin-account{font-weight:600}
.admin-select-member{background:#161a22;color:inherit;border:1px solid rgba(255,255,255,.15);border-radius:4px;padding:6px 8px}
.admin-btn{background:rgba(255,255,255,.08);color:inherit;border:1px solid rgba(255,255,255,.15);border-radius:4px;padding:6px 12px;font-size:12px;cursor:pointer}
.admin-btn:hover{background:rgba(255,255,255,.14)}
.admin-btn-primary{background:rgba(63,207,207,.18);border-color:rgba(63,207,207,.4);color:#3fcfcf}
.admin-btn-danger{background:rgba(255,95,109,.12);border-color:rgba(255,95,109,.35);color:#ff5f6d}
.admin-btn-small{padding:4px 8px;font-size:11px}
.admin-members-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px;margin-top:16px}
.admin-member-card{background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:8px;padding:16px}
.admin-member-head{display:flex;align-items:center;gap:10px;margin-bottom:12px}
.admin-delete-member{margin-left:auto}
.admin-member-avatar{width:32px;height:32px;border-radius:50%;object-fit:cover}
.admin-member-accounts{display:flex;flex-direction:column;gap:8px;margin-bottom:12px;font-size:13px}
.admin-account-row{display:flex;align-items:center;justify-content:space-between;padding:2px 0}
.admin-add-account-form,.admin-add-member-form{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:8px}
.admin-add-account-form input,.admin-add-member-form input,.admin-add-account-form select{background:#161a22;color:inherit;border:1px solid rgba(255,255,255,.15);border-radius:4px;padding:6px 8px;font-size:12px;min-width:0;flex:1}
.admin-gate{max-width:360px;text-align:center;padding-top:120px}
.admin-gate input{width:100%;background:#161a22;color:inherit;border:1px solid rgba(255,255,255,.15);border-radius:4px;padding:10px 12px;margin-bottom:10px}
.admin-gate form{display:flex;flex-direction:column;gap:10px}
`;
