const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { dailyGains } = require('../daily-recap.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('recap-paris')
    .setDescription('Affiche les gains/pertes de points de paris depuis le dernier récap quotidien'),

  async execute(interaction) {
    await interaction.deferReply();
    const gains = await dailyGains();

    if (gains.length === 0) {
      await interaction.editReply('Aucun gain/perte de points de paris depuis le dernier récap.');
      return;
    }

    const medals = ['🥇', '🥈', '🥉'];
    const lines = await Promise.all(gains.map(async (entry, index) => {
      let name = entry.username;
      if (!name) name = (await interaction.client.users.fetch(entry.userId).catch(() => null))?.username || entry.userId;
      const medal = medals[index] || '▫️';
      return `${medal} **${name}** — ${entry.delta >= 0 ? '+' : ''}${entry.delta} points de paris`;
    }));

    const embed = new EmbedBuilder()
      .setColor(0xffd166)
      .setAuthor({ name: '☀️ Récap des gains (Paris)' })
      .setDescription(lines.join('\n'))
      .setFooter({ text: 'Depuis le dernier récap quotidien' })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  },
};
