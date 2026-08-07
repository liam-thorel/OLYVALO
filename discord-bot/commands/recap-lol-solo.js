const { SlashCommandBuilder } = require('discord.js');
const { buildQueueRecapEmbeds } = require('../lol-recap.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('recap-lol-solo')
    .setDescription('Affiche le récap LoL SoloQ du roster (LP, winrate, KDA, CS)'),

  async execute(interaction) {
    await interaction.deferReply();
    const embeds = await buildQueueRecapEmbeds('solo', null);
    if (embeds.length === 0) {
      await interaction.editReply('Pas encore de games SoloQ enregistrées.');
      return;
    }
    await interaction.editReply({ embeds });
  },
};
