/**
 * Affichage des rangs compétitifs Valorant.
 *
 * Index = tier numérique Riot (0-2 non classé, 3-26 Fer→Immortel par divisions
 * de 3, 27 Radiant) — même échelle que côté site (js/interactions.js).
 */
const VALORANT_TIER_NAMES = [
  'Non classé', 'Non classé', 'Non classé',
  'Fer 1', 'Fer 2', 'Fer 3',
  'Bronze 1', 'Bronze 2', 'Bronze 3',
  'Argent 1', 'Argent 2', 'Argent 3',
  'Or 1', 'Or 2', 'Or 3',
  'Platine 1', 'Platine 2', 'Platine 3',
  'Diamant 1', 'Diamant 2', 'Diamant 3',
  'Ascendant 1', 'Ascendant 2', 'Ascendant 3',
  'Immortel 1', 'Immortel 2', 'Immortel 3',
  'Radiant',
];

function formatValorantTier(tier) {
  if (tier == null) return null;
  return VALORANT_TIER_NAMES[tier] || null;
}

/**
 * « Ascendant 2 » seul, ou « Ascendant 2 33 RR » quand le RR est connu.
 * Le RR vaut 0 en début de palier : on teste `!= null`, pas la véracité.
 */
function formatValorantRank(tier, rr) {
  const label = formatValorantTier(tier);
  if (!label) return null;
  return rr == null || !Number.isFinite(Number(rr)) ? label : `${label} ${Number(rr)} RR`;
}

/**
 * Ligne de progression de fin de game :
 *   Ascendant 2 33 RR → **Ascendant 2 59 RR**
 *   Ascendant 2 90 RR → **Ascendant 3 12 RR** — Rank up ⬆️ !
 *
 * Retombe sur le tier seul quand Riot ne renvoie pas le RR (parties non
 * classées, ou competitiveupdates indisponible juste après la game).
 */
function buildRankProgressLine(rr) {
  if (!rr) return null;
  const { tierBefore, tier, before, after } = rr;

  const beforeLabel = formatValorantRank(tierBefore, before);
  const afterLabel = formatValorantRank(tier, after);

  if (!beforeLabel && !afterLabel) return null;
  if (!beforeLabel) return `📊 ${afterLabel}`;
  if (!afterLabel) return `📊 ${beforeLabel}`;

  // Rien n'a bougé du tout (aucun RR connu et même palier) : une flèche entre
  // deux libellés identiques n'apprendrait rien.
  if (beforeLabel === afterLabel) return `📊 ${afterLabel}`;

  const promotion = tierBefore != null && tier != null && tier !== tierBefore
    ? ` — Rank ${tier > tierBefore ? 'up ⬆️' : 'down ⬇️'} !`
    : '';
  return `📊 ${beforeLabel} → **${afterLabel}**${promotion}`;
}

module.exports = { VALORANT_TIER_NAMES, formatValorantTier, formatValorantRank, buildRankProgressLine };
