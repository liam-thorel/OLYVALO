import assert from 'node:assert/strict';
import { avatarLayersHTML } from '../js/avatars.mjs';

const full = avatarLayersHTML('Nico', 'https://example.com/avatar.png', 'https://example.com/agent.png');
assert.match(full, /user-avatar-initial/);
assert.match(full, /user-avatar-fallback-image/);
assert.match(full, /user-avatar-primary/);

const fallbackOnly = avatarLayersHTML('Mathis', '', 'https://example.com/agent.png');
assert.doesNotMatch(fallbackOnly, /user-avatar-primary/);
assert.match(fallbackOnly, /user-avatar-fallback-image/);

const initialOnly = avatarLayersHTML('Guest');
assert.match(initialOnly, />G<\/span>/);
assert.doesNotMatch(initialOnly, /<img/);

const escaped = avatarLayersHTML('A<"', 'https://example.com/a".png');
assert.match(escaped, /A&lt;&quot;/);
assert.match(escaped, /a&quot;\.png/);

console.log('avatars: primary, fallback and initial layers validated');
