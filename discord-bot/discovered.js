const { fbGet, fbPut } = require('./firebase.js');

// Les clés Firebase RTDB interdisent . # $ [ ] /
function safeFirebaseKey(str) {
  return String(str).replace(/[.#$[\]/]/g, '_');
}

async function recordDiscovered(playerName) {
  const key = safeFirebaseKey(playerName);
  const now = Date.now();
  const existing = await fbGet(`discovered/${key}`).catch(() => null);
  await fbPut(`discovered/${key}`, { playerName, lastSeen: now, firstSeen: existing?.firstSeen || now });
}

module.exports = { recordDiscovered };
