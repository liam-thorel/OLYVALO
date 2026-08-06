/**
 * Compteurs "pour rire" sur les résultats Valorant, persistés par membre du
 * roster : masterchiasse (K/D très défavorable) et thirty bomb (30 kills+).
 */
const { fbGet, fbPut } = require('./firebase.js');

const PATH = 'valorantAwards';

async function recordAward(type, memberId, memberName) {
  const existing = await fbGet(`${PATH}/${type}/${memberId}`).catch(() => null);
  const count = (existing?.count || 0) + 1;
  await fbPut(`${PATH}/${type}/${memberId}`, { name: memberName, count });
  return count;
}

async function awardsLeaderboard(type) {
  const data = await fbGet(`${PATH}/${type}`).catch(() => null);
  return Object.entries(data || {})
    .map(([memberId, entry]) => ({ memberId, name: entry.name, count: entry.count || 0 }))
    .sort((a, b) => b.count - a.count);
}

module.exports = { recordAward, awardsLeaderboard };
