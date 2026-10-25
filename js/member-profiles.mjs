export function memberId(value = '') {
  return String(value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-+|-+$)/g, '');
}

/**
 * `profiles` : photos Discord actuelles publiées par le bot
 * (discordProfiles/<membre>), préférées aux adresses figées du roster.
 */
export function mergeMemberProfiles({ roster = [], members = [], overlay = {}, profiles = null } = {}) {
  const profilesById = new Map();
  const order = [];
  const hidden = overlay?.hiddenMembers || {};

  const register = (entry = {}, forcedId = '') => {
    const id = memberId(forcedId || entry.id || entry.name);
    if (!id || hidden[id]) return;
    if (!profilesById.has(id)) order.push(id);
    profilesById.set(id, { ...(profilesById.get(id) || {}), ...entry, id });
  };

  roster.forEach(entry => register(entry));
  members.forEach(entry => register(entry));
  Object.entries(overlay?.members || {}).forEach(([id, entry]) => register(entry, id));

  return order.map(id => {
    const profile = profilesById.get(id);
    const fresh = profiles?.[id];
    // Une photo publiée pour un autre compte Discord que celui du membre ne compte pas.
    // Firebase est ouvert en écriture : seule une adresse d'avatar Discord est prise.
    const discordAvatar = /^https:\/\/cdn\.discordapp\.com\/(avatars|embed\/avatars)\//.test(String(fresh?.avatar || ''));
    if (!profile?.name || !discordAvatar || (profile.discordId && fresh.discordId && fresh.discordId !== profile.discordId)) return profile;
    return { ...profile, avatar: fresh.avatar };
  }).filter(profile => profile?.name);
}

export function resolveMemberProfile(profiles = [], { id = '', name = '' } = {}) {
  const normalizedId = memberId(id);
  return profiles.find(profile => profile.id === normalizedId)
    || profiles.find(profile => memberId(profile.name) === memberId(name))
    || null;
}
