const { SlashCommandBuilder } = require('discord.js');
const { ensureRoster } = require('../roster.js');
const { fbGet } = require('../firebase.js');
const { valorantDuoStats, lolDuoStats, MIN_DUO_GAMES } = require('../synergy.js');

const MEDALS = ['🥇', '🥈', '🥉'];
const GAME_LABELS = { valorant: 'Valorant', lol: 'League of Legends' };

module.exports = {
  data: new SlashCommandBuilder()
    .setName('synergies')
    .setDescription('Classement des duos du roster par winrate')
    .addStringOption(option => option.setName('jeu').setDescription('Jeu').setRequired(true)
      .addChoices({ name: 'Valorant', value: 'valorant' }, { name: 'League of Legends', value: 'lol' }))
    .addIntegerOption(option => option.setName('minimum')
      .setDescription(`Nombre de games minimum (défaut : ${MIN_DUO_GAMES})`)
      .setMinValue(1).setMaxValue(50)),

  async execute(interaction) {
    // ensureRoster et la lecture de l'historique complet dépassent souvent les
    // 3 s de Discord.
    await interaction.deferReply();
    const game = interaction.options.getString('jeu');
    const minGames = interaction.options.getInteger('minimum') ?? MIN_DUO_GAMES;

    const [members, history] = await Promise.all([
      ensureRoster(),
      fbGet(game === 'lol' ? 'live/lolHistory' : 'live/history').catch(() => null),
    ]);

    const duos = game === 'lol'
      ? lolDuoStats(history, members, { minGames })
      : valorantDuoStats(history, members, { minGames });

    if (duos.length === 0) {
      await interaction.editReply(
        `Aucun duo avec au moins **${minGames}** game(s) en commun sur ${GAME_LABELS[game]}.`
        + '\nLes duos se construisent à partir des parties jouées ensemble — il en faut quelques-unes.',
      );
      return;
    }

    const lines = duos.slice(0, 15).map((entry, index) =>
      `${MEDALS[index] || `${index + 1}.`} **${entry.duo}** — ${entry.winrate}% `
      + `(${entry.wins}V / ${entry.losses}D sur ${entry.games})`);

    await interaction.editReply(
      `🤝 **Synergies ${GAME_LABELS[game]}** · minimum ${minGames} game(s)\n${lines.join('\n')}`,
    );
  },
};
