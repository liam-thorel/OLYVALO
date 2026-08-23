import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const readJson = path => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));

test('patch 13.04 exposes the official competitive map rotation', () => {
  const meta = readJson('../data/meta.json');
  const comps = readJson('../data/comps.json');
  const mapNames = comps.map(entry => entry.map);

  assert.equal(meta.currentPatch, '13.04');
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
    }
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
    assert.match(pro.vods?.[0]?.url || '', /rib\.gg/, `${map.map} doit lier le match professionnel observé`);

    for (const comp of [ranked, pro]) {
      assert.equal(comp.patch, '13.04', `${map.map} / ${comp.label} doit être à jour`);
      assert.ok(comp.source, `${map.map} / ${comp.label} doit afficher sa source`);
      if (comp.key) assert.ok(comp.agents.includes(comp.key), `${map.map} / ${comp.label} doit avoir un key pick présent`);
    }
  }
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
    assert.equal(fun.patch, '13.04', `${map.map} / fun doit être à jour`);
    assert.equal(fun.agents.length, 5, `${map.map} / fun doit contenir cinq agents`);
    assert.equal(new Set(fun.agents).size, 5, `${map.map} / fun ne doit pas contenir de doublon`);
    assert.ok(fun.source, `${map.map} / fun doit expliquer son origine`);
    assert.ok(fun.key && fun.agents.includes(fun.key), `${map.map} / fun doit avoir un key pick présent`);
  }
});
