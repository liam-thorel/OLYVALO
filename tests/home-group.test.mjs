import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHomeActivity, localDateKey, normalizeGroupNight, responseCounts } from '../js/home-group-utils.mjs';
import { installInstructions } from '../js/pwa-install.mjs';

test('today plan stays active and responses are summarized', () => {
  const today = localDateKey(new Date(2026, 7, 24, 12));
  const plan = normalizeGroupNight({ date:today, time:'21:30', gameTitle:'PEAK', responses:{ nico:{ status:'yes' }, liam:{ status:'maybe' } } }, today);
  assert.equal(plan.gameTitle, 'PEAK');
  assert.deepEqual(responseCounts(plan), { yes:1, maybe:1, no:0 });
  assert.equal(normalizeGroupNight({ date:'2020-01-01' }, today), null);
});

test('home activity combines both games and coop without exceeding the limit', () => {
  const events = buildHomeActivity({
    valorant:{ a:{ ts:300, memberId:'nico', result:'win', map:'Lotus' } },
    lol:{ b:{ ts:200, memberId:'liam', win:false, champion:'Teemo' } },
    coop:{ c:{ submittedAt:100, title:'PEAK' } },
    members:[{ id:'nico', name:'Nico' }, { id:'liam', name:'Liam' }],
    limit:2,
  });
  assert.equal(events.length, 2);
  assert.match(events[0].text, /Nico.*Lotus/);
  assert.match(events[1].text, /Liam.*Teemo/);
});

test('home activity highlights real rank promotions but ignores divisions', () => {
  const events = buildHomeActivity({
    valorant:{ valo:{ ts:300, reports:{ nico:{ memberId:'nico', rr:{ tierBefore:11, tier:12 } } } } },
    lol:{
      promoted:{ ts:250, memberId:'liam', rankBefore:{ tier:'SILVER' }, rankAfter:{ tier:'GOLD' } },
      division:{ ts:200, memberId:'nico', rankBefore:{ tier:'GOLD', division:'II' }, rankAfter:{ tier:'GOLD', division:'I' } },
    },
    members:[{ id:'nico', name:'Nico' }, { id:'liam', name:'Liam' }],
    limit:10,
  });
  assert.ok(events.some(event => /Nico est passé Gold sur Valorant/.test(event.text)));
  assert.ok(events.some(event => /Liam est passé Gold sur League/.test(event.text)));
  assert.equal(events.filter(event => event.kind === 'rank').length, 2);
});

test('installation help adapts to iPhone, Android and desktop', () => {
  assert.match(installInstructions('iPhone Safari').steps.join(' '), /Partager/);
  assert.match(installInstructions('Android Chrome').device, /Android/);
  assert.match(installInstructions('Windows Chrome').device, /ordinateur/);
});
