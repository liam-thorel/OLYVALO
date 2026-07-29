const assert = require('node:assert/strict');
const { legacyCleanupScript } = require('../live/legacy-cleanup.js');

const script = legacyCleanupScript();

assert.match(script, /olycity-live\.exe/i);
assert.match(script, /olycity\[_-\]live/);
assert.match(script, /python\.exe/);
assert.match(script, /pythonw\.exe/);
assert.match(script, /Stop-Process/);
assert.doesNotMatch(script, /node\.exe/i, 'the current autonomous Node process must never be targeted');

console.log('legacy-cleanup: only obsolete Python builds are targeted');
