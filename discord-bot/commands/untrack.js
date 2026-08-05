const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { ensureRoster, memberNames, memberByName } = require('../roster.js');
const { removeTracker } = require('../trackers.js');

const GAME_LABELS = { valorant: 'Valorant', lol: 'League of Legends' };

module.exports = {
  data: new SlashCommandBuilder()
    .setName('untrack')
    .setDescription('Arrêter de suivre les games d\'un membre du roster dans ce salon')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addStringOption(option => option.setName('joueur').setDescription('Membre du roster').setRequired(true).setAutocomplete(true))
    .addStringOption(option => option.setName('jeu').setDescription('Jeu à ne plus suivre').setRequired(true)
      .addChoices({ name: 'Valorant', value: 'valorant' }, { name: 'League of Legends', value: 'lol' })),

  async autocomplete(interaction) {
    await ensureRoster();
    const focused = interaction.options.getFocused().toLowerCase();
    const choices = memberNames().filter(name => name.toLowerCase().includes(focused)).slice(0, 25);
    await interaction.respond(choices.map(name => ({ name, value: name })));
  },

  async execute(interaction) {
    // ensureRoster (fetch externe + Firebase) peut prendre plus de 3s — on
    // defer tout de suite pour ne pas risquer de faire échouer l'interaction.
    await interaction.deferReply();
    await ensureRoster();
    const playerName = interaction.options.getString('joueur');
    const game = interaction.options.getString('jeu');
    const member = memberByName(playerName);

    if (!member) {
      await interaction.editReply(`❌ "${playerName}" ne fait pas partie du roster OLYCITY.`);
      return;
    }

    const removed = await removeTracker({ channelId: interaction.channelId, player: member.name, game });

    await interaction.editReply(removed > 0
      ? `🗑️ Ce salon ne suit plus **${member.name}** en **${GAME_LABELS[game]}**.`
      : `ℹ️ Ce salon ne suivait pas **${member.name}** en **${GAME_LABELS[game]}**.`);
  },
};
