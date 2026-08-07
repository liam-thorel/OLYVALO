const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { allRankGains } = require('../rank-tracking.js');
const { formatLolSection } = require('../lp-rr-recap.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('recap-lp-rr')
    .setDescription('Affiche les LP (LoL classé, Solo/Duo et Flex) et RR (Valorant Compétitif) depuis le dernier récap'),

  async execute(interaction) {
    await interaction.deferReply();
    const [soloGains, flexGains, valorantGains] = await Promise.all([
      allRankGains('lol-solo'), allRankGains('lol-flex'), allRankGains('valorant'),
    ]);

    const embeds = [];
    const lolSections = [
      formatLolSection(soloGains, 'Solo/Duo', '🔵'),
      formatLolSection(flexGains, 'Flex', '🟣'),
    ].filter(Boolean);
    if (lolSections.length > 0) {
      embeds.push(new EmbedBuilder()
        .setColor(0x0ac8b9)
        .setAuthor({ name: '📈 Récap LP (LoL classé)' })
        .setDescription(lolSections.join('\n\n'))
        .setTimestamp());
    }

    if (valorantGains.length > 0) {
      const lines = [...valorantGains].sort((a, b) => b.delta - a.delta)
        .map(g => `🔴 **${g.memberName}** (${g.riotId}) — ${g.delta >= 0 ? '+' : ''}${g.delta} RR`);
      embeds.push(new EmbedBuilder()
        .setColor(0xff4655)
        .setAuthor({ name: '📈 Récap RR (Valorant Compétitif)' })
        .setDescription(lines.join('\n'))
        .setTimestamp());
    }

    if (embeds.length === 0) {
      await interaction.editReply('Aucun changement de LP/RR depuis le dernier récap.');
      return;
    }

    await interaction.editReply({ embeds });
  },
};
