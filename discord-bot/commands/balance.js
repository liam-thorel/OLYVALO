const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { getBalance, DAILY_GRANT } = require('../wallet.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('balance')
    .setDescription('Voir ton solde de points de pari'),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const balance = await getBalance(interaction.user.id, interaction.user.username);
    await interaction.editReply(`💰 Tu as **${balance}** points (+${DAILY_GRANT} crédités chaque jour).`);
  },
};
