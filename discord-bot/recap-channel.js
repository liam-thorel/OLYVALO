/**
 * Salon unique où sont postés automatiquement les récaps de jeu (SoloQ,
 * Flex, Valorant — quotidien/hebdo/mensuel), défini via /recap-channel. Le
 * récap points (paris) n'y participe pas — il reste consultable uniquement
 * via /recap-paris.
 */
const { fbGet } = require('./firebase.js');

const RECAP_CHANNEL_PATH = 'discordConfig/recapChannelId';

async function getRecapChannelId() {
  return await fbGet(RECAP_CHANNEL_PATH).catch(() => null);
}

module.exports = { getRecapChannelId, RECAP_CHANNEL_PATH };
