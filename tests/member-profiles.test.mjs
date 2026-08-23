import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { memberId, mergeMemberProfiles, resolveMemberProfile } from '../js/member-profiles.mjs';

const roster = JSON.parse(fs.readFileSync(new URL('../data/roster.json', import.meta.url), 'utf8'));
const members = JSON.parse(fs.readFileSync(new URL('../data/members.json', import.meta.url), 'utf8'));

test('Romain is a site member without becoming a Valorant roster player', () => {
  const romain = members.find(member => member.id === 'romain');
  assert.equal(romain?.name, 'Romain');
  assert.match(romain?.avatar || '', /cdn\.discordapp\.com\/avatars\/344155681416544266\//);
  assert.equal(roster.some(player => player.name === 'Romain'), false);
});

test('site members merge with Admin additions and hidden members', () => {
  const profiles = mergeMemberProfiles({
    roster,
    members,
    overlay: {
      members: {
        romain: { name:'Romain', role:'Membre' },
        logan: { name:'Logan', avatar:'https://example.com/logan.png' },
      },
      hiddenMembers: { rayhan:true },
    },
  });
  assert.equal(profiles.filter(profile => profile.id === 'romain').length, 1);
  assert.equal(profiles.find(profile => profile.id === 'romain')?.role, 'Membre');
  assert.equal(profiles.some(profile => profile.id === 'logan'), true);
  assert.equal(profiles.some(profile => profile.id === 'rayhan'), false);
});

test('stored names migrate to stable member ids', () => {
  const profiles = mergeMemberProfiles({ roster, members });
  assert.equal(memberId('Noé'), 'noe');
  assert.equal(resolveMemberProfile(profiles, { name:'Noé' })?.id, 'noe');
  assert.equal(resolveMemberProfile(profiles, { id:'romain' })?.name, 'Romain');
});
