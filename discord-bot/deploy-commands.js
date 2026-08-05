const { REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');
const { DISCORD_TOKEN, DISCORD_CLIENT_ID, DISCORD_GUILD_ID } = require('./config.js');

const commands = fs.readdirSync(path.join(__dirname, 'commands'))
  .filter(file => file.endsWith('.js'))
  .map(file => require(`./commands/${file}`).data.toJSON());

const rest = new REST().setToken(DISCORD_TOKEN);

(async () => {
  const route = DISCORD_GUILD_ID
    ? Routes.applicationGuildCommands(DISCORD_CLIENT_ID, DISCORD_GUILD_ID)
    : Routes.applicationCommands(DISCORD_CLIENT_ID);

  const result = await rest.put(route, { body: commands });
  console.log(`✅ ${result.length} commande(s) enregistrée(s)${DISCORD_GUILD_ID ? ' sur le serveur de dev' : ' globalement (jusqu\'à 1h de délai)'}.`);
})().catch(error => {
  console.error('❌ Échec de l\'enregistrement des commandes :', error);
  process.exit(1);
});
