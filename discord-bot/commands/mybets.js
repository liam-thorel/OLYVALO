const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { betsForUser } = require('../betting.js');
const { getBalance } = require('../wallet.js');

const GAME_LABELS = { valorant: 'Valorant', lol: 'League of Legends' };

module.exports = {
  data: new SlashCommandBuilder()
    .setName('mybets')
    .setDescription('Voir tes paris récents et ton solde'),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const [bets, balance] = await Promise.all([
      betsForUser(interaction.user.id),
      getBalance(interaction.user.id, interaction.user.username),
    ]);

    if (bets.length === 0) {
      await interaction.editReply(`💰 Solde : **${balance}** points.\nAucun pari pour l'instant — utilise \`/bet\` ou les boutons sur une game en cours.`);
      return;
    }

    let totalWagered = 0;
    let totalReturned = 0;
    let settledCount = 0;

    const lines = bets.slice(0, 15).map(({ round, bet }) => {
      const choiceLabel = bet.choice === 'win' ? "l'équipe suivie" : "l'équipe adverse";
      const players = round.players?.join(', ') || '?';
      const gameLabel = GAME_LABELS[round.game] || round.game;

      if (round.status === 'resolved') {
        settledCount += 1;
        totalWagered += bet.amount;
        const won = round.outcome === bet.choice;
        const odds = bet.choice === 'win' ? round.oddsWin : round.oddsLose;
        const payout = won ? Math.round(bet.amount * odds) : 0;
        totalReturned += payout;
        return `${won ? '✅' : '❌'} ${gameLabel} (${players}) — ${bet.amount} pts sur ${choiceLabel}${won ? ` → **+${payout}**` : ''}`;
      }
      if (round.status === 'cancelled') {
        settledCount += 1;
        totalWagered += bet.amount;
        totalReturned += bet.amount;
        return `↩️ ${gameLabel} (${players}) — ${bet.amount} pts, annulé et remboursé`;
      }
      return `🕓 ${gameLabel} (${players}) — ${bet.amount} pts sur ${choiceLabel} (en attente)`;
    });

    const roiPct = settledCount > 0 && totalWagered > 0
      ? Math.round(((totalReturned - totalWagered) / totalWagered) * 100)
      : null;

    const header = [
      `💰 Solde : **${balance}** points`,
      roiPct != null ? `ROI : **${roiPct >= 0 ? '+' : ''}${roiPct}%** sur ${settledCount} pari(s) réglé(s)` : null,
    ].filter(Boolean).join(' · ');

    await interaction.editReply(`${header}\n\n${lines.join('\n')}`);
  },
};
