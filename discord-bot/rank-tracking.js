/**
 * Accumulateur de gains/pertes de LP (LoL) et RR (Valorant) par compte, entre
 * deux récaps. Contrairement aux points de paris (wallet.js), il n'y a pas de
 * "solde" de LP/RR interrogeable à tout moment dans Firebase — on accumule
 * donc le delta de chaque game classée au fil de l'eau (appelé par index.js à
 * chaque fin de game).
 *
 * Trois fenêtres d'accumulation indépendantes (quotidien/hebdo/mensuel) sont
 * tenues à jour en parallèle pour chaque game — chaque récap (à sa propre
 * cadence) ne lit et ne remet à zéro QUE sa propre fenêtre, les deux autres
 * continuant d'accumuler sans interruption.
 */
const { fbGet, fbPut } = require('./firebase.js');

const PATH = 'rankTracking';
const PERIODS = ['daily', 'weekly', 'monthly'];

function safeKey(str) {
  return String(str || '').replace(/[.#$[\]/]/g, '_');
}

// Score LP comparable entre tiers/divisions (même échelle que odds.js) — permet
// de calculer un delta correct même quand une game fait monter/descendre de
// division ou de tier (le LP brut seul ne suffit pas dans ce cas).
const LOL_TIER_ORDER = ['IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'EMERALD', 'DIAMOND', 'MASTER', 'GRANDMASTER', 'CHALLENGER'];
const LOL_DIVISION_SCORE = { IV: 0, III: 1, II: 2, I: 3 };

function lolRankPoints(rank) {
  if (!rank?.tier) return null;
  const tierIndex = LOL_TIER_ORDER.indexOf(rank.tier);
  if (tierIndex < 0) return null;
  const divisionScore = LOL_DIVISION_SCORE[rank.division] ?? 0;
  return tierIndex * 400 + divisionScore * 100 + (rank.lp || 0);
}

async function recordRankGain(game, riotId, memberName, delta) {
  if (!riotId || !Number.isFinite(delta) || delta === 0) return;
  const key = safeKey(riotId);
  await Promise.all(PERIODS.map(async period => {
    const path = `${PATH}/${period}/${game}/${key}`;
    const existing = await fbGet(path).catch(() => null);
    const total = (existing?.delta || 0) + delta;
    await fbPut(path, { riotId, memberName, delta: total, updatedAt: Date.now() });
  }));
}

async function allRankGains(game, period = 'daily') {
  const data = await fbGet(`${PATH}/${period}/${game}`).catch(() => null);
  return Object.values(data || {}).filter(entry => entry.delta);
}

async function resetRankGains(game, period = 'daily') {
  const data = await fbGet(`${PATH}/${period}/${game}`).catch(() => null);
  await Promise.all(Object.entries(data || {}).map(([key, entry]) =>
    fbPut(`${PATH}/${period}/${game}/${key}`, { ...entry, delta: 0 })));
}

module.exports = { recordRankGain, allRankGains, resetRankGains, lolRankPoints };
