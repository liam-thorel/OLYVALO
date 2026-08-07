const { SlashCommandBuilder } = require('discord.js');
const { buildQueueRecapEmbeds } = require('../lol-recap.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('recap-lol-flex')
    .setDescription('Affiche le récap LoL Flex du roster (LP, winrate, KDA, CS)'),

  async execute(interaction) {
    await interaction.deferReply();
    const embeds = await buildQueueRecapEmbeds('flex', null);
    if (embeds.length === 0) {
      await interaction.editReply('Pas encore de games Flex enregistrées.');
      return;
    }
    await interaction.editReply({ embeds });
  },
};
