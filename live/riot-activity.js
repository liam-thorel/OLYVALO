// Presence is a hint, never proof of a match. Only inspect the local PUUID.
function ownPresence(presences, puuid) {
  return puuid && Array.isArray(presences)
    ? presences.filter(record => record?.puuid === puuid && (!record.product || record.product === 'valorant'))
      .sort((left, right) => Number(right.time || 0) - Number(left.time || 0)) : [];
}

function decodedPresence(records) {
  for (const record of records) {
    const raw = record?.private;
    if (typeof raw !== 'string') continue;
    try {
      const data = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
      if (data && typeof data === 'object' && !Array.isArray(data) && Object.keys(data).length) return data;
    } catch { /* chat can publish incomplete payloads during transitions */ }
  }
  return null;
}

function valorantActivity(data) {
  if (!data || data.isValid === false) return { activity: 'unknown', partyId: '', partySize: 0, partyCapacity: 0, queueId: '', queueStartedAt: 0, partyOpen: false };
  const party = data.partyPresenceData || data;
  // Current Riot payload nests the LOCAL loop in matchPresenceData. Never use
  // partyOwnerSessionLoopState: the party owner may be in a different state.
  const loop = String(data.matchPresenceData?.sessionLoopState
    || data.playerPresenceData?.sessionLoopState || data.sessionLoopState || '').toUpperCase();
  const partyState = String(party.partyState || '').toUpperCase();
  const activity = loop === 'INGAME' ? 'in-game' : loop === 'PREGAME' ? 'agent-select'
    : loop === 'MENUS' && partyState === 'MATCHMAKING' ? 'queue' : data.isIdle === true ? 'away'
      : loop === 'MENUS' ? 'menu' : 'unknown';
  const rawTime = party.queueEntryTime;
  const number = Number(rawTime);
  const queueStartedAt = Number.isFinite(number) && number > 0
    ? (number < 10_000_000_000 ? number * 1000 : number) : (Date.parse(rawTime) || 0);
  const bounded = value => Math.min(100, Math.max(0, Number(value) || 0));
  return {
    activity, partyId: String(party.partyId || ''),
    partySize: bounded(party.partySize), partyCapacity: bounded(party.maxPartySize),
    partyOpen: party.partyAccessibility === 'OPEN', queueId: String(party.queueId || data.queueId || ''),
    queueStartedAt: activity === 'queue' ? queueStartedAt : 0,
  };
}

function lolActivity(phase) {
  return ({ Lobby:'menu', None:'menu', Matchmaking:'queue', ReadyCheck:'ready-check',
    ChampSelect:'agent-select', GameStart:'loading', InProgress:'in-game',
    Reconnect:'reconnecting', WaitingForStats:'postgame', PreEndOfGame:'postgame',
    EndOfGame:'postgame', Offline:'offline' })[phase] || 'unknown';
}

module.exports = { ownPresence, decodedPresence, valorantActivity, lolActivity };
