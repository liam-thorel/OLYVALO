/**
 * Skins équipés des dix joueurs d'une partie, alliés ET adversaires.
 *
 * Confirmé par live/probe-loadouts.js sur une vraie partie :
 * /core-game/v1/matches/{id}/loadouts renvoie bien les dix loadouts.
 *
 * Deux enseignements de cette sonde dictent ce module :
 *
 *   1. La réponse brute pèse 17 Ko PAR JOUEUR (174 Ko pour dix). Republier ça
 *      à chaque poll noierait Firebase et le site. On ne garde donc qu'une
 *      poignée d'armes, réduites à un nom et une image : ~6 Ko pour dix
 *      joueurs, soit 3 % du brut.
 *
 *   2. Sur les 549 objets équipés distincts, seuls 141 sont des skins d'arme ;
 *      le reste est chromas, breloques, sprays, cartes et titres. Et parmi les
 *      skins, beaucoup sont les skins PAR DÉFAUT (« Ghost », « Classic »,
 *      « Standard Melee »), qui n'apprennent rien à personne. On les écarte.
 */

// Le couteau d'abord : c'est le seul que tout le monde regarde. Les autres
// sont les armes réellement jouées en classé.
const FEATURED_WEAPONS = ['melee', 'vandal', 'phantom', 'operator', 'sheriff'];

/**
 * uuid d'arme → { name, defaultLevels }.
 *
 * defaultLevels vient de weapon.skins[0], qui est le skin d'origine chez
 * valorant-api. On s'appuie sur les UUID plutôt que sur les noms : « Ghost »
 * désigne à la fois l'arme et son skin par défaut, et un test sur le nom
 * écarterait par erreur un vrai skin qui porterait le même mot.
 */
function buildWeaponIndex(weaponsPayload) {
  const index = new Map();
  (weaponsPayload?.data || []).forEach(weapon => {
    const name = String(weapon.displayName || '').toLowerCase();
    const defaultLevels = new Set(
      (weapon.skins?.[0]?.levels || []).map(level => String(level.uuid || '').toLowerCase()),
    );
    index.set(String(weapon.uuid || '').toLowerCase(), { name, defaultLevels });
  });
  return index;
}

/** uuid de niveau de skin → { name, icon }. */
function buildSkinLevelIndex(skinLevelsPayload) {
  const index = new Map();
  (skinLevelsPayload?.data || []).forEach(level => {
    index.set(String(level.uuid || '').toLowerCase(), {
      name: level.displayName || '',
      icon: level.displayIcon || '',
    });
  });
  return index;
}

/** Tous les objets équipés d'une entrée d'arme, quelle que soit sa profondeur. */
function equippedIds(node, found = []) {
  if (!node || typeof node !== 'object') return found;
  if (Array.isArray(node)) {
    node.forEach(child => equippedIds(child, found));
    return found;
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === 'Item' && value && typeof value.ID === 'string') found.push(value.ID.toLowerCase());
    equippedIds(value, found);
  }
  return found;
}

// Le loadout porte parfois le PUUID du joueur ; sinon on s'aligne sur l'ordre
// du tableau Players, que Riot garde cohérent entre les deux réponses.
function subjectOf(node, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 4) return null;
  for (const key of ['Subject', 'subject', 'PlayerID']) {
    if (typeof node[key] === 'string' && node[key].includes('-')) return node[key];
  }
  for (const value of Object.values(node)) {
    const found = subjectOf(value, depth + 1);
    if (found) return found;
  }
  return null;
}

/**
 * Réduit la réponse brute à ce qui sera publié :
 *   { [puuid]: [{ weapon, skin, icon }] }
 *
 * Une arme sans skin notable n'apparaît pas — inutile d'occuper de la place
 * pour dire que quelqu'un joue avec le Vandal d'origine.
 */
function curateLoadouts({ loadouts = [], players = [], weaponIndex, skinLevels, featured = FEATURED_WEAPONS }) {
  const wanted = new Set(featured);
  const result = {};

  loadouts.forEach((entry, index) => {
    const puuid = subjectOf(entry) || players[index]?.Subject || '';
    if (!puuid) return;

    const items = entry?.Loadout?.Items || entry?.Items || {};
    const weapons = [];

    for (const [weaponId, weaponEntry] of Object.entries(items)) {
      const weapon = weaponIndex.get(String(weaponId).toLowerCase());
      if (!weapon || !wanted.has(weapon.name)) continue;

      // Parmi les objets équipés de cette arme, on cherche celui qui est un
      // niveau de skin connu ; les chromas et breloques ne résolvent pas ici.
      const skinId = equippedIds(weaponEntry).find(id => skinLevels.has(id));
      if (!skinId || weapon.defaultLevels.has(skinId)) continue; // skin d'origine

      const skin = skinLevels.get(skinId);
      if (!skin?.name) continue;
      weapons.push({ weapon: weapon.name, skin: skin.name, icon: skin.icon || '' });
    }

    if (weapons.length === 0) return;
    // Ordre stable et lisible : couteau en tête, puis l'ordre de FEATURED.
    weapons.sort((a, b) => featured.indexOf(a.weapon) - featured.indexOf(b.weapon));
    result[puuid] = weapons;
  });

  return result;
}

module.exports = {
  buildWeaponIndex, buildSkinLevelIndex, curateLoadouts, equippedIds, subjectOf,
  FEATURED_WEAPONS,
};
