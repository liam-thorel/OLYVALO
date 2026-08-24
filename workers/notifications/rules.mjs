export { rankPromotion } from '../../js/rank-promotion.mjs';
import { rankPromotion } from '../../js/rank-promotion.mjs';

export const REMINDER_MINUTES = [30, 15];

export function dueReminderMinutes(plan = {}, now = Date.now(), reminders = REMINDER_MINUTES) {
  const startsAt = Number(plan.startsAt || 0);
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
      title:'🎮 ' + (value.gameTitle || 'Session OLYCITY') + ` dans ${minutes} minutes`,
      body:'Rendez-vous à ' + (value.time || '') + '. Préparez-vous !',
      tag:'session-' + (value.startsAt || value.updatedAt || ''),
      url:'./#home',
    };
  }
  return {
    title:'🏆 ' + value.member + ' passe ' + value.after,
    body:value.before + ' → ' + value.after + ' sur ' + (value.game === 'lol' ? 'League of Legends' : 'Valorant'),
    tag:'rank-' + value.game + '-' + (value.id || value.memberId || ''),
    url:'./#history',
  };
}
