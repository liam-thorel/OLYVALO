const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { fbGet, fbPut } = require('../firebase.js');
const { ensureRoster, memberByDiscordId } = require('../roster.js');
const { getBalance } = require('../wallet.js');
const { linkAccount, accountMessage } = require('../account-link.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('compte')
    .setDescription('Ton compte OLYCITY : le même sur le site et sur le bot'),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await ensureRoster().catch(() => {});
    const member = memberByDiscordId(interaction.user.id);
    const { record, isNew } = await linkAccount({ user: interaction.user, member, fbGet, fbPut });
    const balance = await getBalance(interaction.user.id, interaction.user.username).catch(() => null);
    await interaction.editReply(accountMessage({ record, isNew, balance }));
  },
};
