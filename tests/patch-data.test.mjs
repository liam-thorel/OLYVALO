import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const readJson = path => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));

test('patch 13.06 preserves the official competitive map rotation', () => {
  const meta = readJson('../data/meta.json');
  const comps = readJson('../data/comps.json');
  const mapNames = comps.map(entry => entry.map);

  assert.equal(meta.currentPatch, '13.06');
  assert.deepEqual(mapNames, meta.mapsInRotation);
  assert.ok(mapNames.includes('Abyss'));
  assert.ok(!mapNames.includes('Breeze'));
});

test('every map exposes exactly ranked, pro and fun five-player compositions', () => {
  const comps = readJson('../data/comps.json');
  for (const map of comps) {
    assert.equal(map.comps.length, 3, `${map.map} doit proposer exactement trois compositions`);
    assert.deepEqual(map.comps.map(comp => comp.tier), ['S', 'PRO', 'FUN'], `${map.map} doit garder ranked, pro puis fun`);
    for (const comp of map.comps) {
      assert.equal(comp.agents.length, 5, `${map.map} / ${comp.label} doit contenir cinq agents`);
      assert.equal(new Set(comp.agents).size, 5, `${map.map} / ${comp.label} ne doit pas contenir de doublon`);
      assert.ok(!Object.hasOwn(comp, 'winrate'), `${map.map} / ${comp.label} ne doit pas inventer de winrate`);
      assert.ok(!Object.hasOwn(comp, 'agility'), `${map.map} / ${comp.label} ne doit pas afficher de score estimé`);
    }
    assert.ok(!Object.hasOwn(map, 'lineups'), `${map.map} ne doit pas garder l’ancien format de lineups`);
  }
});

test('lineups only cover maps that are still displayed', () => {
  const comps = readJson('../data/comps.json');
  const lineups = readJson('../data/lineups.json');
  const activeMaps = new Set(comps.map(entry => entry.map));

  for (const [map, agents] of Object.entries(lineups)) {
    assert.ok(activeMaps.has(map), `${map} ne doit pas rester dans les lineups hors rotation`);
    assert.ok(Object.keys(agents).length > 0, `${map} doit avoir au moins un agent couvert`);
  }
});

test('every map separates a sourced ranked recommendation from an observed pro composition', () => {
  const comps = readJson('../data/comps.json');
  for (const map of comps) {
    const [ranked, pro] = map.comps;

    assert.equal(ranked.label, 'Ranked · recommandée', `${map.map} doit commencer par la comp ranked`);
    assert.equal(ranked.tier, 'S', `${map.map} doit identifier la recommandation ranked`);
    assert.match(ranked.source, /MetaBot/, `${map.map} doit sourcer ses données ranked`);
    assert.match(ranked.vods?.[0]?.url || '', /metabot\.gg/, `${map.map} doit lier ses statistiques ranked`);

    assert.equal(pro.label, 'Joue comme un pro', `${map.map} doit proposer une comp professionnelle`);
    assert.equal(pro.tier, 'PRO', `${map.map} doit identifier la comp professionnelle`);
    assert.match(pro.vods?.[0]?.url || '', /vlr\.gg/, `${map.map} doit lier le match professionnel observé`);
    assert.equal(pro.tip, undefined, `${map.map} ne doit pas attribuer une stratégie non sourcée aux pros`);
    assert.equal(pro.teamPresets?.length, 3, `${map.map} doit proposer trois équipes professionnelles`);
    assert.equal(pro.teamPresets[0].id, 'kc', `${map.map} doit donner la priorité à KC`);
    assert.equal(pro.teamPresets[1].id, 'prx', `${map.map} doit proposer Paper Rex juste après KC`);
    assert.ok(!pro.teamPresets.some(preset => preset.id === 'm8'), `${map.map} ne doit plus proposer Gentle Mates`);
    for (const preset of pro.teamPresets) {
      assert.equal(preset.agents.length, 5, `${map.map} / ${preset.team} doit avoir cinq agents`);
      assert.match(preset.url, /vlr\.gg/, `${map.map} / ${preset.team} doit lier la feuille de match`);
      assert.match(preset.date, /^2026-0[7-9]-/, `${map.map} / ${preset.team} doit venir de la méta récente`);
      assert.match(preset.patch, /^13\.0[1245]$/, 'Le patch observé doit rester celui du match, pas celui du site');
      assert.ok(preset.logo?.startsWith('./assets/teams/'), `${map.map} / ${preset.team} doit utiliser un logo local`);
    }

    for (const comp of [ranked, pro]) {
      assert.equal(comp.patch, '13.06', `${map.map} / ${comp.label} doit être à jour`);
      assert.ok(comp.source, `${map.map} / ${comp.label} doit afficher sa source`);
      if (comp.key) assert.ok(comp.agents.includes(comp.key), `${map.map} / ${comp.label} doit avoir un key pick présent`);
    }
  }
});

