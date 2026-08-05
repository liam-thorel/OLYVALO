/**
 * Reset hebdomadaire du classement des paris : chaque semaine, annonce les 3
 * meilleurs gains de la semaine (delta depuis le dernier reset) dans les
 * salons ayant eu des paris récemment, puis fige un nouveau point de départ.
 * Ne touche pas au solde réel des joueurs — seulement au point de référence
 * utilisé pour calculer le delta hebdomadaire.
 */
const { fbGet, fbPut } = require('./firebase.js');
const { weeklyLeaderboard, resetWeeklyBalances } = require('./wallet.js');

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const CHECK_INTERVAL_MS = 60 * 60 * 1000; // vérifie une fois par heure

async function ensureWeeklyState() {
  const existing = await fbGet('betting/weekly').catch(() => null);
  if (existing?.lastResetAt) return existing;
  const fresh = { lastResetAt: Date.now() };
  await fbPut('betting/weekly', fresh);
  return fresh;
}

async function recentBettingChannels(sinceTs) {
  const rounds = await fbGet('betting/rounds').catch(() => null);
  const channelIds = new Set();
  Object.values(rounds || {}).forEach(round => {
    if ((round.openedAt || 0) >= sinceTs && round.channelId) channelIds.add(round.channelId);
  });
  return [...channelIds];
}

function startWeeklyScheduler(client) {
  const check = async () => {
    const state = await ensureWeeklyState();
    if (Date.now() - state.lastResetAt < WEEK_MS) return;

    const top = await weeklyLeaderboard(3);
    const channels = await recentBettingChannels(state.lastResetAt);

    if (top.length > 0 && channels.length > 0) {
      const medals = ['🥇', '🥈', '🥉'];
      const lines = await Promise.all(top.map(async (entry, index) => {
        let name = entry.username;
        if (!name) name = (await client.users.fetch(entry.userId).catch(() => null))?.username || entry.userId;
        return `${medals[index]} **${name}** — ${entry.delta >= 0 ? '+' : ''}${entry.delta} points cette semaine`;
      }));
      const message = `📅 **Classement des paris de la semaine !**\n${lines.join('\n')}`;

      await Promise.all(channels.map(async channelId => {
        try {
          const channel = await client.channels.fetch(channelId);
          await channel.send(message);
        } catch (error) {
          console.error('[weekly:announce]', error.message);
        }
      }));
    }

    await resetWeeklyBalances();
    await fbPut('betting/weekly', { lastResetAt: Date.now() });
  };

  check().catch(error => console.error('[weekly:check]', error.message));
  setInterval(() => check().catch(error => console.error('[weekly:check]', error.message)), CHECK_INTERVAL_MS);
}

module.exports = { startWeeklyScheduler };
