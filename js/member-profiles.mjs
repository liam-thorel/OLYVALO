export function memberId(value = '') {
  return String(value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-+|-+$)/g, '');
}

export function mergeMemberProfiles({ roster = [], members = [], overlay = {} } = {}) {
  const profiles = new Map();
  const order = [];
  const hidden = overlay?.hiddenMembers || {};

  const register = (entry = {}, forcedId = '') => {
    const id = memberId(forcedId || entry.id || entry.name);
    if (!id || hidden[id]) return;
    if (!profiles.has(id)) order.push(id);
    profiles.set(id, { ...(profiles.get(id) || {}), ...entry, id });
  };

  roster.forEach(entry => register(entry));
  members.forEach(entry => register(entry));
  Object.entries(overlay?.members || {}).forEach(([id, entry]) => register(entry, id));

  return order.map(id => profiles.get(id)).filter(profile => profile?.name);
}

export function resolveMemberProfile(profiles = [], { id = '', name = '' } = {}) {
  const normalizedId = memberId(id);
  return profiles.find(profile => profile.id === normalizedId)
    || profiles.find(profile => memberId(profile.name) === memberId(name))
    || null;
}
