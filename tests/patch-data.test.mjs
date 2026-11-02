import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const readJson = path => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));

test('patch 13.09 follows the Act 6 competitive map rotation', () => {
  const meta = readJson('../data/meta.json');
  const comps = readJson('../data/comps.json');
  const mapNames = comps.map(entry => entry.map);

  assert.equal(meta.currentPatch, '13.09');
  assert.deepEqual(mapNames, meta.mapsInRotation);
  // Patch 13.08 : Bind et Corrode entrent, Ascent et Split sortent.
  assert.deepEqual([...mapNames].sort(), ['Abyss', 'Bind', 'Corrode', 'Haven', 'Lotus', 'Summit', 'Sunset']);
});

test('Hush, added in 13.09, has a role and French ability names', () => {
  assert.equal(readJson('../data/roles.json').roles.Hush, 'D');
  const hush = readJson('../data/agents-fr.json').Hush;
  assert.deepEqual(Object.values(hush.abilities).map(ability => ability.name), ['Ampoule aveuglante', 'Déplacement', 'Flux', 'Suspension']);
});

test('ranked picks come from current MetaBot data with the documented rule', () => {
  const comps = readJson('../data/comps.json');
  const expected = {
    Haven:   ['Phoenix', 'Sova', 'Clove', 'Killjoy', 'Neon'],
    Abyss:   ['Neon', 'Sova', 'Clove', 'Chamber', 'Jett'],
    Lotus:   ['Neon', 'Fade', 'Clove', 'Vyse', 'Chamber'],
    Bind:    ['Raze', 'Fade', 'Clove', 'Chamber', 'Skye'],
    Corrode: ['Neon', 'Fade', 'Clove', 'Vyse', 'Jett'],
    Sunset:  ['Phoenix', 'Sova', 'Clove', 'Cypher', 'Neon'],
    Summit:  ['Phoenix', 'Fade', 'Clove', 'Sage', 'Neon'],
  };
  for (const map of comps) {
    const ranked = map.comps[0];
    assert.deepEqual(ranked.agents, expected[map.map], map.map);
    assert.equal(ranked.sourcePatch, '13.09');
    assert.match(ranked.tip, /3 % des parties/);
  }
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
      // Bind et Corrode n'étaient pas au pool cet été : leurs derniers matchs pro
      // datent d'avant. On garde la vraie date et le vrai patch du match.
      const recent = !['Bind', 'Corrode'].includes(map.map);
      assert.match(preset.date, recent ? /^2026-(0[7-9]|10)-/ : /^202[56]-/, `${map.map} / ${preset.team} doit venir de la méta récente`);
      assert.match(preset.patch, recent ? /^13\.0[1245]$/ : /^1[12]\.\d{2}$/, 'Le patch observé doit rester celui du match, pas celui du site');
      assert.ok(preset.logo?.startsWith('./assets/teams/'), `${map.map} / ${preset.team} doit utiliser un logo local`);
    }

    for (const comp of [ranked, pro]) {
      assert.equal(comp.patch, '13.09', `${map.map} / ${comp.label} doit être à jour`);
      assert.ok(comp.source, `${map.map} / ${comp.label} doit afficher sa source`);
      if (comp.key) assert.ok(comp.agents.includes(comp.key), `${map.map} / ${comp.label} doit avoir un key pick présent`);
    }
  }
});

