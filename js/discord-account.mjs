/**
 * Connexion au site avec Discord — un compte par personne.
 *
 * Même application et même flux que la page livechat d'olycity.fr (OAuth2
 * « implicite », application OLYBOT) : Discord renvoie un jeton dans
 * l'adresse, sans serveur. La page demande à Discord à qui il appartient, puis
 * retrouve le membre du roster par son identifiant Discord. Quelqu'un qui
 * n'est pas dans le roster obtient un compte à son nom Discord.
 *
 * Le jeton ne sert qu'à ce moment : seul le compte (identifiant, nom, avatar,
 * membre relié) est gardé dans le navigateur, jusqu'à la déconnexion.
 *
 * Le portefeuille de paris du bot est rangé sous le même identifiant Discord
 * (betting/wallets/<id>) : site et bot parlent du même compte.
 *
 * ⚠️ Firebase reste ouvert en écriture : cette connexion dit qui est qui à
 * l'écran, elle ne protège pas encore les données. Les écritures qui doivent
 * l'être passent par un Worker qui revérifie le jeton (voir workers/livechat).
 */

export const DISCORD_CLIENT_ID = '1281505908224168027'; // application OLYBOT
export const ACCOUNT_KEY = 'olycity-account';
export const STATE_KEY = 'olycity-discord-state';
const DISCORD_API = 'https://discord.com/api/v10';
const LIVECHAT_ENDPOINT = 'https://olycity-livechat.olycity.workers.dev';

/** Adresse de retour : la page elle-même, sans le fragment. */
export function redirectUri(loc = globalThis.location) {
  return `${loc.origin}${loc.pathname}`;
}

export function authorizeUrl({ clientId = DISCORD_CLIENT_ID, redirect, state }) {
  const url = new URL('https://discord.com/oauth2/authorize');
  url.search = new URLSearchParams({
    client_id: clientId, response_type: 'token', scope: 'identify',
    redirect_uri: redirect, state,
    // Déjà autorisé une fois : Discord renvoie aussitôt, sans écran.
    prompt: 'none',
  }).toString();
  return url.toString();
}

/**
 * Lit le retour de Discord dans le fragment de l'adresse.
 * null si l'adresse n'en contient pas ; { error } s'il est refusé ou
 * suspect ; { token } sinon. L'état doit être celui posé avant le départ,
 * sinon n'importe quel lien pourrait connecter quelqu'un au compte d'un autre.
 */
