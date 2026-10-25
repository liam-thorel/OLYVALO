const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { LIVECHAT_ADMIN_IDS } = require('../config.js');
const { ensureRoster, memberByDiscordId } = require('../roster.js');
const { LIVECHAT_RECEIVERS_PATH, mutedReceivers, requestReenable } = require('../livechat.js');
const { fbGet } = require('../firebase.js');

/**
 * Réactive le livechat chez ceux qui l'ont coupé (touche ou LIVECHAT.bat).
 * Réservée à Liam : Discord garantit l'identité de qui lance la commande.
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('livechat-reactiver')
    .setDescription('Réactiver le livechat chez tout le monde ou chez une personne (réservé à Liam)')
    .addUserOption(option => option.setName('pour').setDescription('Une seule personne (tout le monde sinon)')),

  async execute(interaction) {
    if (!LIVECHAT_ADMIN_IDS.includes(interaction.user.id)) {
      await interaction.reply({ content: '❌ Commande réservée à Liam.', flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await ensureRoster().catch(() => {});
    const targetUser = interaction.options.getUser('pour');
    let target = null;
    if (targetUser) {
      target = memberByDiscordId(targetUser.id);
      if (!target) {
        await interaction.editReply(`❌ ${targetUser.username} ne fait pas partie du roster OLYCITY.`);
        return;
      }
    }
    const by = memberByDiscordId(interaction.user.id)?.name || interaction.user.username;
    const muted = mutedReceivers(await fbGet(LIVECHAT_RECEIVERS_PATH).catch(() => null));
    await requestReenable(target?.id || null, by);

    const concerned = target ? muted.filter(receiver => receiver.memberId === target.id) : muted;
    const who = target ? `chez **${target.name}**` : 'chez **tout le monde**';
    const state = concerned.length
      ? `Coupé en ce moment : ${concerned.map(receiver => receiver.name).join(', ')} — réactivé dans les secondes qui viennent.`
      : target
        ? `${target.name} ne l'avait pas coupé (ou son Live est hors ligne : ce sera appliqué à son retour, dans les 12 h).`
        : 'Personne en ligne ne l\'avait coupé ; un Live hors ligne l\'appliquera à son retour (dans les 12 h).';
    await interaction.editReply(`📺 Livechat réactivé ${who}.\n${state}`);
  },
};
