const { SlashCommandBuilder } = require('discord.js');
const { ensureRoster, memberNames, memberByName } = require('../roster.js');
const { historyFor, mostPlayed, recentForm } = require('../stats.js');

const GAME_LABELS = { valorant: 'Valorant', lol: 'League of Legends' };

module.exports = {
  data: new SlashCommandBuilder()
    .setName('stats')
    .setDescription('Voir les stats d\'un membre du roster')
    .addStringOption(option => option.setName('joueur').setDescription('Membre du roster').setRequired(true).setAutocomplete(true))
    .addStringOption(option => option.setName('jeu').setDescription('Jeu').setRequired(true)
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

    const entries = await historyFor(game, member.riotIds);
    if (entries.length === 0) {
      await interaction.editReply(`Pas encore de game enregistrée pour **${member.name}** en ${GAME_LABELS[game]}.`);
      return;
    }

    const withResult = entries.filter(e => typeof e.win === 'boolean');
    const wins = withResult.filter(e => e.win).length;
    const winratePct = withResult.length ? Math.round((wins / withResult.length) * 100) : null;
    const top = mostPlayed(entries, 3);
    const form = recentForm(entries, 10).map(win => (win ? '✅' : '❌')).join(' ');

    const lines = [
      `**${entries.length}** game(s) enregistrée(s)${withResult.length ? ` — **${wins}V / ${withResult.length - wins}D** (${winratePct}%)` : ''}`,
      top.length ? `Plus joués : ${top.map(c => `${c.name} (${c.count})`).join(', ')}` : null,
      form ? `Forme récente : ${form}` : null,
    ].filter(Boolean);

    await interaction.editReply(`📊 **Stats de ${member.name} — ${GAME_LABELS[game]}**\n${lines.join('\n')}`);
  },
};
