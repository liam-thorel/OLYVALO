const { SlashCommandBuilder } = require('discord.js');
const { ensureRoster } = require('../roster.js');
const { historyFor, killDeathRatio, rankedOnly } = require('../stats.js');
const { awardsLeaderboard } = require('../valorant-awards.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('awards')
    .setDescription('Classement des masterchiasses, thirty bombs et ratio K/D Valorant du roster'),

  async execute(interaction) {
    await interaction.deferReply();
    const members = await ensureRoster();

    const ratios = await Promise.all(members.map(async member => {
      const entries = rankedOnly('valorant', await historyFor('valorant', member.riotIds));
      return { name: member.name, ratio: killDeathRatio(entries), games: entries.length };
    }));
    const ratioLines = ratios
      .filter(r => r.games > 0)
      .sort((a, b) => b.ratio - a.ratio)
      .map((r, index) => `${index + 1}. **${r.name}** — ${r.ratio.toFixed(2)} K/D`);

    const [masterchiasses, thirtyBombs, deathmatches] = await Promise.all([
      awardsLeaderboard('masterchiasse'),
      awardsLeaderboard('thirtyBomb'),
      awardsLeaderboard('deathmatch'),
    ]);
    const medals = ['🥇', '🥈', '🥉'];
    const masterchiasseLines = masterchiasses.map((e, i) => `${medals[i] || `${i + 1}.`} **${e.name}** — ${e.count}`);
    const thirtyBombLines = thirtyBombs.map((e, i) => `${medals[i] || `${i + 1}.`} **${e.name}** — ${e.count}`);
    const deathmatchLines = deathmatches.map((e, i) => `${medals[i] || `${i + 1}.`} **${e.name}** — ${e.count}`);

    const sections = [
      ratioLines.length ? `**📊 Ratio K/D**\n${ratioLines.join('\n')}` : null,
      masterchiasseLines.length ? `**😂 Masterchiasses**\n${masterchiasseLines.join('\n')}` : null,
      thirtyBombLines.length ? `**💥 Thirty bombs**\n${thirtyBombLines.join('\n')}` : null,
      deathmatchLines.length ? `**🔫 Deathmatches jouées**\n${deathmatchLines.join('\n')}` : null,
    ].filter(Boolean);

    if (sections.length === 0) {
      await interaction.editReply('Pas encore assez de games Valorant enregistrées.');
      return;
    }

    await interaction.editReply(`🏆 **Awards Valorant**\n\n${sections.join('\n\n')}`);
  },
};
