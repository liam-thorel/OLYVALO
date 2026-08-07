/**
 * Récap quotidien des LP (LoL, Solo/Duo et Flex distingués) et RR (Valorant)
 * gagnés/perdus, par personne ET par compte (un joueur avec plusieurs
 * comptes/smurfs voit chacun listé séparément) — envoyé chaque jour à 7h15
 * heure de Paris, 15 minutes après le récap des gains de paris
 * (daily-recap.js), dans les mêmes salons trackés. Un message distinct par
 * jeu (LoL / Valorant), LoL étant lui-même scindé en deux sections.
 */
const { EmbedBuilder } = require('discord.js');
const { fbGet, fbPut, watchNode } = require('./firebase.js');
const { allTrackedChannelIds } = require('./trackers.js');
const { filterRecapChannels } = require('./recap-settings.js');
const { allRankGains, resetRankGains } = require('./rank-tracking.js');

const RECAP_HOUR = 7;
const RECAP_MINUTE = 15;
const CHECK_INTERVAL_MS = 5 * 60 * 1000;
const STATE_PATH = 'rankTracking/schedulerState';
const TRIGGER_PATH = 'adminActions/lpRrRecapTrigger';

function parisParts(now = new Date()) {
  const fmt = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map(p => [p.type, p.value]));
  return { hour: Number(parts.hour), minute: Number(parts.minute), dateKey: `${parts.year}-${parts.month}-${parts.day}` };
}

function formatLolSection(gains, label, emoji) {
  if (gains.length === 0) return null;
  const lines = [...gains].sort((a, b) => b.delta - a.delta)
    .map(g => `${emoji} **${g.memberName}** (${g.riotId}) — ${g.delta >= 0 ? '+' : ''}${g.delta} LP`);
  return `**${label}**\n${lines.join('\n')}`;
}

async function sendToChannels(client, channelIds, embed, tag) {
  await Promise.all(channelIds.map(async channelId => {
    try {
      const channel = await client.channels.fetch(channelId);
      await channel.send({ embeds: [embed] });
    } catch (error) {
      console.error(`[lp-rr-recap:announce:${tag}]`, error.message);
    }
  }));
}

async function runLpRrRecap(client) {
  const [soloGains, flexGains, valorantGains] = await Promise.all([
    allRankGains('lol-solo'), allRankGains('lol-flex'), allRankGains('valorant'),
  ]);
  const channelIds = await filterRecapChannels(allTrackedChannelIds());

  if (channelIds.length > 0) {
    const lolSections = [
      formatLolSection(soloGains, 'Solo/Duo', '🔵'),
      formatLolSection(flexGains, 'Flex', '🟣'),
    ].filter(Boolean);
    if (lolSections.length > 0) {
      const lolEmbed = new EmbedBuilder()
        .setColor(0x0ac8b9)
        .setAuthor({ name: '📈 Récap LP quotidien (LoL)' })
        .setDescription(lolSections.join('\n\n'))
        .setTimestamp();
      await sendToChannels(client, channelIds, lolEmbed, 'lol');
    }

    if (valorantGains.length > 0) {
      const lines = [...valorantGains].sort((a, b) => b.delta - a.delta)
        .map(g => `🔴 **${g.memberName}** (${g.riotId}) — ${g.delta >= 0 ? '+' : ''}${g.delta} RR`);
      const valorantEmbed = new EmbedBuilder()
        .setColor(0xff4655)
        .setAuthor({ name: '📈 Récap RR quotidien (Valorant)' })
        .setDescription(lines.join('\n'))
        .setTimestamp();
      await sendToChannels(client, channelIds, valorantEmbed, 'valorant');
    }
  }

  await Promise.all([resetRankGains('lol-solo'), resetRankGains('lol-flex'), resetRankGains('valorant')]);
}

function startLpRrRecapScheduler(client) {
  const checkSchedule = async () => {
    const { hour, minute, dateKey } = parisParts();
    const state = await fbGet(STATE_PATH).catch(() => null) || {};
    if (hour !== RECAP_HOUR || minute < RECAP_MINUTE || state.lastRecapDate === dateKey) return;
    await runLpRrRecap(client);
    await fbPut(STATE_PATH, { lastRecapDate: dateKey });
  };

  checkSchedule().catch(error => console.error('[lp-rr-recap:schedule]', error.message));
  setInterval(() => checkSchedule().catch(error => console.error('[lp-rr-recap:schedule]', error.message)), CHECK_INTERVAL_MS);

  // Déclenchement manuel depuis le panel admin du site (bouton "tester"). Le
  // tout premier événement reçu à la connexion reflète l'état déjà existant
  // (pas un nouveau clic) — on l'ignore pour ne pas redéclencher au démarrage.
  let lastTriggerTs = null;
  let isFirstTriggerSnapshot = true;
  watchNode(TRIGGER_PATH, data => {
    const ts = data?.ts || null;
    if (isFirstTriggerSnapshot) { isFirstTriggerSnapshot = false; lastTriggerTs = ts; return; }
    if (!ts || ts === lastTriggerTs) return;
    lastTriggerTs = ts;
    runLpRrRecap(client).catch(error => console.error('[lp-rr-recap:manual]', error.message));
  }, error => console.error('[lp-rr-recap:trigger-watch]', error.message));
}

module.exports = { startLpRrRecapScheduler };
