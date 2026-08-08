/**
 * Réenregistrement automatique du compte Riot courant sous le membre OLYCITY
 * choisi à l'installation (voir identity.js).
 *
 * C'est ce qui rend le suivi insensible aux changements de pseudo : l'entrée
 * écrite dans rosterOverlay/accounts/<memberId>/ est clée par le PUUID (stable
 * à vie), et son name/tag est rafraîchi à chaque fois que Riot renvoie un
 * nouveau Riot ID. Le bot n'a donc jamais besoin qu'on réassigne le compte à
 * la main dans #admin après un renommage.
 *
 * Un même compte Riot sert à Valorant ET à LoL : les jeux observés sont
 * fusionnés au lieu d'être écrasés, pour ne pas désactiver le suivi LoL d'un
 * compte simplement parce qu'il vient d'être vu en Valorant.
 */

const VALID_GAMES = ['valorant', 'lol'];

// Les clés Firebase RTDB interdisent . # $ [ ] /
function safeFirebaseKey(value) {
  return String(value).replace(/[.#$[\]/]/g, '_');
}

function splitRiotId(playerName) {
  const raw = String(playerName || '').trim();
  const hash = raw.lastIndexOf('#');
  if (hash <= 0) return { name: raw, tag: '' };
  return { name: raw.slice(0, hash), tag: raw.slice(hash + 1) };
}

/**
 * Clé stable de l'entrée : le PUUID quand on l'a (insensible au renommage),
 * sinon le Riot ID en dernier recours.
 */
function bindingKey({ puuid, playerName }) {
  const stable = String(puuid || '').trim();
  if (stable) return safeFirebaseKey(stable);
  const fallback = String(playerName || '').trim();
  return fallback ? safeFirebaseKey(fallback) : '';
}

function mergeGames(existing, incoming) {
  const merged = [...(Array.isArray(existing) ? existing : []), ...(Array.isArray(incoming) ? incoming : [incoming])]
    .map(game => String(game || '').toLowerCase())
    .filter(game => VALID_GAMES.includes(game));
  const unique = [...new Set(merged)];
  return unique.length ? unique : ['valorant'];
}

function bindingPayload({ playerName, puuid, memberName, games, now = Date.now(), existing = null }) {
  const { name, tag } = splitRiotId(playerName);
  return {
    name,
    tag,
    puuid: String(puuid || ''),
    playerName: String(playerName || ''),
    games: mergeGames(existing?.games, games),
    // Le suivi central LoL reste piloté depuis #admin : on ne le réactive pas
    // tout seul, on préserve simplement le réglage existant.
    monitoring: Boolean(existing?.monitoring),
    boundBy: 'olycity-live',
    boundMember: String(memberName || ''),
    updatedAt: now,
  };
}

/** Ce qui, s'il change, justifie une réécriture Firebase (évite un PUT par poll). */
function bindingSignature(payload) {
  return JSON.stringify({
    name: payload.name,
    tag: payload.tag,
    puuid: payload.puuid,
    games: payload.games,
    monitoring: payload.monitoring,
    member: payload.boundMember,
  });
}

/**
 * @param putFB (path, data) => Promise<boolean>
 * @param getFB (path) => Promise<any>   — optionnel, sert à fusionner l'existant
 */
function createAccountBinder({ putFB, getFB = null, log = () => {} } = {}) {
  const lastSignatures = new Map(); // chemin -> signature déjà publiée
  const lastPayloads = new Map();   // chemin -> dernier payload écrit
  const seededPaths = new Set();    // chemins dont l'existant a déjà été relu

  async function bind({ memberId, memberName, playerName, puuid, game }) {
    if (!memberId || !playerName) return { written: false, reason: 'incomplete' };
    const key = bindingKey({ puuid, playerName });
    if (!key) return { written: false, reason: 'incomplete' };

    const path = `rosterOverlay/accounts/${memberId}/${key}`;

    // Base de fusion : ce qu'on a déjà écrit pendant cette session, sinon
    // (au premier passage) ce qui existe déjà dans Firebase. Sans cette
    // mémoire, un compte vu en Valorant puis en LoL perdrait 'valorant'.
    let existing = lastPayloads.get(path) || null;
    if (!existing && getFB && !seededPaths.has(path)) {
      seededPaths.add(path);
      existing = await getFB(path).catch(() => null);
    }

    const payload = bindingPayload({ playerName, puuid, memberName, games: game, existing });
    const signature = bindingSignature(payload);
    if (lastSignatures.get(path) === signature) return { written: false, reason: 'unchanged' };

    const ok = await putFB(path, payload);
    if (!ok) {
      seededPaths.delete(path); // on retentera, existant compris
      return { written: false, reason: 'firebase-refused' };
    }

    const isRename = lastSignatures.has(path);
    lastSignatures.set(path, signature);
    lastPayloads.set(path, payload);
    log(isRename
      ? `Compte Riot mis à jour pour ${memberName} — ${playerName}`
      : `Compte Riot rattaché à ${memberName} — ${playerName}`);
    return { written: true, path, payload };
  }

  return { bind };
}

module.exports = {
  createAccountBinder,
  bindingKey,
  bindingPayload,
  bindingSignature,
  mergeGames,
  splitRiotId,
  safeFirebaseKey,
};
