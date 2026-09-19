/**
 * Attribution des comptes — logique pure.
 *
 * Le rattachement d'un compte à un joueur se déduisait jusqu'ici de sa
 * POSITION : `riot` dans roster.json valait compte principal, tout ce qui
 * suivait valait smurf. Les comptes ajoutés depuis l'admin n'avaient donc
 * aucun rôle, et rien ne permettait de le leur donner.
 *
 * Cet écran rend la chose explicite : chaque compte porte son rôle, son
 * puuid, et le membre auquel il appartient.
 */

export const ROLES = ['main', 'smurf'];

const lower = value => String(value || '').trim().toLowerCase();

export function slugify(value) {
  return String(value || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-+|-+$)/g, '');
}

export function riotIdOf(account = {}) {
  if (account.playerName) return String(account.playerName).trim();
  const name = String(account.name || '').trim();
  const tag = String(account.tag || '').trim();
  return tag ? `${name}#${tag}` : name;
}

/**
 * Un PUUID Riot est un UUID canonique de 36 caractères. On refuse tout le
 * reste : un puuid mal saisi rattacherait silencieusement les parties de
 * quelqu'un d'autre, ou plus vraisemblablement de personne.
 */
export function isValidPuuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || '').trim());
}

/**
 * Rôle d'un compte.
 *
 * Le rôle EXPLICITE l'emporte toujours : c'est celui qu'un humain a choisi
 * sur cet écran. À défaut, on retombe sur la position dans roster.json, seule
 * source qui sépare encore `riot` de `smurfs`. Un compte ajouté depuis
 * l'admin sans rôle reste « inconnu » plutôt que d'être décrété principal.
 */
export function roleOf(row = {}) {
  const explicit = lower(row.role);
  if (ROLES.includes(explicit)) return explicit;
  if (row.source === 'roster.json') return row.position === 0 ? 'main' : 'smurf';
  return 'unknown';
}

/**
 * Toutes les lignes de compte, les deux sources réunies.
 *
 * Les comptes déclarés dans `data/roster.json` sont montrés mais NON
 * modifiables : ce fichier est versionné dans le dépôt, l'admin n'écrit que
 * dans Firebase. Les masquer donnerait une vue fausse du roster ; les rendre
 * modifiables ferait croire à une écriture qui n'arriverait jamais.
 */
export function attributionRows({ roster = [], overlay = null } = {}) {
  const rows = [];

  (Array.isArray(roster) ? roster : []).forEach(player => {
    const memberId = slugify(player?.name);
    [player?.riot, ...(player?.smurfs || [])]
      .filter(account => account?.name)
      .forEach((account, position) => {
        rows.push({
          source: 'roster.json', editable: false, key: '',
          memberId, member: player.name, position,
          riotId: riotIdOf(account), puuid: String(account.puuid || ''),
          region: String(account.region || ''), role: '', pendingDeletion: false,
        });
      });
  });

  Object.entries(overlay?.accounts || {}).forEach(([memberId, accounts]) => {
    const member = overlay?.members?.[memberId]?.name
      || (roster || []).find(player => slugify(player?.name) === memberId)?.name
      || memberId;
    Object.entries(accounts || {}).forEach(([key, account]) => {
      if (!account?.name && !account?.playerName) return;
      rows.push({
        source: 'rosterOverlay', editable: true, key,
        memberId, member, position: null,
        riotId: riotIdOf(account), puuid: String(account.puuid || ''),
        region: String(account.region || ''), role: String(account.role || ''),
        pendingDeletion: account.pendingDeletion === true,
        games: account.games, monitoring: account.monitoring,
      });
    });
  });

  return rows.sort((left, right) =>
    left.member.localeCompare(right.member, 'fr')
    || ROLES.indexOf(roleOf(left)) - ROLES.indexOf(roleOf(right))
    || left.riotId.localeCompare(right.riotId, 'fr'));
}

