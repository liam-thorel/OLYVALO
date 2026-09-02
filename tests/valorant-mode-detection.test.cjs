const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  normalizeValorantMode,
  valorantModeLabel,
  valorantModeFamily,
  supportsStandardComps,
} = require('../live/valorant-mode-utils.js');

test('normalizes Riot queue identifiers used by current live modes', () => {
  const expected = {
    competitive: 'competitive', unrated: 'unrated', swiftplay: 'swiftplay',
    spikerush: 'spikerush', deathmatch: 'deathmatch', hurm: 'hurm',
    ggteam: 'ggteam', onefa: 'onefa', snowball: 'snowball', newmap: 'newmap',
    premier: 'premier', custom: 'custom',
  };
  for (const [raw, canonical] of Object.entries(expected)) {
    assert.equal(normalizeValorantMode(raw), canonical, raw);
  }
});

test('recognizes internal game-mode assets when QueueID is absent', () => {
  assert.equal(normalizeValorantMode('/Game/GameModes/HURM/HURM_PrimaryAsset.HURM_PrimaryAsset'), 'hurm');
  assert.equal(normalizeValorantMode('/Game/GameModes/Deathmatch/DeathmatchGameMode_PrimaryAsset'), 'deathmatch');
  assert.equal(normalizeValorantMode('/Game/GameModes/GunGame/GunGameTeamsGameMode_PrimaryAsset'), 'ggteam');
  assert.equal(normalizeValorantMode('/Game/GameModes/OneForAll/OneForAll_GameMode_DataAsset_Desktop'), 'onefa');
  assert.equal(normalizeValorantMode('/Game/GameModes/QuickBomb/QuickBombGameMode_PrimaryAsset'), 'spikerush');
  assert.equal(normalizeValorantMode('/Game/GameModes/FortCollins/FortCollins_PrimaryAsset'), 'fortcollins');
  assert.equal(normalizeValorantMode('/Game/GameModes/Bomb/BombGameMode_PrimaryAsset', 'competitive'), 'competitive');
  assert.equal(normalizeValorantMode('/Game/GameModes/HURM/HURM_PrimaryAsset', 'competitive'), 'hurm');
});

test('keeps Team Deathmatch distinct from free-for-all Deathmatch', () => {
  assert.equal(valorantModeLabel('hurm'), 'Team Deathmatch');
  assert.equal(valorantModeFamily('hurm'), 'team-deathmatch');
  assert.equal(valorantModeFamily('deathmatch'), 'free-for-all');
  assert.equal(normalizeValorantMode('Team Deathmatch'), 'hurm');
  assert.equal(supportsStandardComps('hurm'), false);
  assert.equal(supportsStandardComps('competitive'), true);
});

test('the script publishes mode metadata and the Live page consumes it', () => {
  const root = path.join(__dirname, '..');
  const script = fs.readFileSync(path.join(root, 'live', 'index.js'), 'utf8');
  const page = fs.readFileSync(path.join(root, 'js', 'interactions.js'), 'utf8');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'live', 'update-manifest.json'), 'utf8'));
  assert.ok(manifest.files.includes('valorant-mode-utils.js'));
  assert.match(script, /queueId:\s*state\.mode/);
  assert.match(script, /modeFamily:\s*valorantModeFamily\(queueId\)/);
  assert.match(script, /supportsComps:\s*supportsStandardComps\(queueId\)/);
  assert.match(script, /persistentMatchId !== stableMatchId \|\| pregameState/);
  assert.match(script, /modeFamily:\s*valorantModeFamily\(stableMode\)/);
  assert.match(page, /hurm:'Team Deathmatch'/);
  assert.match(page, /data\.modeFamily === 'free-for-all'/);
  assert.match(page, /data\.supportsComps === false/);
});
