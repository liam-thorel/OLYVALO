const assert = require('node:assert/strict');
const { collectEquippedIds, findSubject } = require('../live/probe-loadouts.js');

// La sonde ne peut tourner que sur un PC en partie. Son analyse de la réponse,
// elle, doit être vérifiable ici : une lecture ratée répondrait « non, pas
// d'ennemis » sur une réponse qui les contenait, et on abandonnerait une
// fonctionnalité réalisable.

// Forme attendue de /core-game/v1/matches/{id}/loadouts : les objets équipés
// sont imbriqués sous Items → Sockets → Item, à une profondeur qu'on ne veut
// pas coder en dur puisqu'elle peut changer d'un patch à l'autre.
const loadout = subject => ({
  CharacterID: 'add6443a-41bd-e414-f6ad-e58d267f4e95',
  Loadout: {
    Subject: subject,
    Sprays: { SpraySlots: [{ EquipSlotID: 's1', SprayID: 'aaaaaaaa-0000-0000-0000-000000000001' }] },
    Items: {
      '9c82e19d-4575-0200-1a81-3eacf00cf872': { // Vandal
        ID: '9c82e19d-4575-0200-1a81-3eacf00cf872',
        TypeID: '',
        Sockets: {
          'bcef87d6-209b-46c6-8b19-fbe40bd95abc': { ID: 'skin', Item: { ID: 'SKIN-VANDAL', TypeID: 't' } },
          '3ad1b2b2-acdb-4524-852f-954a76ddae0a': { ID: 'chroma', Item: { ID: 'CHROMA-VANDAL', TypeID: 't' } },
        },
      },
      '2f59173c-4bed-b6c3-2191-dea9b58be9c7': { // Couteau
        ID: '2f59173c-4bed-b6c3-2191-dea9b58be9c7',
        Sockets: { 'bcef87d6-209b-46c6-8b19-fbe40bd95abc': { ID: 'skin', Item: { ID: 'SKIN-MELEE', TypeID: 't' } } },
      },
    },
  },
});

// ─── Les objets équipés sont trouvés quelle que soit la profondeur ───────────
const ids = collectEquippedIds([loadout('p1'), loadout('p2')]);
assert.ok(ids.has('skin-vandal'), 'le skin de Vandal doit être trouvé');
assert.ok(ids.has('chroma-vandal'), 'la chroma aussi');
assert.ok(ids.has('skin-melee'), 'le couteau aussi — c’est le plus regardé');
assert.equal(ids.size, 3, 'les doublons entre joueurs sont dédupliqués');

// Les UUID sont normalisés en minuscules : valorant-api.com les renvoie ainsi,
// et Riot mélange les casses selon les endpoints.
assert.ok(collectEquippedIds([{ Item: { ID: 'AbCdEf' } }]).has('abcdef'));

// Seuls les objets sous une clé "Item" comptent. L'UUID d'une ARME n'est pas un
// objet équipé : le compter gonflerait le total et fausserait la mesure.
assert.equal(collectEquippedIds([loadout('p1')]).has('9c82e19d-4575-0200-1a81-3eacf00cf872'), false);

// ─── Robustesse : la sonde ne doit jamais planter sur une forme inattendue ──
for (const odd of [null, undefined, {}, [], { Item: null }, { Item: {} }, { Item: { ID: 42 } }, 'texte', 0]) {
  assert.doesNotThrow(() => collectEquippedIds(odd), `entrée inattendue : ${JSON.stringify(odd)}`);
}
assert.equal(collectEquippedIds(null).size, 0);

// Structure profondément imbriquée : pas de récursion infinie sur les tableaux.
assert.equal(collectEquippedIds([[[{ Item: { ID: 'X' } }]]]).size, 1);

// ─── Rattachement joueur → loadout ───────────────────────────────────────────
// S'il y a un PUUID dans la réponse, on s'en sert ; sinon on retombe sur
// l'ordre du tableau. Se tromper ici attribuerait les skins au mauvais joueur.
assert.equal(findSubject(loadout('joueur-1-uuid')), 'joueur-1-uuid');
assert.equal(findSubject({ Loadout: { subject: 'minuscule-uuid' } }), 'minuscule-uuid');
assert.equal(findSubject({ Loadout: { PlayerID: 'autre-uuid' } }), 'autre-uuid');

// Pas de PUUID : null, et l'appelant bascule sur l'alignement par position.
assert.equal(findSubject({ CharacterID: 'abc' }), null);
assert.equal(findSubject({}), null);
assert.equal(findSubject(null), null);

// Un Subject sans tiret n'est pas un PUUID — on ne veut pas confondre un
// identifiant de slot avec un joueur.
assert.equal(findSubject({ Subject: 'slot1' }), null);

// La recherche est bornée en profondeur : un objet cyclique ne doit pas
// boucler. (Les réponses Riot sont du JSON, mais la sonde lit aussi des
// fichiers rejoués à la main.)
const cyclic = { a: {} };
cyclic.a.b = cyclic;
assert.doesNotThrow(() => findSubject(cyclic));

console.log('probe-loadouts: la sonde lit correctement les objets équipés et rattache les joueurs');
