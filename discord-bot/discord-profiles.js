/**
 * Photos de profil Discord à jour.
 *
 * Les avatars du roster sont des adresses figées (data/members.json) : quand
 * quelqu'un change sa photo sur Discord, l'ancienne adresse cesse de marcher
 * et le site affiche une initiale, ou l'ancienne photo. Le bot, lui, peut
 * demander à Discord la photo actuelle de chaque membre relié à un compte
 * Discord : il la publie dans discordProfiles/<membre>, que le site, le bot
 * et le livechat préfèrent à l'adresse du roster.
 */
const PROFILES_PATH = 'discordProfiles';
const REFRESH_MS = 6 * 60 * 60 * 1000;

function profileFromUser(user) {
  return {
    discordId: String(user.id),
    avatar: user.displayAvatarURL({ extension: 'png', size: 256 }),
    globalName: user.globalName || null,
    username: user.username || null,
  };
}

/** Faut-il réécrire la fiche ? Seulement si la photo ou le nom a changé. */
function profileChanged(previous, next) {
  return !previous || previous.avatar !== next.avatar || previous.globalName !== next.globalName
    || previous.username !== next.username || previous.discordId !== next.discordId;
}

async function refreshDiscordProfiles({ client, members, fbGet, fbPut, log = () => {}, now = Date.now() }) {
  const existing = await fbGet(PROFILES_PATH).catch(() => null) || {};
  let updated = 0;
  for (const member of members.filter(entry => entry.discordId)) {
    let user;
    try {
      user = await client.users.fetch(member.discordId, { force: true });
    } catch (error) {
      log(`[profils-discord] ${member.name} introuvable sur Discord — ${error.message}`);
      continue;
    }
    const next = profileFromUser(user);
    if (!profileChanged(existing[member.id], next)) continue;
    await fbPut(`${PROFILES_PATH}/${member.id}`, { ...next, updatedAt: now });
    updated += 1;
  }
  if (updated) log(`[profils-discord] ${updated} photo${updated > 1 ? 's' : ''} de profil mise${updated > 1 ? 's' : ''} à jour`);
  return updated;
}

function startDiscordProfilesRefresh({ client, ensureRoster, fbGet, fbPut, log = console.log }) {
  const run = async () => {
    try {
      const members = await ensureRoster(true);
      await refreshDiscordProfiles({ client, members, fbGet, fbPut, log });
    } catch (error) {
      log(`[profils-discord] ${error.message}`);
    }
  };
  run();
  setInterval(run, REFRESH_MS).unref?.();
}

module.exports = { PROFILES_PATH, profileFromUser, profileChanged, refreshDiscordProfiles, startDiscordProfilesRefresh };
