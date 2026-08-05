const { fbGet, fbPut } = require('./firebase.js');

const DAILY_GRANT = 500;
const STARTING_BALANCE = 500; // premier contact avec le bot = premier crédit du jour

function todayKey() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

// Crédite les 500 points du jour si pas déjà fait, puis retourne le solde à jour.
// Le pseudo est mémorisé sur le wallet à chaque passage — c'est ce qui permet
// au site (qui n'a pas accès à l'API Discord) d'afficher un classement lisible.
async function ensureDailyGrant(userId, username) {
  const wallet = await fbGet(`betting/wallets/${userId}`).catch(() => null);
  const today = todayKey();

  if (!wallet) {
    const fresh = { balance: STARTING_BALANCE, lastGrantDate: today, username: username || null };
    await fbPut(`betting/wallets/${userId}`, fresh);
    return fresh;
  }

  const current = username && username !== wallet.username ? { ...wallet, username } : wallet;
  if (wallet.lastGrantDate === today) {
    if (current !== wallet) await fbPut(`betting/wallets/${userId}`, current);
    return current;
  }

  const updated = { ...current, balance: (current.balance || 0) + DAILY_GRANT, lastGrantDate: today };
  await fbPut(`betting/wallets/${userId}`, updated);
  return updated;
}

async function getBalance(userId, username) {
  const wallet = await ensureDailyGrant(userId, username);
  return wallet.balance;
}

// Retourne false (et ne débite rien) si le solde est insuffisant.
async function debit(userId, amount, username) {
  const wallet = await ensureDailyGrant(userId, username);
  if (wallet.balance < amount) return false;
  await fbPut(`betting/wallets/${userId}`, { ...wallet, balance: wallet.balance - amount });
  return true;
}

async function credit(userId, amount, username) {
  const wallet = await ensureDailyGrant(userId, username);
  await fbPut(`betting/wallets/${userId}`, { ...wallet, balance: wallet.balance + amount });
}

// Met à jour la série de paris gagnants d'affilée d'un utilisateur, retourne la série en cours.
async function recordBetOutcome(userId, won, username) {
  const wallet = await ensureDailyGrant(userId, username);
  const currentStreak = won ? (wallet.currentStreak || 0) + 1 : 0;
  const bestStreak = Math.max(wallet.bestStreak || 0, currentStreak);
  await fbPut(`betting/wallets/${userId}`, { ...wallet, currentStreak, bestStreak });
  return currentStreak;
}

async function leaderboard(limit = 10) {
  const wallets = await fbGet('betting/wallets').catch(() => null);
  return Object.entries(wallets || {})
    .map(([userId, wallet]) => ({ userId, username: wallet.username || null, balance: wallet.balance || 0 }))
    .sort((a, b) => b.balance - a.balance)
    .slice(0, limit);
}

// Classement des gains de la semaine (delta depuis le dernier reset hebdo).
async function weeklyLeaderboard(limit = 10) {
  const wallets = await fbGet('betting/wallets').catch(() => null);
  return Object.entries(wallets || {})
    .map(([userId, wallet]) => ({
      userId, username: wallet.username || null,
      delta: (wallet.balance || 0) - (wallet.weekStartBalance ?? wallet.balance ?? 0),
    }))
    .filter(entry => entry.delta !== 0)
    .sort((a, b) => b.delta - a.delta)
    .slice(0, limit);
}

// Fige le solde actuel de chacun comme nouveau point de départ de la semaine.
async function resetWeeklyBalances() {
  const wallets = await fbGet('betting/wallets').catch(() => null);
  await Promise.all(Object.entries(wallets || {}).map(([userId, wallet]) =>
    fbPut(`betting/wallets/${userId}`, { ...wallet, weekStartBalance: wallet.balance || 0 })));
}

module.exports = {
  getBalance, debit, credit, recordBetOutcome, leaderboard, weeklyLeaderboard, resetWeeklyBalances, DAILY_GRANT,
};
