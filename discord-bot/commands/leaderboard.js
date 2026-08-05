const { SlashCommandBuilder } = require('discord.js');
const { leaderboard } = require('../wallet.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('Classement des points de pari'),

  async execute(interaction) {
    // Fetch Firebase + éventuels fallbacks sur l'API Discord pour les pseudos
    // manquants — on defer par sécurité pour ne pas dépasser la fenêtre de 3s.
    await interaction.deferReply();
    const top = await leaderboard(10);
    if (top.length === 0) {
      await interaction.editReply('Personne n\'a encore de points enregistrés.');
      return;
    }

    const medals = ['🥇', '🥈', '🥉'];
    const lines = await Promise.all(top.map(async (entry, index) => {
      let name = entry.username;
      if (!name) name = (await interaction.client.users.fetch(entry.userId).catch(() => null))?.username || entry.userId;
      return `${medals[index] || `${index + 1}.`} **${name}** — ${entry.balance} points`;
    }));

    await interaction.editReply(`**🏆 Classement des paris**\n${lines.join('\n')}`);
  },
};
