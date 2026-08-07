const { fbGet } = require('./firebase.js');

const RECAP_DISABLED_PATH = 'discordConfig/recapDisabledChannels';

// Filtre une liste de channelIds pour ne garder que ceux où les récaps
// quotidiens n'ont pas été désactivés (discordConfig/recapDisabledChannels).
// Le suivi des games (trackers.js) n'est pas concerné — un salon désactivé
// ici continue de recevoir les notifs de début/fin de partie normalement.
async function filterRecapChannels(channelIds) {
  const disabled = await fbGet(RECAP_DISABLED_PATH).catch(() => null) || {};
  return channelIds.filter(id => !disabled[id]);
}

module.exports = { filterRecapChannels, RECAP_DISABLED_PATH };
