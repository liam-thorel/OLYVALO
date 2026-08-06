/**
 * Récap quotidien des gains (paris + récompenses de participation), envoyé
 * chaque jour à 7h heure de Paris dans tous les salons qui trackent au moins
 * un joueur — tous jeux et serveurs confondus.
 *
 * Le delta est calculé depuis `dayStartBalance`, un point de référence par
 * wallet remis à zéro à chaque récap. Le bouton de test du panel admin du
 * site déclenche exactement la même fonction (même calcul, même remise à
 * zéro) — un test manuel décale donc légèrement la fenêtre "depuis hier 7h"
 * du lendemain, ce qui est un compromis acceptable pour un outil de test.
 */
const { EmbedBuilder } = require('discord.js');
const { fbGet, fbPut, watchNode } = require('./firebase.js');
const { allTrackedChannelIds } = require('./trackers.js');

const RECAP_HOUR = 7; // heure locale Europe/Paris
const CHECK_INTERVAL_MS = 10 * 60 * 1000;
const STATE_PATH = 'betting/daily';
const TRIGGER_PATH = 'adminActions/dailyRecapTrigger';

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

async function runDailyRecap(client) {
  const gains = await dailyGains();
  const channelIds = allTrackedChannelIds();

  if (gains.length > 0 && channelIds.length > 0) {
    const medals = ['🥇', '🥈', '🥉'];
    const lines = await Promise.all(gains.map(async (entry, index) => {
      let name = entry.username;
      if (!name) name = (await client.users.fetch(entry.userId).catch(() => null))?.username || entry.userId;
      const medal = medals[index] || '▫️';
      return `${medal} **${name}** — ${entry.delta >= 0 ? '+' : ''}${entry.delta} points de paris`;
    }));
    const embed = new EmbedBuilder()
      .setColor(0xffd166)
      .setAuthor({ name: '☀️ Récap quotidien (Paris)' })
      .setDescription(lines.join('\n'))
      .setFooter({ text: 'Gains/pertes de points de paris depuis hier 7h' })
      .setTimestamp();

    await Promise.all(channelIds.map(async channelId => {
      try {
        const channel = await client.channels.fetch(channelId);
        await channel.send({ embeds: [embed] });
      } catch (error) {
        console.error('[daily-recap:announce]', error.message);
      }
    }));
  }

  await resetDailyBaselines();
}

function startDailyRecapScheduler(client) {
  const checkSchedule = async () => {
    const { hour, dateKey } = parisParts();
    const state = await fbGet(STATE_PATH).catch(() => null) || {};
    if (hour !== RECAP_HOUR || state.lastRecapDate === dateKey) return;
    await runDailyRecap(client);
    await fbPut(STATE_PATH, { lastRecapDate: dateKey });
  };

  checkSchedule().catch(error => console.error('[daily-recap:schedule]', error.message));
  setInterval(() => checkSchedule().catch(error => console.error('[daily-recap:schedule]', error.message)), CHECK_INTERVAL_MS);

  // Déclenchement manuel depuis le panel admin du site (bouton "tester"), via
  // un timestamp écrit dans Firebase et surveillé en temps réel. Le tout
  // premier événement reçu à la connexion reflète juste l'état déjà existant
  // (pas un nouveau clic) — on l'ignore pour ne pas redéclencher au démarrage.
  let lastTriggerTs = null;
  let isFirstTriggerSnapshot = true;
  watchNode(TRIGGER_PATH, data => {
    const ts = data?.ts || null;
    if (isFirstTriggerSnapshot) { isFirstTriggerSnapshot = false; lastTriggerTs = ts; return; }
    if (!ts || ts === lastTriggerTs) return;
    lastTriggerTs = ts;
    runDailyRecap(client).catch(error => console.error('[daily-recap:manual]', error.message));
  }, error => console.error('[daily-recap:trigger-watch]', error.message));
}

module.exports = { startDailyRecapScheduler };
