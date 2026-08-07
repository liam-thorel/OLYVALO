/**
 * Classement du roster par rang actuel — Valorant (Compétitif) et LoL
 * (SoloQ uniquement, queueId 420). Contrairement aux récaps (delta sur une
 * période), c'est une photo de l'état actuel : pour chaque membre, le rang
 * connu le plus récent (dernière game trackée de la file concernée). Mis à
 * jour périodiquement en ÉDITANT un message fixe dans un salon dédié
 * (discordConfig/leaderboardChannelId) plutôt qu'en spammant un nouveau
 * message à chaque refresh.
 */
const { EmbedBuilder } = require('discord.js');
const { fbGet, fbPut } = require('./firebase.js');
const { ensureRoster } = require('./roster.js');
const { historyFor, rankedOnly } = require('./stats.js');
const { lolRankPoints } = require('./rank-tracking.js');

const CHANNEL_PATH = 'discordConfig/leaderboardChannelId';
const MESSAGE_IDS_PATH = 'discordConfig/leaderboardMessageIds'; // { valorant, lolSolo }
const REFRESH_INTERVAL_MS = 20 * 60 * 1000; // 20 min

// Index = tier numérique Riot — même échelle que le reste du bot (index.js).
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
  return tier == null ? null : (VALORANT_TIER_NAMES[tier] || null);
}

const LOL_TIER_LABELS_FR = {
  IRON: 'Fer', BRONZE: 'Bronze', SILVER: 'Argent', GOLD: 'Or', PLATINUM: 'Platine',
  EMERALD: 'Émeraude', DIAMOND: 'Diamant', MASTER: 'Maître', GRANDMASTER: 'Grand Maître', CHALLENGER: 'Challenger',
};
const LOL_DIVISION_LABELS = { I: '1', II: '2', III: '3', IV: '4' };
function formatLolRank(rank) {
  if (!rank?.tier) return null;
  const tier = LOL_TIER_LABELS_FR[rank.tier] || rank.tier;
  const division = LOL_DIVISION_LABELS[rank.division] || rank.division || '';
  const lp = rank.lp != null ? `${rank.lp} LP` : '';
  return [tier, division, lp].filter(Boolean).join(' ');
}

const MEDALS = ['🥇', '🥈', '🥉'];

async function getChannelId() {
  return await fbGet(CHANNEL_PATH).catch(() => null);
}

// entries triées ts desc par historyFor() — entries[0] = game la plus récente.
async function buildValorantLeaderboardEmbed() {
  const members = await ensureRoster();
  const rows = await Promise.all(members.map(async member => {
    const entries = rankedOnly('valorant', await historyFor('valorant', member.riotIds));
    const latest = entries.find(e => e.tier != null);
    if (!latest) return null;
    return { name: member.name, tier: latest.tier, rr: latest.rr ?? 0 };
  }));

  const ranked = rows.filter(Boolean).sort((a, b) => b.tier - a.tier || b.rr - a.rr);
  if (ranked.length === 0) return null;

  const lines = ranked.map((row, i) => {
    const medal = MEDALS[i] || `${i + 1}.`;
    const tierLabel = formatValorantTier(row.tier) || '—';
    return `${medal} **${row.name}** — ${tierLabel} · ${row.rr} RR`;
  });

  return new EmbedBuilder()
    .setColor(0xff4655)
    .setAuthor({ name: '🔴 Classement Valorant Compétitif' })
    .setDescription(lines.join('\n'))
    .setFooter({ text: 'Rang le plus récent connu, mis à jour toutes les 20 min' })
    .setTimestamp();
}

async function buildLolSoloLeaderboardEmbed() {
  const members = await ensureRoster();
  const rows = await Promise.all(members.map(async member => {
    const entries = await historyFor('lol', member.riotIds);
    const latest = entries.find(e => e.queueId === 420 && e.rankAfter?.tier);
    if (!latest) return null;
    const points = lolRankPoints(latest.rankAfter);
    if (points == null) return null;
    return { name: member.name, rank: latest.rankAfter, points };
  }));

  const ranked = rows.filter(Boolean).sort((a, b) => b.points - a.points);
  if (ranked.length === 0) return null;

  const lines = ranked.map((row, i) => {
    const medal = MEDALS[i] || `${i + 1}.`;
    return `${medal} **${row.name}** — ${formatLolRank(row.rank) || '—'}`;
  });

  return new EmbedBuilder()
    .setColor(0x0ac8b9)
    .setAuthor({ name: '🔵 Classement LoL SoloQ' })
    .setDescription(lines.join('\n'))
    .setFooter({ text: 'Rang le plus récent connu, mis à jour toutes les 20 min' })
    .setTimestamp();
}

// Édite le message existant s'il y en a un (et qu'il est toujours là), sinon
// poste un nouveau message et retient son ID pour les prochains refreshs.
async function publishLeaderboard(client, key, embed) {
  const channelId = await getChannelId();
  if (!channelId || !embed) return;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel) return;

  const messageIds = await fbGet(MESSAGE_IDS_PATH).catch(() => null) || {};
  const existingId = messageIds[key];
  if (existingId) {
    const existing = await channel.messages.fetch(existingId).catch(() => null);
    if (existing) {
      await existing.edit({ embeds: [embed] }).catch(error => console.error(`[leaderboard:${key}:edit]`, error.message));
      return;
    }
  }

  const sent = await channel.send({ embeds: [embed] }).catch(error => {
    console.error(`[leaderboard:${key}:send]`, error.message);
    return null;
  });
  if (sent) await fbPut(`${MESSAGE_IDS_PATH}/${key}`, sent.id);
}

async function refreshLeaderboards(client) {
  const [valoEmbed, lolEmbed] = await Promise.all([
    buildValorantLeaderboardEmbed(),
    buildLolSoloLeaderboardEmbed(),
  ]);
  await publishLeaderboard(client, 'valorant', valoEmbed);
  await publishLeaderboard(client, 'lolSolo', lolEmbed);
}

function startLeaderboardScheduler(client) {
  const run = () => refreshLeaderboards(client).catch(error => console.error('[leaderboard:refresh]', error.message));
  run();
  setInterval(run, REFRESH_INTERVAL_MS);
}

module.exports = {
  startLeaderboardScheduler,
  buildValorantLeaderboardEmbed,
  buildLolSoloLeaderboardEmbed,
  CHANNEL_PATH,
};
