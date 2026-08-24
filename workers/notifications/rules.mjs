export { rankPromotion } from '../../js/rank-promotion.mjs';
import { rankPromotion } from '../../js/rank-promotion.mjs';

export function reminderDue(plan = {}, now = Date.now()) {
  const startsAt = Number(plan.startsAt || 0);
  if (!startsAt || startsAt <= now) return false;
  const remaining = startsAt - now;
  return remaining <= 15 * 60_000 && remaining > 13 * 60_000;
}

export function notificationMessage(type, value = {}) {
  if (type === 'reminder') return {
    title:'🎮 ' + (value.gameTitle || 'Session OLYCITY') + ' dans 15 minutes',
    body:'Rendez-vous à ' + (value.time || '') + '. Préparez-vous !',
    tag:'session-' + (value.startsAt || value.updatedAt || ''),
    url:'./#home',
  };
  return {
    title:'🏆 ' + value.member + ' passe ' + value.after,
    body:value.before + ' → ' + value.after + ' sur ' + (value.game === 'lol' ? 'League of Legends' : 'Valorant'),
    tag:'rank-' + value.game + '-' + (value.id || value.memberId || ''),
    url:'./#history',
  };
}
