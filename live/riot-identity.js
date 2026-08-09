function validPuuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(String(value || ''));
}

function newestBoundValorantAccount(accounts) {
  if (!accounts || typeof accounts !== 'object') return null;
  return Object.values(accounts)
    .filter(account => {
      const games = Array.isArray(account?.games) ? account.games.map(game => String(game).toLowerCase()) : [];
      return validPuuid(account?.puuid) && games.includes('valorant');
    })
    .sort((left, right) => Number(right.updatedAt || right.addedAt || 0) - Number(left.updatedAt || left.addedAt || 0))[0] || null;
}

async function resolveRiotIdentity({ request, getFB, lock, identity }) {
  if (typeof request !== 'function' || !lock) return null;

  const session = await request(lock.port, lock.password, '/chat/v1/session');
  if (session?.ok && validPuuid(session.data?.puuid)) {
    return { puuid:session.data.puuid, playerName:'', source:'chat' };
  }

  const entitlements = await request(lock.port, lock.password, '/entitlements/v1/token');
  if (entitlements?.ok && validPuuid(entitlements.data?.subject)) {
    return { puuid:entitlements.data.subject, playerName:'', source:'entitlements' };
  }

  if (validPuuid(identity?.lastPuuid)) {
    return { puuid:identity.lastPuuid, playerName:identity.lastPlayerName || '', source:'local' };
  }

  if (typeof getFB === 'function' && identity?.memberId) {
    const accounts = await getFB(`rosterOverlay/accounts/${identity.memberId}`).catch(() => null);
    const account = newestBoundValorantAccount(accounts);
    if (account) {
      return { puuid:account.puuid, playerName:account.playerName || '', source:'admin' };
    }
  }

  return null;
}

module.exports = { newestBoundValorantAccount, resolveRiotIdentity, validPuuid };
