const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { fbPut } = require('../firebase.js');
const { RECAP_CHANNEL_PATH } = require('../recap-channel.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('recap-channel')
    .setDescription('Fait de ce salon la destination des récaps automatiques (SoloQ, Flex, Valorant — quotidien/hebdo/mensuel)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

  async execute(interaction) {
    await fbPut(RECAP_CHANNEL_PATH, interaction.channelId);
    await interaction.reply(
      '✅ Ce salon recevra désormais tous les récaps automatiques : **SoloQ**, **Flex** et **Valorant**, '
      + 'chacun en quotidien, hebdo et mensuel. (Le récap points de paris reste manuel, via /recap-paris.)',
    );
  },
};
