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
/**
 * Clé Firebase stable pour un compte, dérivée de son Riot ID.
 *
 * Déterministe à dessein : modifier deux fois un compte de roster.json doit
 * réécrire la MÊME entrée d'override, pas en créer une seconde. Une clé
 * aléatoire (fbPost) fabriquerait exactement les doublons qu'on cherche à
 * supprimer.
 */
export function overlayKeyFor(riotId) {
  // Firebase interdit . # $ [ ] / ; les espaces passent mais doivent être
  // encodés dans l'URL à chaque lecture — un aller-retour de trop pour une
  // clé qu'on construit nous-mêmes.
  return `oly-${String(riotId || '').toLowerCase().replace(/[.#$[\]/\s]+/g, '_')}`;
}

/**
 * Clé de regroupement : le Riot ID, et lui seul.
 *
 * Regrouper aussi par puuid paraissait plus malin — deux noms pour un même
 * compte, une seule carte. Mais c'est exactement le doublon qu'on cherche à
 * NETTOYER : la fusion le faisait disparaître de l'écran, une des deux
 * entrées l'emportant en silence tandis que l'autre restait dans Firebase.
 *
 * On ne regroupe donc que ce qui décrit la même DÉCLARATION — le même Riot ID
 * vu dans roster.json et dans rosterOverlay. Le reste est signalé.
 */
function identityKey(row) {
  return lower(row.riotId);
}

/**
 * Fusionne les entrées qui décrivent le MÊME compte.
 *
 * roster.json et rosterOverlay peuvent parler du même compte — c'est même le
 * cas normal dès qu'on renseigne un puuid sur un compte du roster. Les
 * afficher séparément donnait deux cartes pour un seul compte, dont une
 * verrouillée : impossible d'en faire quoi que ce soit.
 */
function mergeRows(rows) {
  const byIdentity = new Map();
  const order = [];

  rows.forEach(row => {
    const key = identityKey(row);
    if (!byIdentity.has(key)) {
      byIdentity.set(key, {
        ...row, sources: [row.source], members: [row.member],
        overlayKeys: row.key ? [row.key] : [],
      });
      order.push(key);
      return;
    }
    const merged = byIdentity.get(key);
    merged.sources.push(row.source);
    // Un même Riot ID rattaché à deux personnes est une erreur, pas une
    // fusion : on garde la trace pour la signaler sur la carte.
    if (!merged.members.includes(row.member)) merged.members.push(row.member);
    // Deux entrées d'admin pour un même Riot ID : l'une est de trop, et sans
    // cette trace la seconde disparaîtrait derrière la première.
    if (row.key && !merged.overlayKeys.includes(row.key)) merged.overlayKeys.push(row.key);
    // L'override l'emporte sur le dépôt : c'est lui qu'un humain a réglé.
    if (row.source === 'rosterOverlay') {
      merged.key = row.key;
      merged.memberId = row.memberId;
      merged.member = row.member;
      merged.role = row.role || merged.role;
      merged.puuid = row.puuid || merged.puuid;
      merged.region = row.region || merged.region;
      merged.pendingDeletion = row.pendingDeletion;
      merged.games = row.games;
      merged.monitoring = row.monitoring;
    } else {
      merged.position = row.position;
      merged.puuid = merged.puuid || row.puuid;
      merged.region = merged.region || row.region;
    }
    merged.declaredInRepo = merged.declaredInRepo || row.source === 'roster.json';
  });

  return order.map(key => {
    const row = byIdentity.get(key);
    // Tout est modifiable : une carte du dépôt sans override en crée un à la
    // première modification. Seule la SUPPRESSION diffère — voir `removable`.
    return { ...row, editable: true, removable: !row.declaredInRepo };
  });
}

