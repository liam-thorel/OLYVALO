const { fbGet, fbPost, fbDelete, watchNode } = require('./firebase.js');

const TRACKERS_PATH = 'discordConfig/trackers';

let cache = {}; // pushId -> { guildId, channelId, player, game, addedBy, addedAt }
let stopWatching = null;

function startTrackerSync() {
  if (stopWatching) return;
  stopWatching = watchNode(TRACKERS_PATH, snapshot => { cache = snapshot || {}; }, error => {
    console.error(`[trackers] ${error.message}`);
  });
}

async function loadTrackersOnce() {
  cache = (await fbGet(TRACKERS_PATH)) || {};
  return cache;
}

function trackersFor(channelId) {
  return Object.entries(cache)
    .filter(([, tracker]) => tracker.channelId === channelId)
    .map(([id, tracker]) => ({ id, ...tracker }));
}

function trackersForPlayerGame(player, game) {
  return Object.entries(cache)
    .filter(([, tracker]) => tracker.player === player && tracker.game === game)
    .map(([id, tracker]) => ({ id, ...tracker }));
}

async function addTracker({ guildId, channelId, player, game, addedBy }) {
  const existing = trackersFor(channelId).find(t => t.player === player && t.game === game);
  if (existing) return { created: false, tracker: existing };
  const { name: id } = await fbPost(TRACKERS_PATH, {
    guildId, channelId, player, game, addedBy, addedAt: Date.now(),
  });
  cache[id] = { guildId, channelId, player, game, addedBy, addedAt: Date.now() };
  return { created: true, tracker: { id, ...cache[id] } };
}

async function removeTracker({ channelId, player, game }) {
  const matches = trackersFor(channelId).filter(t => t.player === player && t.game === game);
  await Promise.all(matches.map(t => fbDelete(`${TRACKERS_PATH}/${t.id}`)));
  matches.forEach(t => delete cache[t.id]);
  return matches.length;
}

// Ajoute un tracker pour chaque membre passé (ex: tout le roster) — pour /track-valo-all et /track-lol-all.
async function addTrackerForAll({ guildId, channelId, game, addedBy }, allMemberNames) {
  const results = await Promise.all(allMemberNames.map(player => addTracker({ guildId, channelId, player, game, addedBy })));
  return {
    created: results.filter(r => r.created).length,
    alreadyTracked: results.filter(r => !r.created).length,
    total: results.length,
  };
}

module.exports = {
  startTrackerSync, loadTrackersOnce, trackersFor, trackersForPlayerGame, addTracker, removeTracker, addTrackerForAll,
};