test('Champions 2026 review keeps the latest sourced KC, PRX and LOUD compositions', () => {
  const comps = readJson('../data/comps.json');
  // Dernière carte jouée par chaque équipe (vlr.gg). Pour Bind et Corrode,
  // revenues au pool au patch 13.08, c'est leur dernier match avant l'été ;
  // ailleurs, KC n'a pas joué Lotus à Champions, PRX et LOUD pas Abyss.
  const expected = {
    kc: {
      Haven:  { date: '2026-10-03', patch: '13.05', game: '283210', score: '6-13', agents: ['Sova', 'Phoenix', 'Neon', 'Omen', 'Cypher'] },
      Abyss:  { date: '2026-09-25', patch: '13.05', game: '283197', score: '13-6', agents: ['Yoru', 'Sova', 'Cypher', 'Omen', 'Waylay'] },
      Lotus:  { date: '2026-08-30', patch: '13.04', game: '279414', score: '7-13', agents: ['Omen', 'Viper', 'Fade', 'Chamber', 'Neon'] },
      Bind:    { date: '2026-04-23', patch: '12.07', game: '258404', score: '8-13', agents: ['Raze', 'Viper', 'Brimstone', 'Skye', 'Gekko'] },
      Corrode: { date: '2026-02-05', patch: '12.00', game: '244379', score: '11-13', agents: ['Astra', 'Tejo', 'Omen', 'Fade', 'Waylay'] },
      Sunset: { date: '2026-10-03', patch: '13.05', game: '283208', score: '13-9', agents: ['Viper', 'Chamber', 'Omen', 'Neon', 'Fade'] },
      Summit: { date: '2026-10-03', patch: '13.05', game: '283209', score: '5-13', agents: ['Chamber', 'Viper', 'Neon', 'Fade', 'Omen'] },
    },
    prx: {
      Haven:  { date: '2026-09-29', patch: '13.05', game: '283188', score: '13-11', agents: ['Chamber', 'Astra', 'Phoenix', 'Fade', 'Yoru'] },
      Abyss:  { date: '2026-08-28', patch: '13.04', game: '281158', score: '13-11', agents: ['Harbor', 'Omen', 'Yoru', 'Sova', 'Waylay'] },
      Lotus:  { date: '2026-10-09', patch: '13.05', game: '283294', score: '7-13', agents: ['Yoru', 'Vyse', 'Raze', 'Fade', 'Omen'] },
      Bind:    { date: '2026-03-09', patch: '12.03', game: '254376', score: '11-13', agents: ['Skye', 'Brimstone', 'Gekko', 'Raze', 'Harbor'] },
      Corrode: { date: '2026-03-15', patch: '12.03', game: '254381', score: '11-13', agents: ['Omen', 'Waylay', 'Vyse', 'Viper', 'Fade'] },
      Sunset: { date: '2026-10-07', patch: '13.05', game: '283275', score: '13-15', agents: ['Fade', 'Chamber', 'Omen', 'Raze', 'Sage'] },
      Summit: { date: '2026-10-09', patch: '13.05', game: '283296', score: '11-13', agents: ['Sage', 'Viper', 'Omen', 'Neon', 'Fade'] },
    },
    loud: {
      Haven:  { date: '2026-10-18', patch: '13.05', game: '283289', score: '13-10', agents: ['Omen', 'Sova', 'Neon', 'Viper', 'Chamber'] },
      Abyss:  { date: '2026-09-05', patch: '13.04', game: '280058', score: '13-10', agents: ['Omen', 'Sova', 'Yoru', 'Waylay', 'Harbor'] },
      Lotus:  { date: '2026-10-18', patch: '13.05', game: '283287', score: '8-13', agents: ['Viper', 'Neon', 'Fade', 'Vyse', 'Omen'] },
      Bind:    { date: '2026-05-10', patch: '12.07', game: '258659', score: '3-13', agents: ['Viper', 'Raze', 'Brimstone', 'Skye', 'Chamber'] },
      Corrode: { date: '2025-07-26', patch: '11.00', game: '224741', score: '9-13', agents: ['Vyse', 'Neon', 'Viper', 'Omen', 'Fade'] },
      Sunset: { date: '2026-10-18', patch: '13.05', game: '283288', score: '13-5', agents: ['Neon', 'Sage', 'Sova', 'Chamber', 'Omen'] },
      Summit: { date: '2026-10-18', patch: '13.05', game: '283286', score: '13-11', agents: ['Sage', 'Omen', 'Fade', 'Chamber', 'Neon'] },
    },
  };

  for (const map of comps) {
    const [ranked, pro] = map.comps;
    assert.equal(ranked.sourcePatch, '13.09');
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
    assert.equal(fun.patch, '13.09', `${map.map} / fun doit être à jour`);
    assert.equal(fun.agents.length, 5, `${map.map} / fun doit contenir cinq agents`);
    assert.equal(new Set(fun.agents).size, 5, `${map.map} / fun ne doit pas contenir de doublon`);
    assert.ok(fun.source, `${map.map} / fun doit expliquer son origine`);
    assert.ok(fun.key && fun.agents.includes(fun.key), `${map.map} / fun doit avoir un key pick présent`);
  }
});
