const assert = require('node:assert/strict');
const {
  buildWeaponIndex, buildSkinLevelIndex, curateLoadouts, equippedIds, subjectOf, FEATURED_WEAPONS,
} = require('../live/loadouts.js');

// La sonde a confirmé sur une vraie partie que les dix loadouts reviennent.
// Elle a aussi montré deux choses que ce module doit traiter : le brut pèse
// 17 Ko par joueur, et une bonne part des skins trouvés sont ceux d'origine.

const VANDAL = '9c82e19d-4575-0200-1a81-3eacf00cf872';
const MELEE = '2f59173c-4bed-b6c3-2191-dea9b58be9c7';
const GHOST = '1baa85b4-4c70-1284-64bb-6481dfc3bb4e';

const weapons = buildWeaponIndex({ data: [
  { uuid: VANDAL, displayName: 'Vandal', skins: [{ levels: [{ uuid: 'VANDAL-DEFAUT' }] }] },
  { uuid: MELEE, displayName: 'Melee', skins: [{ levels: [{ uuid: 'MELEE-DEFAUT' }] }] },
  { uuid: GHOST, displayName: 'Ghost', skins: [{ levels: [{ uuid: 'GHOST-DEFAUT' }] }] },
]});

const skinLevels = buildSkinLevelIndex({ data: [
  { uuid: 'VANDAL-DEFAUT', displayName: 'Vandal', displayIcon: 'v0.png' },
  { uuid: 'MELEE-DEFAUT', displayName: 'Standard Melee', displayIcon: '' },
  { uuid: 'GHOST-DEFAUT', displayName: 'Ghost', displayIcon: 'g0.png' },
  { uuid: 'PRIME-VANDAL', displayName: 'Prime Vandal', displayIcon: 'prime.png' },
  { uuid: 'ELDERFLAME-MELEE', displayName: 'Elderflame Dagger', displayIcon: 'elder.png' },
]});

const weaponEntry = (id, ...equipped) => ({
  ID: id,
  Sockets: Object.fromEntries(equipped.map((item, i) => [`socket-${i}`, { ID: `s${i}`, Item: { ID: item } }])),
});

const loadout = (subject, items) => ({ CharacterID: 'x', Loadout: { Subject: subject, Items: items } });

// ─── Cas nominal ─────────────────────────────────────────────────────────────
const curated = curateLoadouts({
  loadouts: [loadout('p1', {
    [VANDAL]: weaponEntry(VANDAL, 'PRIME-VANDAL', 'CHROMA-INCONNU'),
    [MELEE]: weaponEntry(MELEE, 'ELDERFLAME-MELEE'),
  })],
  players: [{ Subject: 'p1' }],
  weaponIndex: weapons, skinLevels,
});

assert.deepEqual(curated.p1, [
  { weapon: 'melee', skin: 'Elderflame Dagger', icon: 'elder.png' },
  { weapon: 'vandal', skin: 'Prime Vandal', icon: 'prime.png' },
], 'le couteau passe en tête, et les chromas non résolus sont ignorés');

// ─── Les skins d'origine sont écartés ────────────────────────────────────────
// C'est ce que l'échantillon de la sonde montrait : Ghost, Classic, Standard
// Melee… Dire que quelqu'un joue avec le Vandal de base n'apprend rien.
const defaults = curateLoadouts({
  loadouts: [loadout('p1', {
    [VANDAL]: weaponEntry(VANDAL, 'VANDAL-DEFAUT'),
    [MELEE]: weaponEntry(MELEE, 'MELEE-DEFAUT'),
  })],
  players: [{ Subject: 'p1' }],
  weaponIndex: weapons, skinLevels,
});
assert.deepEqual(defaults, {}, 'un joueur sans aucun skin notable n’occupe pas de place');

// On écarte par UUID, pas par nom : « Ghost » désigne l'arme ET son skin
// d'origine, un test sur le nom écarterait un vrai skin qui le contiendrait.
const named = buildSkinLevelIndex({ data: [{ uuid: 'GHOST-SPECTRE', displayName: 'Ghost' }] });
const kept = curateLoadouts({
  loadouts: [loadout('p1', { [GHOST]: weaponEntry(GHOST, 'GHOST-SPECTRE') })],
  players: [{ Subject: 'p1' }],
  weaponIndex: weapons, skinLevels: named, featured: ['ghost'],
});
assert.equal(kept.p1?.[0]?.skin, 'Ghost', 'un skin homonyme mais distinct est conservé');

