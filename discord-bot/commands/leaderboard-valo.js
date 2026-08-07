const { SlashCommandBuilder } = require('discord.js');
const { buildValorantLeaderboardEmbed } = require('../leaderboard-rank.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('leaderboard-valo')
    .setDescription('Affiche le classement du roster par rang Valorant Compétitif actuel'),

  async execute(interaction) {
    await interaction.deferReply();
    const embed = await buildValorantLeaderboardEmbed();
    if (!embed) {
      await interaction.editReply('Pas encore de rang Valorant Compétitif connu pour le roster.');
      return;
    }
    await interaction.editReply({ embeds: [embed] });
  },
};
