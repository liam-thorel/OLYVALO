const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  buildMemberChoices, parseIdentityChoice, normalizeNewMemberName,
  readIdentity, writeIdentity, clearIdentity, slugifyMemberName, IDENTITY_FILENAME,
} = require('../live/identity.js');

// ─── Slug : doit correspondre exactement à celui du site et du bot ───────────
assert.equal(slugifyMemberName('Noé'), 'noe', 'les accents doivent tomber comme côté site');
assert.equal(slugifyMemberName('  Jean-Luc  '), 'jean-luc');
assert.equal(slugifyMemberName('!!!'), '');

// ─── Liste de choix ─────────────────────────────────────────────────────────
const roster = [{ name: 'Nico', role: 'IGL' }, { name: 'Noé', role: 'Flex' }];
const overlay = {
  members: { logan: { name: 'Logan' }, nico: { name: 'Doublon ignoré' } },
  hiddenMembers: { noe: true },
};
const choices = buildMemberChoices(roster, overlay);
assert.deepEqual(choices.map(c => c.id), ['nico', 'logan'], 'membre masqué exclu, doublon overlay ignoré');
assert.equal(choices[0].role, 'IGL');
assert.deepEqual(buildMemberChoices([], null), [], 'roster injoignable = aucun choix, pas de crash');

// ─── Interprétation de la réponse ───────────────────────────────────────────
assert.deepEqual(parseIdentityChoice('1', choices), { type: 'member', member: choices[0] });
assert.deepEqual(parseIdentityChoice('  2 ', choices), { type: 'member', member: choices[1] });
assert.deepEqual(parseIdentityChoice('Nico', choices), { type: 'member', member: choices[0] });
assert.deepEqual(parseIdentityChoice('nico', choices), { type: 'member', member: choices[0] });
assert.equal(parseIdentityChoice('3', choices).type, 'other', 'le numéro juste après la liste = Autre');
assert.equal(parseIdentityChoice('autre', choices).type, 'other');
assert.equal(parseIdentityChoice('Autre', choices).type, 'other');
assert.equal(parseIdentityChoice('', choices).type, 'invalid');
assert.equal(parseIdentityChoice('42', choices).type, 'invalid');
assert.equal(parseIdentityChoice('inconnu', choices).type, 'invalid');

// ─── Nom d'une nouvelle personne ────────────────────────────────────────────
assert.equal(normalizeNewMemberName('  Logan  '), 'Logan');
assert.equal(normalizeNewMemberName('Jean   Luc'), 'Jean Luc', 'espaces multiples compactés');
assert.equal(normalizeNewMemberName('L'), null, 'trop court');
assert.equal(normalizeNewMemberName('###'), null, 'aucun caractère exploitable');
assert.equal(normalizeNewMemberName('x'.repeat(33)), null, 'trop long');

// ─── Persistance ────────────────────────────────────────────────────────────
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'olycity-identity-'));
try {
  assert.equal(readIdentity(tempDir), null, 'aucune identité au départ');

  writeIdentity({
    memberId: 'logan', memberName: 'Logan', isNewMember: true,
    lastPuuid: '22222222-2222-5222-8222-222222222222', lastPlayerName: 'Logan#OLY',
  }, tempDir);
  const stored = readIdentity(tempDir);
  assert.equal(stored.memberId, 'logan');
  assert.equal(stored.memberName, 'Logan');
  assert.equal(stored.isNewMember, true);
  assert.equal(stored.lastPuuid, '22222222-2222-5222-8222-222222222222');
  assert.equal(stored.lastPlayerName, 'Logan#OLY');
  assert.ok(stored.chosenAt > 0, 'la date de choix est horodatée');

  fs.writeFileSync(path.join(tempDir, IDENTITY_FILENAME), '{ pas du json', 'utf8');
  assert.equal(readIdentity(tempDir), null, 'un fichier corrompu ne doit pas planter le script');

  fs.writeFileSync(path.join(tempDir, IDENTITY_FILENAME), JSON.stringify({ memberName: 'Sans id' }), 'utf8');
  assert.equal(readIdentity(tempDir), null, 'une identité incomplète est ignorée');

  writeIdentity({ memberId: 'nico', memberName: 'Nico' }, tempDir);
  assert.equal(clearIdentity(tempDir), true);
  assert.equal(readIdentity(tempDir), null);
  assert.equal(clearIdentity(tempDir), false, 'supprimer deux fois ne lève pas');
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}

console.log('identity: choix du membre, saisie libre et persistance validés');
