export { rankPromotion } from '../../js/rank-promotion.mjs';
import { rankPromotion } from '../../js/rank-promotion.mjs';

export const REMINDER_MINUTES = [30, 15];

export function selectedGroupNight(plan = {}) {
  const options = Array.isArray(plan.options) ? plan.options : Object.values(plan.options || {});
  const games = Array.isArray(plan.games) ? plan.games : Object.values(plan.games || {});
  const slot = options.find(option => String(option?.id) === String(plan.final?.optionId || '')) || options[0] || plan;
  const game = games.find(option => String(option?.id) === String(plan.final?.gameId || '')) || games[0] || plan;
  return {
    ...plan,
    date:slot.date || plan.date,
    time:slot.time || plan.time,
    startsAt:Number(slot.startsAt || plan.startsAt || 0),
    gameId:game.id || plan.gameId,
    gameTitle:game.title || plan.gameTitle,
  };
}

export function dueReminderMinutes(plan = {}, now = Date.now(), reminders = REMINDER_MINUTES) {
  const startsAt = selectedGroupNight(plan).startsAt;
  if (!startsAt || startsAt <= now) return [];
  const remaining = startsAt - now;
  return reminders.filter(minutes => remaining <= minutes * 60_000 && remaining > (minutes - 2) * 60_000);
}

export function reminderDue(plan = {}, now = Date.now()) {
  return dueReminderMinutes(plan, now).length > 0;
}

export function notificationMessage(type, value = {}) {
  if (type === 'reminder') {
    const minutes = Number(value.reminderMinutes) || 15;
    return {
      title:'OLYCITY',
      body:'🎮 ' + (value.gameTitle || 'Session de jeu') + ` dans ${minutes} minutes · Rendez-vous à ` + (value.time || '') + '.',
      tag:'session-' + (value.startsAt || value.updatedAt || ''),
      url:'./#home',
    };
  }
  return {
    title:'OLYCITY',
    body:'🏆 ' + value.member + ' passe ' + value.after + ' · ' + value.before + ' → ' + value.after + ' sur ' + (value.game === 'lol' ? 'League of Legends' : 'Valorant'),
    tag:'rank-' + value.game + '-' + (value.id || value.memberId || ''),
    url:'./#history',
  };
}