test('Champions review keeps recent sourced PRX and Team Liquid compositions', () => {
  const comps = readJson('../data/comps.json');
  const expectedPrx = {
    Haven:  { date: '2026-09-29', patch: '13.05', match: '753456', score: '13-11' },
    Abyss:  { date: '2026-08-28', patch: '13.04', match: '742482', score: '13-11' },
    Lotus:  { date: '2026-09-29', patch: '13.05', match: '753456', score: '13-9' },
    Split:  { date: '2026-09-29', patch: '13.05', match: '753456', score: '9-13' },
    Ascent: { date: '2026-09-24', patch: '13.05', match: '753455', score: '13-4' },
    Sunset: { date: '2026-08-29', patch: '13.04', match: '742484', score: '10-13' },
    Summit: { date: '2026-07-31', patch: '13.01', match: '698904', score: '13-10' }
  };

  for (const map of comps) {
    const [ranked, pro] = map.comps;
    assert.equal(ranked.sourcePatch, '13.04');
    assert.deepEqual(pro.agents, pro.teamPresets[0].agents);
    assert.equal(pro.vods[0].url, pro.teamPresets[0].url);
    const prx = pro.teamPresets.find(preset => preset.id === 'prx');
    const expected = expectedPrx[map.map];
    assert.ok(prx, `${map.map} doit proposer Paper Rex`);
    assert.equal(prx.date, expected.date);
    assert.equal(prx.patch, expected.patch);
    assert.equal(prx.score, expected.score);
    assert.match(prx.url, new RegExp(expected.match));
  }

  for (const mapName of ['Haven', 'Lotus', 'Ascent']) {
    const pro = comps.find(map => map.map === mapName).comps[1];
    const liquid = pro.teamPresets.find(preset => preset.id === 'liquid');
    assert.equal(liquid.date, '2026-09-24');
    assert.equal(liquid.patch, '13.05');
    assert.match(liquid.url, /753455/);
  }

  const expectedKc = {
    Haven:  { agents: ['Omen', 'Sova', 'Phoenix', 'Neon', 'Cypher'], score: '9-13', game: '283204' },
    Ascent: { agents: ['Cypher', 'Neon', 'Phoenix', 'Omen', 'Sova'], score: '13-7', game: '283202' },
    Summit: { agents: ['Viper', 'Omen', 'Fade', 'Neon', 'Chamber'], score: '11-13', game: '283203' }
  };
  for (const [mapName, expected] of Object.entries(expectedKc)) {
    const pro = comps.find(map => map.map === mapName).comps[1];
    const kc = pro.teamPresets.find(preset => preset.id === 'kc');
    assert.deepEqual(kc.agents, expected.agents);
    assert.equal(kc.opponent, 'NRG');
    assert.equal(kc.date, '2026-09-29');
    assert.equal(kc.patch, '13.05');
    assert.equal(kc.score, expected.score);
    assert.match(kc.url, new RegExp(expected.game));
  }

  const split = comps.find(map => map.map === 'Split').comps[1];
  assert.equal(split.teamPresets[1].score, '9-13', 'Conserver aussi les défaites récentes de PRX');
  const summit = comps.find(map => map.map === 'Summit').comps[1];
  assert.deepEqual(summit.teamPresets[1].agents, ['Viper', 'Harbor', 'Tejo', 'Gekko', 'Waylay']);
});

test('Agent Select reuses the versioned composition data loaded by the site', () => {
  const interactions = readFileSync(new URL('../js/interactions.js', import.meta.url), 'utf8');
  assert.match(interactions, /Promise\.resolve\(state\.COMPS_DATA\)/);
  assert.doesNotMatch(interactions, /fetch\(['"]\.\/data\/comps\.json/);
  assert.match(interactions, /pick\('FUN', 'F'\)/);
});

test('every map has one current and displayable fun challenge', () => {
  const comps = readJson('../data/comps.json');
  for (const map of comps) {
    const fun = map.comps.find(comp => comp.tier === 'FUN');
    assert.ok(fun, `${map.map} doit proposer une composition fun`);
    assert.equal(fun.patch, '13.06', `${map.map} / fun doit être à jour`);
    assert.equal(fun.agents.length, 5, `${map.map} / fun doit contenir cinq agents`);
    assert.equal(new Set(fun.agents).size, 5, `${map.map} / fun ne doit pas contenir de doublon`);
    assert.ok(fun.source, `${map.map} / fun doit expliquer son origine`);
    assert.ok(fun.key && fun.agents.includes(fun.key), `${map.map} / fun doit avoir un key pick présent`);
  }
});
