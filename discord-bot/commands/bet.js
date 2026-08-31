const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { placeBet, findOpenRoundForChannel, betErrorMessage, betConfirmation, MIN_BET } = require('../betting.js');

const CHOICE_LABELS = { win: 'Victoire', lose: 'Défaite' };

module.exports = {
  data: new SlashCommandBuilder()
    .setName('bet')
    .setDescription('Parier sur la game OLYCITY en cours dans ce salon')
    .addStringOption(option => option.setName('choix').setDescription('Victoire ou défaite de l\'équipe OLYCITY').setRequired(true)
      .addChoices({ name: 'Victoire', value: 'win' }, { name: 'Défaite', value: 'lose' }))
    .addIntegerOption(option => option.setName('montant').setDescription('Nombre de points à miser').setRequired(true).setMinValue(MIN_BET)),

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

    if (!result.ok) {
      await interaction.editReply(betErrorMessage(result.reason, result.balance));
      return;
    }

    const potentialGain = Math.round(amount * result.odds);
    await interaction.editReply(betConfirmation(amount, result.odds, result.balance));
    await interaction.channel.send(
      `🎲 **${interaction.user.username}** parie **${amount}** points sur **${CHOICE_LABELS[choice]}** (cote x${result.odds}) — gain potentiel : **${potentialGain}** points.`,
    ).catch(() => {});
  },
};
