const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { ensureRoster, memberNames } = require('../roster.js');
const { addTrackerForAll } = require('../trackers.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('track-lol-all')
    .setDescription('Suivre les games League of Legends de tout le roster OLYCITY dans ce salon')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

  async execute(interaction) {
    // ensureRoster + N trackers en parallèle peuvent dépasser 3s — on defer
    // tout de suite pour ne pas risquer de faire échouer l'interaction.
    await interaction.deferReply();
    await ensureRoster();
    const names = memberNames();
    const { created, alreadyTracked, total } = await addTrackerForAll({
      guildId: interaction.guildId, channelId: interaction.channelId, game: 'lol', addedBy: interaction.user.id,
    }, names);

    await interaction.editReply(
      `✅ Ce salon suit maintenant **League of Legends** pour tout le roster (${total} membre(s)).` +
      (alreadyTracked > 0 ? ` ${created} nouveau(x), ${alreadyTracked} déjà suivi(s).` : ''),
    );
  },
};