export function parseOAuthReturn(hash, expectedState) {
  const raw = String(hash || '').replace(/^#/, '');
  if (!/(^|&)(access_token|error)=/.test(raw)) return null;
  const params = new URLSearchParams(raw);
  if (params.get('error')) return { error: 'Connexion Discord annulée.' };
  if (!expectedState || params.get('state') !== expectedState) {
    return { error: 'Connexion Discord refusée (état invalide), réessaie.' };
  }
  const token = params.get('access_token');
  return token ? { token } : { error: 'Discord n’a pas renvoyé de jeton.' };
}

/** Identifiant Discord d'un membre : déclaré, sinon tiré de son avatar. */
export function discordIdOf(member) {
  const declared = String(member?.discordId || '').trim();
  if (/^\d{15,22}$/.test(declared)) return declared;
  return String(member?.avatar || '').match(/cdn\.discordapp\.com\/avatars\/(\d+)\//)?.[1] || null;
}

export function memberForDiscordId(members = [], discordId = '') {
  const id = String(discordId || '');
  return id ? members.find(member => discordIdOf(member) === id) || null : null;
}

export function discordAvatarUrl(user) {
  if (!user?.id) return '';
  if (user.avatar) return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=256`;
  // Avatar par défaut de Discord, calculé à partir de l'identifiant.
  const index = Number((BigInt(user.id) >> 22n) % 6n);
  return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
}

/**
 * Compte du site pour un utilisateur Discord. Un membre du roster garde son
 * nom et son avatar du roster : c'est lui que le reste du site connaît.
 */
export function accountFromDiscordUser(user, members = []) {
  const discordId = String(user?.id || '');
  if (!/^\d{15,22}$/.test(discordId)) return null;
  const member = memberForDiscordId(members, discordId);
  const discordName = String(user.global_name || user.username || '').trim().slice(0, 32) || 'Joueur';
  return {
    discordId,
    username: String(user.username || '').slice(0, 32),
    name: member?.name || discordName,
    avatar: member?.avatar || discordAvatarUrl(user),
    memberId: member?.id || null,
  };
}

/**
 * Profil sous lequel le reste du site voit la personne. Un compte hors
 * roster ne doit pas pouvoir porter le nom d'un membre : tout ce qui est
 * rangé par nom (votes, présence) lui serait attribué.
 */
export function profileForAccount(account, members = [], toId = value => value) {
  if (!account?.discordId) return null;
  const member = account.memberId ? members.find(m => m.id === account.memberId) : null;
  if (member) return { id: member.id, name: member.name, avatar: member.avatar || account.avatar };
  const taken = members.some(m => toId(m.name) === toId(account.name));
  const label = taken ? `${account.name} (@${account.username || account.discordId.slice(-4)})` : account.name;
  // Le nom sert de clé Firebase (présence, votes) : . # $ [ ] / y sont interdits.
  const name = label.replace(/[.#$[\]/]/g, '').trim() || `Joueur ${account.discordId.slice(-4)}`;
  return { id: `discord-${account.discordId}`, name, avatar: account.avatar, discordOnly: true };
}

/**
 * Demande à Discord à qui appartient le jeton. Repli sur le Worker livechat
 * (qui fait la même vérification) si l'appel direct échoue : il ne connaît
 * que les membres du roster, mais il suffit à les reconnaître.
 */
export async function fetchDiscordAccount(token, members = [], fetchImpl = globalThis.fetch) {
  const direct = await fetchImpl(`${DISCORD_API}/users/@me`, {
    headers: { Authorization: `Bearer ${token}` },
  }).catch(() => null);
  if (direct?.ok) {
    const account = accountFromDiscordUser(await direct.json(), members);
    if (account) return account;
  }
  if (direct?.status === 401) throw new Error('Connexion Discord expirée, réessaie.');

  const viaWorker = await fetchImpl(`${LIVECHAT_ENDPOINT}/me`, {
    headers: { Authorization: `Bearer ${token}` },
  }).catch(() => null);
  const body = viaWorker ? await viaWorker.json().catch(() => ({})) : {};
  const member = body?.member && members.find(m => m.id === body.member.id);
  const discordId = discordIdOf(member);
  if (member && discordId) {
    return { discordId, username: '', name: member.name, avatar: member.avatar || '', memberId: member.id };
  }
  throw new Error(body?.error || 'Discord injoignable, réessaie dans un instant.');
}

export function loadAccount(storage = globalThis.localStorage) {
  try {
    const account = JSON.parse(storage.getItem(ACCOUNT_KEY) || 'null');
    return account && /^\d{15,22}$/.test(String(account.discordId)) ? account : null;
  } catch {
    return null;
  }
}

export function saveAccount(account, storage = globalThis.localStorage) {
  try { storage.setItem(ACCOUNT_KEY, JSON.stringify(account)); } catch { /* navigation privée */ }
}

export function clearAccount(storage = globalThis.localStorage) {
  try { storage.removeItem(ACCOUNT_KEY); } catch { /* navigation privée */ }
}

/** Part vers Discord ; l'état aléatoire est vérifié au retour. */
export function startDiscordLogin({ storage = globalThis.localStorage, loc = globalThis.location } = {}) {
  const state = globalThis.crypto.randomUUID();
  try { storage.setItem(STATE_KEY, state); } catch { /* navigation privée */ }
  loc.assign(authorizeUrl({ redirect: redirectUri(loc), state }));
}

/**
 * Traite un retour de Discord s'il y en a un : retire le jeton de l'adresse
 * (il ne doit ni rester dans l'historique ni être partagé avec un lien), puis
 * établit le compte. Rend null sans retour, { error } ou { account }.
 */
export async function completeDiscordLogin(members, {
  storage = globalThis.localStorage, loc = globalThis.location, history = globalThis.history, fetchImpl = globalThis.fetch,
} = {}) {
  let expected = null;
  try { expected = storage.getItem(STATE_KEY); storage.removeItem(STATE_KEY); } catch { /* navigation privée */ }
  const result = parseOAuthReturn(loc.hash, expected);
  if (!result) return null;
  history.replaceState(null, '', redirectUri(loc));
  if (result.error) return result;
  try {
    const account = await fetchDiscordAccount(result.token, members, fetchImpl);
    saveAccount(account, storage);
    return { account };
  } catch (error) {
    return { error: error.message };
  }
}

/**
 * Trace le compte dans Firebase (accounts/<id>) : l'admin y voit les
 * nouveaux comptes à relier au roster, et le bot les mêmes personnes.
 */
export async function recordAccount(account, firebaseUrl, fetchImpl = globalThis.fetch, now = Date.now()) {
  if (!account?.discordId) return;
  const base = `${firebaseUrl}/accounts/${account.discordId}`;
  const existing = await fetchImpl(`${base}.json`).then(r => (r.ok ? r.json() : null)).catch(() => null);
  await fetchImpl(`${base}.json`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      discordId: account.discordId,
      username: account.username || existing?.username || null,
      name: account.name,
      avatar: account.avatar || null,
      memberId: account.memberId || null,
      lastLoginAt: now,
      ...(existing?.createdAt ? {} : { createdAt: now }),
    }),
  }).catch(() => {});
}

/**
 * Comptes Discord connectés au site sans être reliés à un membre du roster,
 * du plus récent au plus ancien : ce que l'admin peut ajouter au roster.
 */
export function unlinkedAccounts(accounts = {}, members = []) {
  const linked = new Set(members.map(discordIdOf).filter(Boolean));
  return Object.values(accounts || {})
    .filter(account => /^\d{15,22}$/.test(String(account?.discordId || '')) && !linked.has(String(account.discordId)))
    .sort((a, b) => (Number(b.lastLoginAt) || 0) - (Number(a.lastLoginAt) || 0));
}
