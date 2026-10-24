/**
 * Un compte par personne : l'identifiant Discord.
 *
 * Le site se connecte avec Discord (application OLYBOT) et trace chaque
 * compte dans accounts/<identifiant Discord> ; le bot écrit au même endroit
 * quand quelqu'un l'utilise. Le portefeuille de paris est déjà rangé sous ce
 * même identifiant (betting/wallets/<id>) : site et bot parlent du même compte.
 *
 * Le lien avec un joueur vient du roster : `discordId` déclaré dans
 * roster.json / members.json, ou fiche ajoutée depuis l'admin du site.
 */

const SITE_URL = 'https://tracker.olycity.fr';

function discordAvatarUrl(user) {
  if (!user?.id || !user.avatar) return null;
  return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=256`;
}

/** Fiche accounts/<id> à jour, sans perdre la date de création. */
function accountRecord(user, member, existing = null, now = Date.now()) {
  return {
    ...(existing || {}),
    discordId: String(user.id),
    username: user.username || existing?.username || null,
    name: member?.name || user.globalName || user.username || existing?.name || null,
    avatar: member?.avatar || discordAvatarUrl(user) || existing?.avatar || null,
    memberId: member?.id || null,
    lastBotAt: now,
    createdAt: existing?.createdAt || now,
  };
}

async function linkAccount({ user, member, fbGet, fbPut, now = Date.now() }) {
  const path = `accounts/${user.id}`;
  const existing = await fbGet(path).catch(() => null);
  const record = accountRecord(user, member, existing, now);
  await fbPut(path, record);
  return { record, isNew: !existing };
}

function accountMessage({ record, isNew, balance = null }) {
  const solde = Number.isFinite(balance) ? ` Solde : **${balance}** points, le même sur le site.` : '';
  if (record.memberId) {
    return `🔗 Ton compte Discord est relié à **${record.name}** dans le roster OLYCITY.${solde}\n`
      + `Sur le site, connecte-toi avec Discord : ${SITE_URL}`;
  }
  return `${isNew ? '🆕 Compte OLYCITY créé' : '👤 Compte OLYCITY'} à ton nom Discord, **hors roster**.${solde}\n`
    + `Connecte-toi sur ${SITE_URL} avec Discord. Un admin peut te relier au roster depuis l'admin du site.`;
}

module.exports = { SITE_URL, accountRecord, linkAccount, accountMessage, discordAvatarUrl };
