/**
 * Reset quotidien du point de référence des gains de paris, à 7h heure de
 * Paris. Ne poste plus rien automatiquement dans les salons trackés — seule
 * la commande /recap-paris affiche ces chiffres, à la demande, dans le salon
 * où elle est invoquée. Le reset périodique est conservé pour que la
 * commande continue de montrer un delta cohérent ("depuis hier 7h") plutôt
 * qu'un total qui grossit indéfiniment.
 */
const { fbGet, fbPut } = require('./firebase.js');

const RECAP_HOUR = 7; // heure locale Europe/Paris
const CHECK_INTERVAL_MS = 10 * 60 * 1000;
const STATE_PATH = 'betting/daily';

function parisParts(now = new Date()) {
  const fmt = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris', hour: '2-digit', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map(p => [p.type, p.value]));
  return { hour: Number(parts.hour), dateKey: `${parts.year}-${parts.month}-${parts.day}` };
}

async function dailyGains() {
  const wallets = await fbGet('betting/wallets').catch(() => null);
  return Object.entries(wallets || {})
    .map(([userId, wallet]) => ({
      userId, username: wallet.username || null,
      delta: (wallet.balance || 0) - (wallet.dayStartBalance ?? wallet.balance ?? 0),
    }))
    .filter(entry => entry.delta !== 0)
    .sort((a, b) => b.delta - a.delta);
}

async function resetDailyBaselines() {
  const wallets = await fbGet('betting/wallets').catch(() => null);
  await Promise.all(Object.entries(wallets || {}).map(([userId, wallet]) =>
    fbPut(`betting/wallets/${userId}`, { ...wallet, dayStartBalance: wallet.balance || 0 })));
}

function startDailyRecapScheduler() {
  const checkSchedule = async () => {
    const { hour, dateKey } = parisParts();
    const state = await fbGet(STATE_PATH).catch(() => null) || {};
    if (hour !== RECAP_HOUR || state.lastRecapDate === dateKey) return;
    await resetDailyBaselines();
    await fbPut(STATE_PATH, { lastRecapDate: dateKey });
  };

  checkSchedule().catch(error => console.error('[daily-recap:schedule]', error.message));
  setInterval(() => checkSchedule().catch(error => console.error('[daily-recap:schedule]', error.message)), CHECK_INTERVAL_MS);
}

module.exports = { startDailyRecapScheduler, dailyGains };
