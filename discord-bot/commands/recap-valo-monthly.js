const { SlashCommandBuilder } = require('discord.js');
const { buildValoRecapEmbeds } = require('../valo-daily-recap.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('recap-valo-monthly')
    .setDescription('Affiche le récap mensuel Valorant Compétitif du roster (RR, winrate, KDA, HS%)'),

  async execute(interaction) {
    await interaction.deferReply();
    const embeds = await buildValoRecapEmbeds('monthly', null);
    if (embeds.length === 0) {
      await interaction.editReply('Pas encore de games Valorant Compétitif enregistrées.');
      return;
    }
    await interaction.editReply({ embeds });
  },
};
