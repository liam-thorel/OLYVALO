const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { LIVECHAT_ADMIN_IDS } = require('../config.js');
const { fbGet, fbPut } = require('../firebase.js');
const { ensureRoster, memberByDiscordId, memberById, memberByName } = require('../roster.js');
const { linkAccount, linkPlan } = require('../account-link.js');

/**
 * Relie le compte Discord de quelqu'un à son membre du roster : typiquement
 * une personne créée par OLYCITY Live (« nouvelle personne »), qui n'a que
 * son prénom. Une fois reliée, le site, le bot et le livechat la reconnaissent.
 * Réservée à Liam : Discord garantit l'identité de qui lance la commande, et
 * celle du compte mentionné.
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('relier')
    .setDescription('Relier le compte Discord de quelqu\'un à son membre du roster (réservé à Liam)')
    .addUserOption(option => option.setName('compte').setDescription('Le compte Discord de la personne').setRequired(true))
    .addStringOption(option => option.setName('membre').setDescription('Son nom dans le roster, ex. Max').setRequired(true).setMaxLength(40)),

  async execute(interaction) {
    if (!LIVECHAT_ADMIN_IDS.includes(interaction.user.id)) {
      await interaction.reply({ content: '❌ Commande réservée à Liam.', flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const user = interaction.options.getUser('compte');
    const name = interaction.options.getString('membre');
    await ensureRoster(true).catch(() => {});
    const member = memberById(name.toLowerCase()) || memberByName(name);
    const plan = linkPlan({ user, member, owner: memberByDiscordId(user.id) });
    if (plan.error) {
      await interaction.editReply(`❌ ${plan.error}`);
      return;
    }
    for (const [path, value] of plan.writes) await fbPut(path, value);
    await ensureRoster(true).catch(() => {});
    await linkAccount({ user, member: { ...member, discordId: user.id }, fbGet, fbPut });
    await interaction.editReply(
      `🔗 **${member.name}** est maintenant relié à <@${user.id}>. `
      + 'Le site, le bot et le livechat le reconnaissent : il peut se connecter avec Discord sur https://tracker.olycity.fr.',
    );
  },
};
