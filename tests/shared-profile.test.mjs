import test from 'node:test';
import assert from 'node:assert/strict';
import { sharedProfileId, rememberSharedProfile } from '../js/shared-profile.mjs';
test('shared display profiles validate ids and ignore unrelated cookies', () => {
  assert.equal(sharedProfileId({ cookie:'other=1; olycity-display-profile=nico' }), 'nico');
  assert.equal(sharedProfileId({ cookie:'olycity-display-profile=%3Cscript%3E' }), '');
  assert.equal(sharedProfileId({ cookie:'olycity-display-profile=%' }), '');
});
test('display preference is shared only on the HTTPS OLYCITY domain', () => {
  const doc = { cookie:'' };
  rememberSharedProfile('nico', doc, { protocol:'https:', hostname:'tracker.olycity.fr' });
  assert.match(doc.cookie, /Domain=olycity.fr.*SameSite=Lax; Secure/);
  const local = { cookie:'' };
  rememberSharedProfile('nico', local, { protocol:'http:', hostname:'localhost' });
  assert.equal(local.cookie, '');
});
