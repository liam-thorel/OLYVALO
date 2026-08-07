const { SlashCommandBuilder } = require('discord.js');
const { buildLolSoloLeaderboardEmbed } = require('../leaderboard-rank.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('leaderboard-lol-solo')
    .setDescription('Affiche le classement du roster par rang LoL SoloQ actuel'),

  async execute(interaction) {
    await interaction.deferReply();
    const embed = await buildLolSoloLeaderboardEmbed();
    if (!embed) {
      await interaction.editReply('Pas encore de rang SoloQ connu pour le roster.');
      return;
    }
    await interaction.editReply({ embeds: [embed] });
  },
};
