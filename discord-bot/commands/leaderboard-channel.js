const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { fbPut } = require('../firebase.js');
const { CHANNEL_PATH } = require('../leaderboard-rank.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('leaderboard-channel')
    .setDescription('Fait de ce salon la destination du classement de rang (Valorant, LoL SoloQ)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

  async execute(interaction) {
    await fbPut(CHANNEL_PATH, interaction.channelId);
    await interaction.reply(
      '✅ Ce salon recevra le classement du roster par rang actuel : **Valorant Compétitif** et **LoL SoloQ**, '
      + 'mis à jour automatiquement toutes les 20 minutes (le message existant est édité, pas republié).',
    );
  },
};
