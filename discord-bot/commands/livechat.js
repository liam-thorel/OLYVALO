const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { ensureRoster, memberByDiscordId } = require('../roster.js');
const {
  SIZE_LABELS, buildLiveChatItem, deliverySummary, fetchOnlineReceivers,
  kindFromAttachment, publishLiveChatItem, senderFor,
} = require('../livechat.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('livechat')
    .setDescription('Afficher une image, un GIF, une vidéo ou un texte sur l\'écran des membres')
    .addAttachmentOption(option => option.setName('media').setDescription('Image, GIF ou vidéo (MP4)'))
    .addStringOption(option => option.setName('texte').setDescription('Légende affichée sur le média').setMaxLength(220))
    .addStringOption(option => option.setName('format').setDescription('Taille à l\'écran (moyen par défaut)')
      .addChoices(
        { name: 'Grand', value: 'grand' },
        { name: 'Moyen', value: 'moyen' },
        { name: 'Petit', value: 'petit' },
      ))
    .addUserOption(option => option.setName('pour').setDescription('Uniquement sur l\'écran de cette personne')),

  async execute(interaction) {
    const attachment = interaction.options.getAttachment('media');
    const text = interaction.options.getString('texte') || '';
    const size = interaction.options.getString('format') || 'moyen';
    const targetUser = interaction.options.getUser('pour');

    const kind = attachment ? kindFromAttachment(attachment) : null;
    if (attachment && !kind) {
      await interaction.reply({ content: '❌ Seules les images, les GIF et les vidéos peuvent s\'afficher.', flags: MessageFlags.Ephemeral });
      return;
    }
    if (!attachment && !text.trim()) {
      await interaction.reply({ content: '❌ Il faut un média, un texte, ou les deux.', flags: MessageFlags.Ephemeral });
      return;
    }

    await interaction.deferReply();
    await ensureRoster().catch(() => {});
    let target = null;
    let targetName = null;
    if (targetUser) {
      const member = memberByDiscordId(targetUser.id);
      if (!member) {
        await interaction.editReply(`❌ ${targetUser.username} ne fait pas partie du roster OLYCITY.`);
        return;
      }
      target = member.id;
      targetName = member.name;
    }

    const from = senderFor(interaction.user, interaction.member, memberByDiscordId);
    await publishLiveChatItem(buildLiveChatItem({
      from, text, size, target,
      media: attachment ? { url: attachment.url, kind } : null,
    }));
    const receivers = await fetchOnlineReceivers();

    const embed = new EmbedBuilder()
      .setColor(0xff4655)
      .setAuthor({ name: `${from.name} · livechat ${SIZE_LABELS[size]}`, iconURL: from.avatar || undefined })
      .setDescription(`📺 Envoyé ${deliverySummary(receivers, target, targetName)}.${text ? `\n> ${text}` : ''}`);
    if (attachment && kind !== 'video') embed.setImage(attachment.url);
    await interaction.editReply({
      embeds: [embed],
      // Une vidéo ne s'affiche pas dans un embed : son lien, si.
      content: kind === 'video' ? attachment.url : undefined,
    });
  },
};
