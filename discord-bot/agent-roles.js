/**
 * Rôle d'agent Valorant (Duelliste / Initiateur / Sentinelle / Contrôleur).
 *
 * La table vient de data/roles.json sur le site, comme le roster : c'est déjà
 * la source de vérité maintenue à la main pour les pages Comps, inutile d'en
 * tenir une seconde copie qui divergerait au prochain agent.
 *
 * Le réseau n'est pas garanti au moment d'un récap : en cas d'échec, la ligne
 * de rôle est simplement omise plutôt que de faire échouer tout le message.
 */
const { ROLES_URL } = require('./config.js');

const REFRESH_MS = 6 * 60 * 60 * 1000;

const ROLE_EMOJIS = { D: '⚔️', I: '🔍', S: '🛡️', C: '🌫️' };
const FALLBACK_LABELS = { D: 'Duelliste', I: 'Initiateur', S: 'Sentinelle', C: 'Contrôleur' };

let cache = { roles: {}, labels: FALLBACK_LABELS, fetchedAt: 0 };

async function ensureAgentRoles(force = false) {
  if (!force && cache.fetchedAt && Date.now() - cache.fetchedAt < REFRESH_MS) return cache;
  try {
    const response = await fetch(ROLES_URL);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    cache = {
      roles: data?.roles || {},
      labels: { ...FALLBACK_LABELS, ...(data?.labels || {}) },
      fetchedAt: Date.now(),
    };
  } catch (error) {
    console.error('[agent-roles]', error.message);
    // On garde le cache précédent s'il existe ; sinon la table reste vide et
    // le rôle sera simplement absent du récap.
    cache = { ...cache, fetchedAt: Date.now() };
  }
  return cache;
}

/**
 * Rôle le plus joué sur une série de games. En cas d'égalité, on départage par
 * le nombre d'agents distincts joués dans ce rôle puis par ordre alphabétique
 * du code — un récap doit être reproductible, pas dépendre de l'ordre d'arrivée.
 */
function mostPlayedRole(entries = [], table = cache) {
  const roles = table?.roles || {};
  const counts = new Map();
  const distinct = new Map();

  entries.forEach(entry => {
    const agent = entry?.champion?.name;
    const code = agent && roles[agent];
    if (!code) return;
    counts.set(code, (counts.get(code) || 0) + 1);
    if (!distinct.has(code)) distinct.set(code, new Set());
    distinct.get(code).add(agent);
  });

  if (counts.size === 0) return null;

  const [code] = [...counts.entries()].sort((left, right) =>
    right[1] - left[1]
    || distinct.get(right[0]).size - distinct.get(left[0]).size
    || left[0].localeCompare(right[0]))[0];

  const labels = table?.labels || FALLBACK_LABELS;
  return { code, label: labels[code] || code, emoji: ROLE_EMOJIS[code] || '', games: counts.get(code) };
}

/** « 🛡️ Sentinelle », ou null si aucun agent connu n'a été joué. */
function formatRole(role) {
  if (!role) return null;
  return `${role.emoji ? `${role.emoji} ` : ''}${role.label}`;
}

module.exports = { ensureAgentRoles, mostPlayedRole, formatRole, ROLE_EMOJIS, FALLBACK_LABELS };
