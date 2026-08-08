const assert = require('node:assert/strict');
const Module = require('node:module');

// discord-bot/config.js exige DISCORD_TOKEN/CLIENT_ID au require : on stubbe
// juste ce qu'il faut pour tester la résolution d'identité isolément.
const originalLoad = Module._load;
Module._load = function stubbed(request, parent, isMain) {
  if (request === './config.js' || request === './firebase.js') {
    return request === './config.js'
      ? { ROSTER_URL: 'http://localhost/roster.json' }
      : { fbGet: async () => null };
  }
  return originalLoad(request, parent, isMain);
};
const roster = require('../discord-bot/roster.js');
Module._load = originalLoad;

// On rejoue l'indexation telle que le bot la fait après un fetch.
const { indexRoster } = roster.__test || {};
assert.ok(indexRoster, 'indexRoster doit être exposé pour les tests');

indexRoster(
  [{ name: 'Nico', avatar: 'https://cdn.discordapp.com/avatars/295547782880559107/x.png' }],
  {
    members: { logan: { name: 'Logan' } },
    accounts: {
      nico: { 'puuid-nico': { name: 'AncienPseudo', tag: 'EUW', puuid: 'puuid-nico' } },
      logan: { pushid: { name: 'LoganMain', tag: 'OLY' } }, // entrée héritée, sans puuid
    },
  },
);

// 1. Le chemin historique marche toujours.
assert.equal(roster.memberByRiotId('ancienpseudo#EUW')?.name, 'Nico');

// 2. Le cas qui cassait : Nico se renomme, plus aucun Riot ID ne correspond.
const renamed = { playerName: 'NouveauPseudo#OLY', puuid: 'puuid-nico', memberId: 'nico' };
assert.equal(roster.memberByRiotId(renamed.playerName), null, 'le Riot ID seul ne résout plus rien');
assert.equal(roster.memberByIdentity(renamed)?.name, 'Nico', 'le memberId rattrape le renommage');

// 3. Sans memberId (script pas encore mis à jour), le PUUID sauve la mise.
assert.equal(
  roster.memberByIdentity({ playerName: 'NouveauPseudo#OLY', puuid: 'puuid-nico' })?.name,
  'Nico',
  'le PUUID est le second filet',
);

// 4. Ancien script, ancien compte sans puuid : le repli Riot ID reste actif.
assert.equal(roster.memberByIdentity({ playerName: 'LoganMain#OLY' })?.name, 'Logan');

// 5. Un inconnu reste inconnu (il doit continuer d'aller dans "découverts").
assert.equal(roster.memberByIdentity({ playerName: 'Random#123', puuid: 'puuid-random' }), null);
assert.equal(roster.memberByIdentity(null), null);

// 6. Un memberId qui ne correspond à personne ne doit pas masquer les replis.
assert.equal(
  roster.memberByIdentity({ memberId: 'supprime', playerName: 'LoganMain#OLY' })?.name,
  'Logan',
);

console.log('roster-identity: résolution memberId → puuid → Riot ID validée');
