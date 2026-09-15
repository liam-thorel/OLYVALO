const { SlashCommandBuilder } = require('discord.js');
const { ensureRoster, memberNames, memberByName } = require('../roster.js');
const { fbGet } = require('../firebase.js');
const { valorantMapStats } = require('../synergy.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('maps')
    .setDescription('Bilan par carte d\'un membre : winrate, K/D et ACS (Valorant)')
    .addStringOption(option => option.setName('joueur').setDescription('Membre du roster')
      .setRequired(true).setAutocomplete(true)),

  async autocomplete(interaction) {
    await ensureRoster();
    const focused = interaction.options.getFocused().toLowerCase();
    const choices = memberNames().filter(name => name.toLowerCase().includes(focused)).slice(0, 25);
    await interaction.respond(choices.map(name => ({ name, value: name })));
  },

  async execute(interaction) {
    await interaction.deferReply();
    await ensureRoster();
    const playerName = interaction.options.getString('joueur');
    const member = memberByName(playerName);
    if (!member) {
      await interaction.editReply(`❌ "${playerName}" ne fait pas partie du roster OLYCITY.`);
      return;
    }

    const history = await fbGet('live/history').catch(() => null);
    const rows = valorantMapStats(history, member.riotIds);
    if (rows.length === 0) {
      await interaction.editReply(`Aucune partie Valorant enregistrée pour **${member.name}**.`);
      return;
    }

    const lines = rows.map(row => {
      // null quand aucune partie n'a de vainqueur connu : afficher « 0 % »
      // laisserait croire à une série de défaites.
      const winrate = row.winrate == null ? '—' : `${row.winrate}%`;
      const bilan = row.winrate == null ? `${row.games} game(s)` : `${row.wins}V/${row.losses}D`;
      const acs = row.acs != null ? ` · ${row.acs} ACS` : '';
      return `**${row.map}** — ${winrate} (${bilan}) · ${row.kd} K/D · ${row.kda}${acs}`;
    });

    const totalGames = rows.reduce((sum, row) => sum + row.games, 0);
    await interaction.editReply(
      `🗺️ **${member.name}** · ${totalGames} game(s) Valorant · classé uniquement\n${lines.join('\n')}`,
    );
  },
};
