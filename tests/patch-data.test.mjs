import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const readJson = path => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));

test('patch 13.05 preserves the official competitive map rotation', () => {
  const meta = readJson('../data/meta.json');
  const comps = readJson('../data/comps.json');
  const mapNames = comps.map(entry => entry.map);

  assert.equal(meta.currentPatch, '13.05');
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
    if (map.map !== 'Abyss') assert.equal(pro.teamPresets[1].id, 'm8', `${map.map} doit proposer Gentle Mates`);
    for (const preset of pro.teamPresets) {
      assert.equal(preset.agents.length, 5, `${map.map} / ${preset.team} doit avoir cinq agents`);
      assert.match(preset.url, /vlr\.gg/, `${map.map} / ${preset.team} doit lier la feuille de match`);
      assert.match(preset.date, /^2026-0[7-8]-/, `${map.map} / ${preset.team} doit venir de la méta récente`);
      assert.match(preset.patch, /^13\.0[124]$/, 'Le patch observé doit rester celui du match, pas celui du site');
      assert.ok(preset.logo?.startsWith('./assets/teams/'), `${map.map} / ${preset.team} doit utiliser un logo local`);
    }

    for (const comp of [ranked, pro]) {
      assert.equal(comp.patch, '13.05', `${map.map} / ${comp.label} doit être à jour`);
      assert.ok(comp.source, `${map.map} / ${comp.label} doit afficher sa source`);
      if (comp.key) assert.ok(comp.agents.includes(comp.key), `${map.map} / ${comp.label} doit avoir un key pick présent`);
    }
  }
});

test('September review preserves ranked samples and identifies actual finals compositions', () => {
  const comps = readJson('../data/comps.json');
  for (const map of comps) {
    const [ranked, pro] = map.comps;
    assert.equal(ranked.sourcePatch, '13.04');
    assert.deepEqual(pro.agents, pro.teamPresets[0].agents);
    assert.equal(pro.vods[0].url, pro.teamPresets[0].url);
    if (['Sunset', 'Ascent', 'Lotus', 'Summit'].includes(map.map)) {
      for (const preset of [pro.teamPresets[0], pro.teamPresets[2]]) {
        assert.equal(preset.date, '2026-08-30');
        assert.equal(preset.patch, '13.04');
        assert.match(preset.url, /731401/);
      }
    }
    const m8 = pro.teamPresets.find(preset => preset.id === 'm8');
    if (m8) assert.ok(m8.date <= '2026-08-12', 'Ne pas inventer de nouvelle rencontre M8');
  }
  const lotus = comps.find(map => map.map === 'Lotus').comps[1];
  assert.equal(lotus.teamPresets[0].score, '7-13', 'Conserver aussi les défaites des équipes préférées');
  const summit = comps.find(map => map.map === 'Summit').comps[1];
  assert.deepEqual(summit.teamPresets[2].agents, ['Omen', 'Viper', 'Sova', 'Jett', 'Phoenix']);
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
    assert.equal(fun.patch, '13.05', `${map.map} / fun doit être à jour`);
    assert.equal(fun.agents.length, 5, `${map.map} / fun doit contenir cinq agents`);
    assert.equal(new Set(fun.agents).size, 5, `${map.map} / fun ne doit pas contenir de doublon`);
    assert.ok(fun.source, `${map.map} / fun doit expliquer son origine`);
    assert.ok(fun.key && fun.agents.includes(fun.key), `${map.map} / fun doit avoir un key pick présent`);
  }
});
