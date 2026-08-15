/**
 * Mise en forme des rangs et des postes League of Legends.
 *
 * La table des tiers était dupliquée dans index.js et leaderboard-rank.js ;
 * elle vit ici désormais, avec les postes issus du LCU (assignedPosition).
 */
const LOL_TIER_LABELS_FR = {
  IRON: 'Fer', BRONZE: 'Bronze', SILVER: 'Argent', GOLD: 'Or', PLATINUM: 'Platine',
  EMERALD: 'Émeraude', DIAMOND: 'Diamant', MASTER: 'Maître',
  GRANDMASTER: 'Grand Maître', CHALLENGER: 'Challenger',
};

const LOL_DIVISION_LABELS = { I: '1', II: '2', III: '3', IV: '4' };

// Valeurs telles que renvoyées par le LCU (assignedPosition).
const POSITION_ICONS = { top: '⚔️', jungle: '🌲', middle: '🔮', bottom: '🏹', utility: '🛡️' };
const POSITION_LABELS = {
  top: 'Toplane', jungle: 'Jungle', middle: 'Midlane', bottom: 'Botlane', utility: 'Support',
};

function formatLolRank(rank) {
  if (!rank?.tier) return null;
  const tier = LOL_TIER_LABELS_FR[rank.tier] || rank.tier;
  const division = LOL_DIVISION_LABELS[rank.division] || rank.division || '';
  const lp = rank.lp != null ? `${rank.lp} LP` : '';
  return [tier, division, lp].filter(Boolean).join(' ');
}

/**
 * Poste le plus joué sur une série de games. Départage déterministe en cas
 * d'égalité (ordre alphabétique du code) : un même ensemble de games doit
 * toujours produire le même récap.
 */
function mostPlayedPosition(entries = []) {
  const counts = new Map();
  entries.forEach(entry => {
    const position = String(entry?.position || '').toLowerCase();
    if (!POSITION_LABELS[position]) return;
    counts.set(position, (counts.get(position) || 0) + 1);
  });
  if (counts.size === 0) return null;

  const [code, games] = [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0];
  return { code, label: POSITION_LABELS[code], emoji: POSITION_ICONS[code] || '', games };
}

/** « 🌲 Jungle », ou null si aucun poste connu. */
function formatPosition(position) {
  if (!position) return null;
  return `${position.emoji ? `${position.emoji} ` : ''}${position.label}`;
}

module.exports = {
  LOL_TIER_LABELS_FR, LOL_DIVISION_LABELS, POSITION_ICONS, POSITION_LABELS,
  formatLolRank, mostPlayedPosition, formatPosition,
};
