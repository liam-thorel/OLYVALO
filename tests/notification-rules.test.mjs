import test from 'node:test';
import assert from 'node:assert/strict';
import { lolRank, rankPromotion, valorantRank } from '../js/rank-promotion.mjs';
import { notificationMessage, reminderDue } from '../workers/notifications/rules.mjs';

test('Valorant notifies only a real upward rank tier change', () => {
  assert.equal(valorantRank(9).name, 'Silver');
  assert.equal(valorantRank(12).name, 'Gold');
  assert.equal(rankPromotion('valorant', { rr:{ tierBefore:9, tier:11 } }), null);
  assert.deepEqual(
    rankPromotion('valorant', { member:'Nico', rr:{ tierBefore:11, tier:12 } }),
    { before:'Silver', after:'Gold', memberId:'', member:'Nico' },
  );
  assert.equal(rankPromotion('valorant', { rr:{ tierBefore:24, tier:23 } }), null);
});

test('League ignores divisions and detects only promotion to a higher tier', () => {
  assert.equal(lolRank({ tier:'SILVER' }).name, 'Silver');
  assert.equal(rankPromotion('lol', {
    rankBefore:{ tier:'SILVER', division:'II' },
    rankAfter:{ tier:'SILVER', division:'I' },
  }), null);
  assert.equal(rankPromotion('lol', {
    member:'Liam',
    rankBefore:{ tier:'SILVER', division:'I' },
    rankAfter:{ tier:'GOLD', division:'IV' },
  }).after, 'Gold');
});

test('session reminder opens only in the two-minute window at T minus 15', () => {
  const startsAt = Date.UTC(2026, 7, 24, 20, 0);
  assert.equal(reminderDue({ startsAt }, startsAt - 16 * 60_000), false);
  assert.equal(reminderDue({ startsAt }, startsAt - 15 * 60_000), true);
  assert.equal(reminderDue({ startsAt }, startsAt - 12 * 60_000), false);
  assert.match(notificationMessage('reminder', { gameTitle:'PEAK', time:'22:00' }).title, /15 minutes/);
});
