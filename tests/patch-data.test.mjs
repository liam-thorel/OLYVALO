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
    assert.equal(pro.teamPresets[2].id, 'loud', `${map.map} doit proposer LOUD, champion 2026, en troisième`);
    assert.ok(!pro.teamPresets.some(preset => preset.id === 'm8'), `${map.map} ne doit plus proposer Gentle Mates`);
    for (const preset of pro.teamPresets) {
      assert.equal(preset.agents.length, 5, `${map.map} / ${preset.team} doit avoir cinq agents`);
      assert.match(preset.url, /vlr\.gg/, `${map.map} / ${preset.team} doit lier la feuille de match`);
      assert.match(preset.date, /^2026-(0[7-9]|10)-/, `${map.map} / ${preset.team} doit venir de la méta récente`);
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

test('Champions 2026 review keeps the latest sourced KC, PRX and LOUD compositions', () => {
  const comps = readJson('../data/comps.json');
  // Dernière carte jouée par chaque équipe (vlr.gg). KC n'a pas joué Lotus ni
  // Split à Champions, PRX pas Abyss, LOUD pas Abyss : on garde leur dernier
  // match sur la carte avant Champions.
  const expected = {
    kc: {
      Haven:  { date: '2026-10-03', patch: '13.05', game: '283210', score: '6-13', agents: ['Sova', 'Phoenix', 'Neon', 'Omen', 'Cypher'] },
      Abyss:  { date: '2026-09-25', patch: '13.05', game: '283197', score: '13-6', agents: ['Yoru', 'Sova', 'Cypher', 'Omen', 'Waylay'] },
      Lotus:  { date: '2026-08-30', patch: '13.04', game: '279414', score: '7-13', agents: ['Omen', 'Viper', 'Fade', 'Chamber', 'Neon'] },
      Split:  { date: '2026-07-22', patch: '13.01', game: '276533', score: '15-17', agents: ['Omen', 'Viper', 'Fade', 'Sage', 'Raze'] },
      Ascent: { date: '2026-09-29', patch: '13.05', game: '283202', score: '13-7', agents: ['Cypher', 'Neon', 'Phoenix', 'Omen', 'Sova'] },
      Sunset: { date: '2026-10-03', patch: '13.05', game: '283208', score: '13-9', agents: ['Viper', 'Chamber', 'Omen', 'Neon', 'Fade'] },
      Summit: { date: '2026-10-03', patch: '13.05', game: '283209', score: '5-13', agents: ['Chamber', 'Viper', 'Neon', 'Fade', 'Omen'] },
    },
    prx: {
      Haven:  { date: '2026-09-29', patch: '13.05', game: '283188', score: '13-11', agents: ['Chamber', 'Astra', 'Phoenix', 'Fade', 'Yoru'] },
      Abyss:  { date: '2026-08-28', patch: '13.04', game: '281158', score: '13-11', agents: ['Harbor', 'Omen', 'Yoru', 'Sova', 'Waylay'] },
      Lotus:  { date: '2026-10-09', patch: '13.05', game: '283294', score: '7-13', agents: ['Yoru', 'Vyse', 'Raze', 'Fade', 'Omen'] },
      Split:  { date: '2026-10-07', patch: '13.05', game: '283274', score: '9-13', agents: ['Yoru', 'Raze', 'Omen', 'Viper', 'Fade'] },
      Ascent: { date: '2026-10-09', patch: '13.05', game: '283295', score: '13-6', agents: ['Sova', 'Omen', 'Yoru', 'Sage', 'Chamber'] },
      Sunset: { date: '2026-10-07', patch: '13.05', game: '283275', score: '13-15', agents: ['Fade', 'Chamber', 'Omen', 'Raze', 'Sage'] },
      Summit: { date: '2026-10-09', patch: '13.05', game: '283296', score: '11-13', agents: ['Sage', 'Viper', 'Omen', 'Neon', 'Fade'] },
    },
    loud: {
      Haven:  { date: '2026-10-18', patch: '13.05', game: '283289', score: '13-10', agents: ['Omen', 'Sova', 'Neon', 'Viper', 'Chamber'] },
      Abyss:  { date: '2026-09-05', patch: '13.04', game: '280058', score: '13-10', agents: ['Omen', 'Sova', 'Yoru', 'Waylay', 'Harbor'] },
      Lotus:  { date: '2026-10-18', patch: '13.05', game: '283287', score: '8-13', agents: ['Viper', 'Neon', 'Fade', 'Vyse', 'Omen'] },
      Split:  { date: '2026-10-07', patch: '13.05', game: '283274', score: '13-9', agents: ['Omen', 'Yoru', 'Viper', 'Fade', 'Neon'] },
      Ascent: { date: '2026-09-30', patch: '13.05', game: '285206', score: '7-13', agents: ['Yoru', 'Sova', 'Waylay', 'Cypher', 'Omen'] },
      Sunset: { date: '2026-10-18', patch: '13.05', game: '283288', score: '13-5', agents: ['Neon', 'Sage', 'Sova', 'Chamber', 'Omen'] },
      Summit: { date: '2026-10-18', patch: '13.05', game: '283286', score: '13-11', agents: ['Sage', 'Omen', 'Fade', 'Chamber', 'Neon'] },
    },
  };

  for (const map of comps) {
    const [ranked, pro] = map.comps;
    assert.equal(ranked.sourcePatch, '13.04');
    assert.deepEqual(pro.agents, pro.teamPresets[0].agents);
    assert.equal(pro.vods[0].url, pro.teamPresets[0].url);
    for (const [id, byMap] of Object.entries(expected)) {
      const preset = pro.teamPresets.find(entry => entry.id === id);
      const want = byMap[map.map];
      assert.ok(preset, `${map.map} doit proposer ${id}`);
      assert.equal(preset.date, want.date, `${map.map} / ${id}`);
      assert.equal(preset.patch, want.patch, `${map.map} / ${id}`);
      assert.equal(preset.score, want.score, `${map.map} / ${id}`);
      assert.deepEqual(preset.agents, want.agents, `${map.map} / ${id}`);
      assert.match(preset.url, new RegExp(`game=${want.game}$`), `${map.map} / ${id}`);
    }
  }

  const split = comps.find(map => map.map === 'Split').comps[1];
  assert.equal(split.teamPresets[1].score, '9-13', 'Conserver aussi les défaites récentes de PRX');
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
