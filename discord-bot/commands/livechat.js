const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { ensureRoster, memberByDiscordId } = require('../roster.js');
const {
  SIZE_LABELS, buildLiveChatItem, clipFromTimes, deliverySummary, fetchOnlineReceivers,
  kindFromAttachment, publishLiveChatItem, senderFor,
} = require('../livechat.js');
const { normalizeVideoLink } = require('../video-links.js');

const clock = ms => {
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('livechat')
    .setDescription('Afficher une image, un GIF, une vidéo, un lien YouTube ou un texte sur l\'écran des membres')
    .addAttachmentOption(option => option.setName('media').setDescription('Image, GIF ou vidéo (MP4)'))
    .addStringOption(option => option.setName('lien').setDescription('Lien YouTube, clip Twitch, X, Reddit, TikTok…').setMaxLength(500))
    .addStringOption(option => option.setName('debut').setDescription('Début de l\'extrait, ex. 1:20 (vidéo ou lien)').setMaxLength(12))
    .addStringOption(option => option.setName('fin').setDescription('Fin de l\'extrait, ex. 1:35 (30 s après le début sinon)').setMaxLength(12))
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
    const rawLink = attachment ? '' : interaction.options.getString('lien') || '';
    const link = rawLink ? normalizeVideoLink(rawLink) : null;
    const text = interaction.options.getString('texte') || '';
    const size = interaction.options.getString('format') || 'moyen';
    const targetUser = interaction.options.getUser('pour');

    const kind = attachment ? kindFromAttachment(attachment) : null;
    if (attachment && !kind) {
      await interaction.reply({ content: '❌ Seules les images, les GIF et les vidéos peuvent s\'afficher.', flags: MessageFlags.Ephemeral });
      return;
    }
    if (rawLink && !link) {
      await interaction.reply({ content: '❌ Lien non pris en charge. Sites acceptés : YouTube, Twitch, X, Reddit, TikTok, Instagram, Streamable, Vimeo, Dailymotion, Kick, Medal.', flags: MessageFlags.Ephemeral });
      return;
    }
    if (!attachment && !link && !text.trim()) {
      await interaction.reply({ content: '❌ Il faut un média, un lien, un texte, ou les deux.', flags: MessageFlags.Ephemeral });
      return;
    }
    const trim = (kind === 'video' || link)
      ? clipFromTimes(interaction.options.getString('debut'), interaction.options.getString('fin'), link?.startMs ?? null)
      : null;

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
      from, text, size, target, trim,
      media: attachment ? { url: attachment.url, kind } : null,
      link: link?.url || null,
    }));
    const receivers = await fetchOnlineReceivers();

    const embed = new EmbedBuilder()
      .setColor(0xff4655)
      .setAuthor({ name: `${from.name} · livechat ${SIZE_LABELS[size]}`, iconURL: from.avatar || undefined })
      .setDescription(`📺 Envoyé ${deliverySummary(receivers, target, targetName, from.id)}.${trim ? ` Extrait ${clock(trim.startMs)} → ${clock(trim.endMs)}.` : ''}${text ? `\n> ${text}` : ''}`);
    if (attachment && kind !== 'video') embed.setImage(attachment.url);
    await interaction.editReply({
      embeds: [embed],
      // Une vidéo ne s'affiche pas dans un embed : son lien, si.
      content: kind === 'video' ? attachment.url : link ? link.url : undefined,
    });
  },
};
