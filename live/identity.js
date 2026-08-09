/**
 * Identité OLYCITY de l'installation.
 *
 * Le suivi ne peut pas reposer sur le Riot ID : il change dès qu'un joueur
 * renomme son compte, et le bot perd alors la trace du membre (il repart en
 * "compte découvert" à réassigner à la main dans #admin).
 *
 * On demande donc UNE FOIS à l'installation « qui es-tu dans le roster ? » et
 * on mémorise le membre choisi dans olycity-identity.json, à côté du script.
 * Ce fichier n'est pas listé dans update-manifest.json : il survit aux mises à
 * jour automatiques. À partir de là, chaque session publiée porte le memberId
 * choisi, et le script réenregistre tout seul le compte Riot courant (clé =
 * PUUID, stable) sous ce membre — un renommage se répare donc de lui-même.
 */
const fs = require('fs');
const path = require('path');

const IDENTITY_FILENAME = 'olycity-identity.json';

function identityPath(installDir = __dirname) {
  return path.join(installDir, IDENTITY_FILENAME);
}

// Même slug que le site (js/admin.mjs) et que le bot (discord-bot/roster.js) —
// c'est la clé de rosterOverlay/accounts, elle doit correspondre exactement.
function slugifyMemberName(name) {
  return String(name || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-+|-+$)/g, '');
}

function readIdentity(installDir = __dirname) {
  try {
    const raw = fs.readFileSync(identityPath(installDir), 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed?.memberId || !parsed?.memberName) return null;
    return {
      memberId: String(parsed.memberId),
      memberName: String(parsed.memberName),
      isNewMember: Boolean(parsed.isNewMember),
      chosenAt: Number(parsed.chosenAt) || 0,
      lastPuuid: String(parsed.lastPuuid || ''),
      lastPlayerName: String(parsed.lastPlayerName || ''),
    };
  } catch {
    return null;
  }
}

function writeIdentity(identity, installDir = __dirname) {
  const payload = {
    memberId: identity.memberId,
    memberName: identity.memberName,
    isNewMember: Boolean(identity.isNewMember),
    chosenAt: identity.chosenAt || Date.now(),
    lastPuuid: String(identity.lastPuuid || ''),
    lastPlayerName: String(identity.lastPlayerName || ''),
  };
  fs.writeFileSync(identityPath(installDir), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return payload;
}

function clearIdentity(installDir = __dirname) {
  try {
    fs.unlinkSync(identityPath(installDir));
    return true;
  } catch {
    return false;
  }
}

/**
 * Liste des membres proposés au choix : les 5 de roster.json + ceux ajoutés
 * depuis #admin (rosterOverlay/members), moins ceux masqués.
 */
function buildMemberChoices(roster = [], overlay = null) {
  const hidden = overlay?.hiddenMembers || {};
  const staticChoices = (Array.isArray(roster) ? roster : []).map(player => ({
    id: slugifyMemberName(player?.name),
    name: String(player?.name || ''),
    role: String(player?.role || ''),
  }));
  const knownIds = new Set(staticChoices.map(choice => choice.id));
  const overlayChoices = Object.entries(overlay?.members || {})
    .filter(([id]) => !knownIds.has(id))
    .map(([id, member]) => ({ id, name: String(member?.name || id), role: String(member?.role || '') }));

  return [...staticChoices, ...overlayChoices]
    .filter(choice => choice.id && choice.name && !hidden[choice.id]);
}

/**
 * Interprète la réponse tapée par l'utilisateur : un numéro de la liste, un
 * nom de membre, ou "autre" / "a" pour créer une nouvelle personne.
 */
function parseIdentityChoice(input, choices = []) {
  const raw = String(input ?? '').trim();
  if (!raw) return { type: 'invalid' };

  const normalized = slugifyMemberName(raw);
  if (normalized === 'autre' || normalized === 'a' || normalized === 'other') return { type: 'other' };

  if (/^\d+$/.test(raw)) {
    const index = Number.parseInt(raw, 10) - 1;
    if (index >= 0 && index < choices.length) return { type: 'member', member: choices[index] };
    if (index === choices.length) return { type: 'other' }; // le "Autre" affiché en dernier
    return { type: 'invalid' };
  }

  const byName = choices.find(choice => slugifyMemberName(choice.name) === normalized || choice.id === normalized);
  if (byName) return { type: 'member', member: byName };
  return { type: 'invalid' };
}

/** Valide le nom saisi pour une nouvelle personne. Retourne null si inutilisable. */
function normalizeNewMemberName(raw) {
  const name = String(raw ?? '').trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 32) return null;
  if (!slugifyMemberName(name)) return null;
  return name;
}

module.exports = {
  IDENTITY_FILENAME,
  identityPath,
  slugifyMemberName,
  readIdentity,
  writeIdentity,
  clearIdentity,
  buildMemberChoices,
  parseIdentityChoice,
  normalizeNewMemberName,
};
