const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { placeBet, findOpenRoundForChannel } = require('../betting.js');

const CHOICE_LABELS = { win: 'Victoire', lose: 'Défaite' };

module.exports = {
  data: new SlashCommandBuilder()
    .setName('bet')
    .setDescription('Parier sur la game OLYCITY en cours dans ce salon')
    .addStringOption(option => option.setName('choix').setDescription('Victoire ou défaite de l\'équipe OLYCITY').setRequired(true)
      .addChoices({ name: 'Victoire', value: 'win' }, { name: 'Défaite', value: 'lose' }))
    .addIntegerOption(option => option.setName('montant').setDescription('Nombre de points à miser').setRequired(true).setMinValue(10)),

  async execute(interaction) {
    // Plusieurs allers-retours Firebase séquentiels ci-dessous (round, pari
    // existant, débit) — on defer tout de suite (en privé) pour ne pas risquer
    // de dépasser la fenêtre de 3s de Discord et faire échouer l'interaction.
    // La confirmation de pari réussi est renvoyée en message public séparé
    // (les autres doivent voir qui a parié quoi), les erreurs restent privées.
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const found = await findOpenRoundForChannel(interaction.channelId);
    if (!found) {
      await interaction.editReply('❌ Aucun pari ouvert dans ce salon pour le moment.');
      return;
    }

    const choice = interaction.options.getString('choix');
    const amount = interaction.options.getInteger('montant');
    const result = await placeBet(found.key, interaction.user.id, interaction.user.username, choice, amount);

    const reasons = {
      closed: '❌ Les paris sont fermés pour cette game (fenêtre de 5 minutes dépassée).',
      'already-bet': '❌ Tu as déjà parié sur cette game.',
      'insufficient-funds': '❌ Solde insuffisant — utilise `/balance` pour voir combien il te reste.',
      'no-round': '❌ Aucun pari ouvert dans ce salon pour le moment.',
    };

    if (!result.ok) {
      await interaction.editReply(reasons[result.reason] || '❌ Impossible de placer ce pari.');
      return;
    }

    const potentialGain = Math.round(amount * result.odds);
    await interaction.editReply('✅ Pari enregistré !');
    await interaction.channel.send(
      `🎲 **${interaction.user.username}** parie **${amount}** points sur **${CHOICE_LABELS[choice]}** (cote x${result.odds}) — gain potentiel : **${potentialGain}** points.`,
    ).catch(() => {});
  },
};