// ─── Armes hors sélection ────────────────────────────────────────────────────
// C'est ce qui fait passer la charge de 174 Ko à ~6 Ko.
const filtered = curateLoadouts({
  loadouts: [loadout('p1', { [GHOST]: weaponEntry(GHOST, 'GHOST-SPECTRE') })],
  players: [{ Subject: 'p1' }],
  weaponIndex: weapons, skinLevels: named,
});
assert.deepEqual(filtered, {}, 'le Ghost n’est pas dans la sélection par défaut');
assert.ok(FEATURED_WEAPONS.includes('melee'), 'le couteau est le plus regardé');

// ─── Rattachement joueur ↔ loadout ───────────────────────────────────────────
// Si le loadout ne porte pas de PUUID, on s'aligne sur l'ordre du tableau
// Players. Se tromper attribuerait les skins au mauvais joueur.
const byIndex = curateLoadouts({
  loadouts: [
    { Loadout: { Items: { [MELEE]: weaponEntry(MELEE, 'ELDERFLAME-MELEE') } } },
    { Loadout: { Items: { [VANDAL]: weaponEntry(VANDAL, 'PRIME-VANDAL') } } },
  ],
  players: [{ Subject: 'joueur-a' }, { Subject: 'joueur-b' }],
  weaponIndex: weapons, skinLevels,
});
assert.equal(byIndex['joueur-a']?.[0]?.skin, 'Elderflame Dagger');
assert.equal(byIndex['joueur-b']?.[0]?.skin, 'Prime Vandal');

assert.equal(subjectOf(loadout('abc-def', {})), 'abc-def');
assert.equal(subjectOf({ Subject: 'slot1' }), null, 'un identifiant de slot n’est pas un PUUID');
assert.equal(subjectOf(null), null);

// Sans PUUID ni joueur en face, on n'invente rien.
assert.deepEqual(curateLoadouts({
  loadouts: [{ Loadout: { Items: { [MELEE]: weaponEntry(MELEE, 'ELDERFLAME-MELEE') } } }],
  players: [], weaponIndex: weapons, skinLevels,
}), {});

// ─── Robustesse ──────────────────────────────────────────────────────────────
// La structure de Riot n'est garantie par rien : elle ne doit jamais faire
// tomber le script Live, qui tourne pendant la partie.
for (const broken of [null, undefined, {}, [], { Loadout: null }, { Loadout: { Items: null } }]) {
  assert.doesNotThrow(() => curateLoadouts({
    loadouts: [broken], players: [{ Subject: 'p1' }], weaponIndex: weapons, skinLevels,
  }), `entrée inattendue : ${JSON.stringify(broken)}`);
}
assert.deepEqual(curateLoadouts({ weaponIndex: weapons, skinLevels }), {});
assert.deepEqual(buildWeaponIndex(null).size, 0);
assert.deepEqual(buildSkinLevelIndex(undefined).size, 0);
assert.deepEqual(equippedIds(null), []);

// ─── Taille réelle de la charge utile ────────────────────────────────────────
// La sonde a mesuré 174 Ko pour dix joueurs en brut. On vérifie qu'après
// réduction on reste très en dessous — c'est la raison d'être du module.
const tenPlayers = curateLoadouts({
  loadouts: Array.from({ length: 10 }, (_, i) => loadout(`joueur-${i}`, {
    [VANDAL]: weaponEntry(VANDAL, 'PRIME-VANDAL'),
    [MELEE]: weaponEntry(MELEE, 'ELDERFLAME-MELEE'),
  })),
  players: [], weaponIndex: weapons, skinLevels,
});
assert.equal(Object.keys(tenPlayers).length, 10);
const bytes = Buffer.byteLength(JSON.stringify(tenPlayers));
assert.ok(bytes < 10 * 1024, `charge utile trop lourde : ${bytes} octets`);

console.log(`loadouts: dix joueurs réduits à ${bytes} octets (174 Ko en brut)`);