export function attributionRows({ roster = [], overlay = null } = {}) {
  const rows = [];

  (Array.isArray(roster) ? roster : []).forEach(player => {
    const memberId = slugify(player?.name);
    [player?.riot, ...(player?.smurfs || [])]
      .filter(account => account?.name)
      .forEach((account, position) => {
        rows.push({
          source: 'roster.json', declaredInRepo: true, key: '',
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
        hidden: account.hidden === true,
        source: 'rosterOverlay', declaredInRepo: false, key,
        memberId, member, position: null,
        riotId: riotIdOf(account), puuid: String(account.puuid || ''),
        region: String(account.region || ''), role: String(account.role || ''),
        pendingDeletion: account.pendingDeletion === true,
        games: account.games, monitoring: account.monitoring,
      });
    });
  });

  return annotateDuplicates(mergeRows(rows)).sort((left, right) =>
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

/**
 * Annote chaque carte du doublon dont elle fait partie.
 *
 * Trois natures, qui ne se règlent pas pareil — d'où la distinction plutôt
 * qu'un « doublon » indifférencié :
 *
 *  - `cross-member` : un même Riot ID rattaché à deux personnes. C'est une
 *    erreur d'attribution, pas un doublon : il faut corriger le propriétaire
 *    avant de supprimer quoi que ce soit.
 *  - `renamed` : deux Riot ID différents pour un même puuid. Le joueur s'est
 *    renommé ; l'ancienne entrée peut partir, mais c'est un choix — son
 *    historique reste lisible tant qu'elle existe.
 *  - `same-name` : deux entrées de même pseudo sans puuid pour trancher. On
 *    ne peut PAS conclure : ce sont peut-être deux comptes distincts.
 */
export function annotateDuplicates(rows = []) {
  const byPuuid = new Map();
  rows.forEach(row => {
    if (!row.puuid) return;
    const key = lower(row.puuid);
    if (!byPuuid.has(key)) byPuuid.set(key, []);
    byPuuid.get(key).push(row);
  });

  const byShortName = new Map();
  rows.forEach(row => {
    const short = lower(String(row.riotId).split('#')[0]);
    if (!short) return;
    if (!byShortName.has(short)) byShortName.set(short, []);
    byShortName.get(short).push(row);
  });

  return rows.map(row => {
    if (row.overlayKeys && row.overlayKeys.length > 1) {
      return { ...row, duplicate: { kind: 'redundant', with: [], members: [], keys: row.overlayKeys } };
    }
    if (row.members && row.members.length > 1) {
      return { ...row, duplicate: { kind: 'cross-member', with: [], members: row.members } };
    }

    const memePuuid = (byPuuid.get(lower(row.puuid)) || []).filter(other => other !== row);
    if (memePuuid.length) {
      return {
        ...row,
        duplicate: {
          kind: 'renamed',
          with: memePuuid.map(other => other.riotId),
          members: [...new Set(memePuuid.map(other => other.member))],
        },
      };
    }

    // Sans puuid, on ne peut rien affirmer : deux comptes peuvent
    // légitimement partager un pseudo à des tags différents.
    if (row.puuid) return { ...row, duplicate: null };
    const memeNom = (byShortName.get(lower(String(row.riotId).split('#')[0])) || [])
      .filter(other => other !== row && !other.puuid);
    if (!memeNom.length) return { ...row, duplicate: null };
    return { ...row, duplicate: { kind: 'same-name', with: memeNom.map(other => other.riotId), members: [] } };
  });
}

/** Phrase affichée sur la carte, selon la nature du doublon. */
export function duplicateLabel(duplicate) {
  if (!duplicate) return '';
  const autres = duplicate.with.join(', ');
  if (duplicate.kind === 'cross-member') {
    return `Rattaché à ${duplicate.members.join(' et ')} — un compte n’appartient qu’à une personne.`;
  }
  if (duplicate.kind === 'redundant') {
    return `${duplicate.keys.length} entrées dans l’admin pour ce même compte — une seule est utilisée.`;
  }
  if (duplicate.kind === 'renamed') return `Même PUUID que ${autres} — renommage probable.`;
  return `Même pseudo que ${autres}, sans PUUID pour trancher.`;
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

/**
 * Comptes déclarés UNIQUEMENT dans data/roster.json.
 *
 * Ce sont eux qui empêchent de se passer du fichier : le seul identifiant
 * commun aux deux sources est le Riot ID, donc un compte absent de l'admin
 * disparaîtrait purement et simplement si on cessait de lire le dépôt.
 *
 * Les reprendre dans Firebase rend le fichier redondant — et cesser de le
 * lire devient alors sans conséquence.
 */
export function adoptionPlan(rows = []) {
  return rows
    .filter(row => row.declaredInRepo && !row.key)
    .map(row => {
      const [name, tag = ''] = String(row.riotId).split('#');
      const role = roleOf(row);
      return {
        member: row.member, memberId: row.memberId, riotId: row.riotId,
        path: `rosterOverlay/accounts/${row.memberId}/${overlayKeyFor(row.riotId)}`,
        value: {
          name, tag, region: row.region || '', puuid: row.puuid || '',
          // Le rôle était porté par la POSITION dans roster.json ; on le rend
          // explicite au passage, sinon l'information se perdrait.
          role: role === 'unknown' ? '' : role,
          games: row.games || ['valorant'],
          source: 'roster.json', addedAt: Date.now(),
        },
      };
    });
}

/**
 * Ce qu'il faut faire des comptes marqués.
 *
 * Deux gestes distincts, parce que les deux sources ne se suppriment pas de
 * la même façon :
 *
 *  - `delete` : l'entrée n'existe que dans Firebase, on l'efface ;
 *  - `hide` : le compte est déclaré dans data/roster.json, versionné dans le
 *    dépôt. L'admin ne peut pas l'en retirer — on pose donc un drapeau que
 *    les lecteurs de roster respectent. Le compte disparaît partout sans
 *    qu'il faille un commit, et son historique reste lisible si on revient.
 */
export function deletionPlan(rows = []) {
  return rows
    .filter(row => row.pendingDeletion)
    .map(row => (row.removable && row.key
      ? { action: 'delete', member: row.member, riotId: row.riotId, path: `rosterOverlay/accounts/${row.memberId}/${row.key}` }
      : { action: 'hide', member: row.member, riotId: row.riotId, memberId: row.memberId, key: row.key || overlayKeyFor(row.riotId) }));
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
