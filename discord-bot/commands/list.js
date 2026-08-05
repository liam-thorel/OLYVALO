const { SlashCommandBuilder } = require('discord.js');
const { trackersFor } = require('../trackers.js');

const GAME_LABELS = { valorant: 'Valorant', lol: 'League of Legends' };

module.exports = {
  data: new SlashCommandBuilder()
    .setName('list')
    .setDescription('Voir les suivis actifs dans ce salon'),

  async execute(interaction) {
    const trackers = trackersFor(interaction.channelId);
    if (trackers.length === 0) {
      await interaction.reply('Aucun suivi actif dans ce salon. Utilise `/track` pour en ajouter un.');
      return;
    }
    const lines = trackers.map(t => `• **${t.player}** — ${GAME_LABELS[t.game] || t.game}`);
    await interaction.reply(`**Suivis actifs dans ce salon :**\n${lines.join('\n')}`);
  },
};