/**
 * PUUID déjà présent dans les données live, pour un Riot ID donné.
 *
 * Le PUUID appartient au COMPTE RIOT, pas au jeu : le script LoL publie le
 * sien (`summoner.puuid`) exactement comme le script Valorant publie le sien
 * (`entitlements.subject`), et le bot les résout depuis un index unique.
 *
 * On regarde donc ici avant d'appeler l'API Valorant : ça couvre les comptes
 * qui n'ont jamais joué à Valorant — que cette API ignore — et ça ne coûte
 * aucun quota.
 */
export function knownPuuidFor(riotId, pools = {}) {
  const wanted = lower(riotId);
  if (!wanted) return '';
  for (const pool of Object.values(pools)) {
    for (const [key, entry] of Object.entries(pool || {})) {
      if (!entry || typeof entry !== 'object') continue;
      const name = lower(entry.playerName || riotIdOf(entry));
      if (name !== wanted) continue;
      // Les clients Valorant sont indexés PAR puuid : quand la valeur ne le
      // répète pas, la clé le porte.
      const puuid = String(entry.puuid || '').trim() || (isValidPuuid(key) ? key : '');
      if (isValidPuuid(puuid)) return puuid.toLowerCase();
    }
  }
  return '';
}

/** Problèmes qu'un humain doit trancher avant tout nettoyage. */
export function attributionWarnings(rows = []) {
  const warnings = [];
  const byPuuid = new Map();
  const byRiotId = new Map();

  rows.forEach(row => {
    if (row.puuid) {
      if (!byPuuid.has(row.puuid)) byPuuid.set(row.puuid, []);
      byPuuid.get(row.puuid).push(row);
    }
    const key = lower(row.riotId);
    if (!byRiotId.has(key)) byRiotId.set(key, []);
    byRiotId.get(key).push(row);
  });

  byPuuid.forEach((group, puuid) => {
    if (group.length < 2) return;
    const membres = [...new Set(group.map(row => row.member))];
    warnings.push(membres.length > 1
      ? { level: 'error', message: `Le puuid ${puuid.slice(0, 8)}… est rattaché à ${membres.join(' et ')} — un compte ne peut appartenir qu’à une personne.` }
      : { level: 'warn', message: `${membres[0]} a ${group.length} entrées pour le même puuid : ${group.map(row => row.riotId).join(', ')}.` });
  });

  byRiotId.forEach((group, riotId) => {
    if (group.length < 2) return;
    warnings.push({ level: 'warn', message: `${riotId} est déclaré ${group.length} fois (${group.map(row => row.source).join(' + ')}).` });
  });

  // Par membre, au plus un compte principal.
  const mainsParMembre = new Map();
  rows.forEach(row => {
    if (roleOf(row) !== 'main') return;
    mainsParMembre.set(row.member, (mainsParMembre.get(row.member) || 0) + 1);
  });
  mainsParMembre.forEach((count, member) => {
    if (count > 1) warnings.push({ level: 'error', message: `${member} a ${count} comptes marqués « principal ».` });
  });

  return warnings;
}

/** Comptes marqués à supprimer, et le chemin Firebase de chacun. */
export function deletionPlan(rows = []) {
  return rows
    .filter(row => row.pendingDeletion && row.editable && row.key)
    .map(row => ({
      member: row.member, riotId: row.riotId,
      path: `rosterOverlay/accounts/${row.memberId}/${row.key}`,
    }));
}

/**
 * Chemins à écrire pour déplacer un compte vers un autre membre.
 *
 * Firebase n'a pas de « déplacer » : on écrit sous la nouvelle clé avant
 * d'effacer l'ancienne, jamais l'inverse. Une coupure entre les deux laisse
 * un doublon — visible et réparable — plutôt qu'un compte perdu.
 */
export function reassignPlan(row, targetMemberId) {
  if (!row?.editable || !row.key || !targetMemberId || targetMemberId === row.memberId) return null;
  return {
    from: `rosterOverlay/accounts/${row.memberId}/${row.key}`,
    to: `rosterOverlay/accounts/${targetMemberId}/${row.key}`,
  };
}
