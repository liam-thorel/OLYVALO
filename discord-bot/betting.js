const { fbGet, fbPut } = require('./firebase.js');
const { estimateOdds } = require('./odds.js');
const { debit, credit, recordBetOutcome } = require('./wallet.js');

const BETTING_WINDOW_MS = 5 * 60 * 1000;

function roundKey(game, matchId) {
  return `${game}_${String(matchId).replace(/[.#$[\]/]/g, '_')}`;
}

// Tous les paris d'un utilisateur, tous rounds confondus (pour /mybets).
async function betsForUser(userId) {
  const rounds = await fbGet('betting/rounds').catch(() => null);
  return Object.entries(rounds || {})
    .filter(([, round]) => round.bets?.[userId])
    .map(([key, round]) => ({ key, round, bet: round.bets[userId] }))
    .sort((a, b) => (b.bet.placedAt || 0) - (a.bet.placedAt || 0));
}

// Ouvre un round de paris pour une game qui vient de démarrer. Idempotent :
// si un round existe déjà pour ce match (ex: un 2e joueur OLYCITY détecté dans
// la même game), retourne le round existant sans le recréer.
async function openRound({ game, matchId, channelId, rosterPlayers }) {
  const key = roundKey(game, matchId);
  const existing = await fbGet(`betting/rounds/${key}`).catch(() => null);
  if (existing) return { key, round: existing, isNew: false };

  const { oddsWin, oddsLose, explanation, probability } = await estimateOdds(game, rosterPlayers);
  const round = {
    game, matchId, channelId,
    players: rosterPlayers.map(p => p.member.name),
    oddsWin, oddsLose, explanation, probability,
    status: 'open',
    openedAt: Date.now(),
    closesAt: Date.now() + BETTING_WINDOW_MS,
  };
  await fbPut(`betting/rounds/${key}`, round);
  return { key, round, isNew: true };
}

// Round de paris actuellement ouvert dans un salon donné (pour /bet, qui ne
// connaît que le salon où la commande est tapée, pas le matchId).
async function findOpenRoundForChannel(channelId) {
  const rounds = await fbGet('betting/rounds').catch(() => null);
  const now = Date.now();
  const open = Object.entries(rounds || {})
    .filter(([, round]) => round.channelId === channelId && round.status === 'open' && round.closesAt > now)
    .sort(([, a], [, b]) => b.openedAt - a.openedAt);
  if (open.length === 0) return null;
  const [key, round] = open[0];
  return { key, round };
}

// Associe le message Discord (boutons de pari) au round, pour pouvoir désactiver
// les boutons à la fermeture.
async function attachMessage(key, messageId) {
  const round = await fbGet(`betting/rounds/${key}`).catch(() => null);
  if (!round) return;
  await fbPut(`betting/rounds/${key}`, { ...round, messageId });
}

async function closeRound(key) {
  const round = await fbGet(`betting/rounds/${key}`).catch(() => null);
  if (!round || round.status !== 'open') return null;
  const updated = { ...round, status: 'closed' };
  await fbPut(`betting/rounds/${key}`, updated);
  return updated;
}

async function placeBet(key, userId, username, choice, amount) {
  const round = await fbGet(`betting/rounds/${key}`).catch(() => null);
  if (!round) return { ok: false, reason: 'no-round' };
  if (round.status !== 'open' || Date.now() > round.closesAt) return { ok: false, reason: 'closed' };

  const existingBet = await fbGet(`betting/rounds/${key}/bets/${userId}`).catch(() => null);
  if (existingBet) return { ok: false, reason: 'already-bet' };

  const debited = await debit(userId, amount, username);
  if (!debited) return { ok: false, reason: 'insufficient-funds' };

  await fbPut(`betting/rounds/${key}/bets/${userId}`, { username, choice, amount, placedAt: Date.now() });
  return { ok: true, odds: choice === 'win' ? round.oddsWin : round.oddsLose };
}

// outcome: 'win' | 'lose' — issue réelle de la game pour l'équipe OLYCITY suivie.
async function resolveRound(key, outcome) {
  const round = await fbGet(`betting/rounds/${key}`).catch(() => null);
  if (!round || round.status === 'resolved' || round.status === 'cancelled') return null;

  const odds = outcome === 'win' ? round.oddsWin : round.oddsLose;
  const bets = await fbGet(`betting/rounds/${key}/bets`).catch(() => null);
  const results = [];
  for (const [userId, bet] of Object.entries(bets || {})) {
    const won = bet.choice === outcome;
    const payout = won ? Math.round(bet.amount * odds) : 0;
    if (won) await credit(userId, payout, bet.username);
    const streak = await recordBetOutcome(userId, won, bet.username);
    results.push({ userId, username: bet.username, choice: bet.choice, amount: bet.amount, won, payout, streak });
  }

  await fbPut(`betting/rounds/${key}`, { ...round, status: 'resolved', outcome, resolvedAt: Date.now() });
  return { round, results };
}

// Remboursement intégral — game annulée/remake, ou résultat jamais capturé.
async function cancelRound(key) {
  const round = await fbGet(`betting/rounds/${key}`).catch(() => null);
  if (!round || round.status === 'resolved' || round.status === 'cancelled') return null;

  const bets = await fbGet(`betting/rounds/${key}/bets`).catch(() => null);
  for (const [userId, bet] of Object.entries(bets || {})) {
    await credit(userId, bet.amount, bet.username);
  }
  await fbPut(`betting/rounds/${key}`, { ...round, status: 'cancelled', resolvedAt: Date.now() });
  return round;
}

module.exports = {
  roundKey, openRound, closeRound, placeBet, resolveRound, cancelRound,
  findOpenRoundForChannel, attachMessage, betsForUser, BETTING_WINDOW_MS,
};
