require('dotenv').config();

const FIREBASE_URL = 'https://realtime-database-5bb9f-default-rtdb.europe-west1.firebasedatabase.app';
const ROSTER_URL = process.env.ROSTER_URL || 'https://liam-thorel.github.io/OLYVALO/data/roster.json';
// Table agent -> rôle, partagée avec les pages Comps du site.
const ROLES_URL = process.env.ROLES_URL || 'https://liam-thorel.github.io/OLYVALO/data/roles.json';

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID || null;
const DISCORD_LOG_CHANNEL_ID = process.env.DISCORD_LOG_CHANNEL_ID || null;

if (!DISCORD_TOKEN) throw new Error('DISCORD_TOKEN manquant — copie .env.example vers .env et remplis-le.');
if (!DISCORD_CLIENT_ID) throw new Error('DISCORD_CLIENT_ID manquant — copie .env.example vers .env et remplis-le.');

module.exports = { FIREBASE_URL, ROSTER_URL, ROLES_URL, DISCORD_TOKEN, DISCORD_CLIENT_ID, DISCORD_GUILD_ID, DISCORD_LOG_CHANNEL_ID };
