const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { ensureRoster } = require('../roster.js');
const { historyFor, averageKDA, averageHsPercent, rankedOnly } = require('../stats.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('valo-recap')
    .setDescription('Poste le récap Valorant Compétitif du roster dans ce salon (winrate, KDA moyen, HS%)'),

  async execute(interaction) {
    await interaction.deferReply();
    const members = await ensureRoster();

    const rows = await Promise.all(members.map(async member => {
      const entries = rankedOnly('valorant', await historyFor('valorant', member.riotIds));
      const withResult = entries.filter(e => typeof e.win === 'boolean');
      const wins = withResult.filter(e => e.win).length;
      return {
        name: member.name,
        games: entries.length,
        winRatePct: withResult.length ? Math.round((wins / withResult.length) * 100) : null,
        kda: averageKDA(entries),
        hs: averageHsPercent(entries),
      };
    }));

    const lines = rows
      .filter(row => row.games > 0)
      .sort((a, b) => b.games - a.games)
      .map(row => {
        const parts = [
          `${row.games} game(s)`,
          row.winRatePct != null ? `${row.winRatePct}% WR` : null,
          row.kda != null ? `${row.kda.toFixed(2)} KDA` : null,
          row.hs != null ? `${Math.round(row.hs)}% HS` : null,
        ].filter(Boolean).join(' · ');
        return `**${row.name}** — ${parts}`;
      });

    if (lines.length === 0) {
      await interaction.editReply('Pas encore de games Valorant Compétitif enregistrées.');
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(0xff4655)
      .setAuthor({ name: '🔴 Récap Valorant Compétitif du roster' })
      .setDescription(lines.join('\n'))
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  },
};
