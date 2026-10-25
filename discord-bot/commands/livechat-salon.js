const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { setLiveChatChannelId } = require('../livechat.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('livechat-salon')
    .setDescription('Fait de ce salon le #livechat : ce qui y est posté s\'affiche sur l\'écran des membres')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

  async execute(interaction) {
    await setLiveChatChannelId(interaction.channelId);
    await interaction.reply(
      '📺 Ce salon est maintenant le **livechat** : une image, un GIF, une vidéo ou un texte posté ici '
      + 's\'affiche sur l\'écran de tous ceux qui ont OLYCITY Live.\n'
      + '• Format : commence par `g:` (grand), `m:` (moyen, par défaut) ou `p:` (petit).\n'
      + '• Pour une seule personne : commence par sa mention, ex. `g: @Nico regarde ça`.\n'
      + '• Un lien YouTube, Twitch, X, Reddit, TikTok… marche aussi : ajoute `1:20-1:35` pour n\'en garder qu\'un extrait.\n'
      + '• Ou utilise `/livechat`. Sur le site : https://olycity.fr/livechat',
    );
  },
};
