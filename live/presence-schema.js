const PRESENCE_SCHEMA_VERSION = 1;

const CHANNEL_META = {
  clients: { game:'valorant', kind:'client' },
  sessions: { game:'valorant', kind:'session' },
  lolClients: { game:'lol', kind:'client' },
  lolSessions: { game:'lol', kind:'session' },
};

function presenceTimestamp(record = {}, referenceNow = Date.now()) {
  const value = Number(record.heartbeatAt || record.ts || record.lastSeen || record.updatedAt || record.endedAt || 0);
  return value > 0 && value < 10_000_000_000 && referenceNow >= 1_000_000_000_000 ? value * 1000 : value;
}

function presenceLifecycle(record = {}, kind = record.kind || '') {
  if (kind === 'session') return record.active === false ? 'ended' : 'active';
  const state = String(record.state || '').toLowerCase();
  if (record.online === false || record.connected === false || state === 'stopped') return 'offline';
  if (state === 'error' || state === 'riot-offline') return 'error';
  return 'online';
}

function presenceRecordForPath(path, data, now = Date.now()) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data;
  const match = String(path).match(/^live\/(clients|sessions|lolClients|lolSessions)\/[^/]+$/);
  if (!match) return data;
  const meta = CHANNEL_META[match[1]];
  const heartbeatAt = presenceTimestamp(data, now) || now;
  const lifecycle = presenceLifecycle(data, meta.kind);
  const record = {
    ...data,
    schemaVersion: PRESENCE_SCHEMA_VERSION,
    game: meta.game,
    kind: meta.kind,
    heartbeatAt,
    lifecycle,
  };
  if (meta.kind === 'session') {
    if (lifecycle === 'ended') record.endedAt = Number(data.endedAt || heartbeatAt);
    else delete record.endedAt;
  }
  return record;
}

module.exports = {
  CHANNEL_META,
  PRESENCE_SCHEMA_VERSION,
  presenceLifecycle,
  presenceRecordForPath,
  presenceTimestamp,
};
