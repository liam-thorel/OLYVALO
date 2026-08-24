import test from 'node:test';
import assert from 'node:assert/strict';
import { lolRank, rankPromotion, valorantRank } from '../js/rank-promotion.mjs';
import { dueReminderMinutes, notificationMessage, reminderDue } from '../workers/notifications/rules.mjs';

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

test('notification title stays limited to the OLYCITY brand', () => {
  const message = notificationMessage('rank', {
    member:'Nico', before:'Diamant', after:'Ascendant', game:'valorant', id:'match-1',
  });
  assert.equal(message.title, 'OLYCITY');
  assert.equal(message.body, '🏆 Nico passe Ascendant · Diamant → Ascendant sur Valorant');
  assert.equal(message.url, './#history');
});

test('session reminders open once around T minus 30 and T minus 15', () => {
  const startsAt = Date.UTC(2026, 7, 24, 20, 0);
  assert.deepEqual(dueReminderMinutes({ startsAt }, startsAt - 31 * 60_000), []);
  assert.deepEqual(dueReminderMinutes({ startsAt }, startsAt - 30 * 60_000), [30]);
  assert.deepEqual(dueReminderMinutes({ startsAt }, startsAt - 28 * 60_000), []);
  assert.equal(reminderDue({ startsAt }, startsAt - 15 * 60_000), true);
  assert.deepEqual(dueReminderMinutes({ startsAt }, startsAt - 15 * 60_000), [15]);
  assert.equal(reminderDue({ startsAt }, startsAt - 12 * 60_000), false);
  const reminder30 = notificationMessage('reminder', { gameTitle:'PEAK', time:'22:00', reminderMinutes:30 });
  const reminder15 = notificationMessage('reminder', { gameTitle:'PEAK', time:'22:00', reminderMinutes:15 });
  assert.equal(reminder30.title, 'OLYCITY');
  assert.match(reminder30.body, /PEAK dans 30 minutes/);
  assert.equal(reminder15.title, 'OLYCITY');
  assert.match(reminder15.body, /PEAK dans 15 minutes/);
});
