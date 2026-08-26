import { rankPromotion } from './rank-promotion.mjs?v=20260824-push';

export function localDateKey(now = new Date()) {
  const date = now instanceof Date ? now : new Date(now);
  const pad = value => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function normalizeGroupNight(value = {}, today = localDateKey()) {
  if (!value || typeof value !== 'object') return null;
  const responses = value.responses && typeof value.responses === 'object' ? value.responses : {};
  const rawOptions = Array.isArray(value.options) ? value.options : Object.values(value.options || {});
  const options = rawOptions.map((option, index) => {
    const date = String(option?.date || '');
    const time = /^\d{2}:\d{2}$/.test(String(option?.time || '')) ? String(option.time) : '21:30';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < today) return null;
    return { id:String(option.id || `slot-${index + 1}`), date, time, startsAt:Number(option.startsAt) || new Date(`${date}T${time}:00`).getTime() };
  }).filter(Boolean);
  if (!options.length) {
    const legacyDate = String(value.date || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(legacyDate) || legacyDate < today) return null;
    const legacyTime = /^\d{2}:\d{2}$/.test(String(value.time || '')) ? String(value.time) : '21:30';
    options.push({
      id:'slot-1', date:legacyDate, time:legacyTime,
      startsAt:Number(value.startsAt) || new Date(`${legacyDate}T${legacyTime}:00`).getTime(),
    });
  }
  const rawGames = Array.isArray(value.games) ? value.games : Object.values(value.games || {});
  const gameOptions = rawGames.map((game, index) => ({
    id:String(game?.id || `game-${index + 1}`), title:String(game?.title || 'Jeu à décider'), coverUrl:String(game?.coverUrl || ''),
  }));
  if (!gameOptions.length && value.gameId) gameOptions.push({ id:String(value.gameId), title:String(value.gameTitle || 'Jeu à décider'), coverUrl:'' });
  const final = value.final && typeof value.final === 'object' ? {
    optionId:String(value.final.optionId || ''), gameId:String(value.final.gameId || ''),
    lockedAt:Number(value.final.lockedAt) || 0, lockedBy:String(value.final.lockedBy || ''),
  } : null;
  const chosenOption = options.find(option => option.id === final?.optionId) || options[0];
  const chosenGame = gameOptions.find(game => game.id === final?.gameId) || gameOptions[0];
  return {
    date:chosenOption.date, time:chosenOption.time, startsAt:chosenOption.startsAt,
    gameId:chosenGame?.id || String(value.gameId || ''), gameTitle:chosenGame?.title || String(value.gameTitle || 'Jeu à décider'),
    createdBy:String(value.createdBy || ''),
    updatedAt:Number(value.updatedAt) || 0,
    responses, options, games:gameOptions, final,
  };
}

export function groupNightVoteSummary(plan = null) {
  const optionVotes = Object.fromEntries((plan?.options || []).map(option => [option.id, { yes:0, maybe:0, no:0, score:0 }]));
  const gameVotes = Object.fromEntries((plan?.games || []).map(game => [game.id, 0]));
  Object.values(plan?.responses || {}).forEach(response => {
    Object.entries(response?.availability || {}).forEach(([id, status]) => {
      if (!optionVotes[id] || !['yes','maybe','no'].includes(status)) return;
      optionVotes[id][status] += 1;
      optionVotes[id].score += status === 'yes' ? 2 : status === 'maybe' ? 1 : 0;
    });
    Object.entries(response?.gameVotes || {}).forEach(([id, selected]) => {
      if (selected && id in gameVotes) gameVotes[id] += 1;
    });
  });
  const bestOption = (plan?.options || []).slice().sort((left, right) => (optionVotes[right.id]?.score || 0) - (optionVotes[left.id]?.score || 0) || left.startsAt - right.startsAt)[0] || null;
  const bestGame = (plan?.games || []).slice().sort((left, right) => (gameVotes[right.id] || 0) - (gameVotes[left.id] || 0) || left.title.localeCompare(right.title, 'fr'))[0] || null;
  return { optionVotes, gameVotes, bestOption, bestGame };
}

export function groupNightNeedsResponse(plan = null, memberId = '') {
  if (!plan || !memberId) return false;
  const key = String(memberId).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9_-]/g, '_');
  const response = plan.responses?.[key];
  return !response || !(plan.options || []).some(option => response.availability?.[option.id])
    || ((plan.games || []).length > 1 && !Object.values(response.gameVotes || {}).some(Boolean));
}

export function groupNightDateLabel(plan = null, now = new Date()) {
  if (!plan?.date) return '';
  const today = localDateKey(now);
  const tomorrow = localDateKey(new Date(new Date(`${today}T12:00:00`).getTime() + 86_400_000));
  if (plan.date === today) return 'Ce soir';
  if (plan.date === tomorrow) return 'Demain';
  return new Date(`${plan.date}T12:00:00`).toLocaleDateString('fr-FR', { weekday:'short', day:'numeric', month:'short' });
}

export function groupNightCalendar(plan = null) {
  if (!plan?.date || !plan?.time) return '';
  const start = new Date(`${plan.date}T${plan.time}:00`);
  if (!Number.isFinite(start.getTime())) return '';
  const end = new Date(start.getTime() + 3 * 3_600_000);
  const stamp = date => date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const text = value => String(value || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
  return ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//OLYCITY//Session//FR','BEGIN:VEVENT',
    `UID:${Number(plan.updatedAt) || start.getTime()}@olycity`, `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(start)}`, `DTEND:${stamp(end)}`, `SUMMARY:${text(plan.gameTitle || 'Session OLYCITY')}`,
    'DESCRIPTION:Rappels OLYCITY 30 et 15 minutes avant la session.','END:VEVENT','END:VCALENDAR'].join('\r\n');
}

export function responseCounts(plan = null) {
  const counts = { yes:0, maybe:0, no:0 };
  Object.values(plan?.responses || {}).forEach(response => {
    const status = String(response?.status || '');
    if (status in counts) counts[status] += 1;
  });
  return counts;
}

function normalizeTimestamp(value) {
  const number = Number(value) || 0;
  return number > 0 && number < 10_000_000_000 ? number * 1000 : number;
}

function memberName(record = {}, members = []) {
  const id = String(record.memberId || '').toLowerCase();
  return members.find(member => String(member.id || '').toLowerCase() === id)?.name
    || record.member || record.player || record.playerName || 'Un membre';
}

export function buildHomeActivity({ valorant = {}, lol = {}, coop = {}, plan = null, members = [], lastSeen = 0, limit = 3 } = {}) {
  const events = [];
  Object.entries(valorant || {}).forEach(([id, match]) => {
    const ts = normalizeTimestamp(match?.endTs || match?.ts);
    if (!ts) return;
    const reports = Object.values(match?.reports || {});
    reports.forEach((report, index) => {
      const promotion = rankPromotion('valorant', report);
      if (!promotion) return;
      const promotedName = memberName(report, members);
      events.push({ id:`rank-valorant-${id}-${index}`, kind:'rank', ts:ts + 1, fresh:ts > lastSeen, text:`${promotedName} est passé ${promotion.after} sur Valorant` });
    });
  });
  Object.entries(lol || {}).forEach(([id, match]) => {
    const ts = normalizeTimestamp(match?.ts);
    if (!ts) return;
    const name = memberName(match, members);
    const promotion = rankPromotion('lol', match);
    if (promotion) events.push({ id:`rank-lol-${id}`, kind:'rank', ts:ts + 1, fresh:ts > lastSeen, text:`${name} est passé ${promotion.after} sur League of Legends` });
  });
  Object.entries(coop || {}).forEach(([id, game]) => {
    const submittedAt = normalizeTimestamp(game?.submittedAt);
    if (submittedAt) {
      const submittedBy = String(game.submittedBy || '').trim();
      events.push({
        id:`coop-add-${id}`, kind:'coop-add', ts:submittedAt, fresh:submittedAt > lastSeen,
        text:`${submittedBy || 'Un membre'} a ajouté ${game.title || 'un jeu'} à la liste Coop`,
      });
    }
    const statusAt = normalizeTimestamp(game?.statusAt);
    if (statusAt && ['replay','planned'].includes(game.status)) {
      const statusBy = String(game.statusBy || '').trim();
      const action = game.status === 'replay' ? 'marqué à rejouer' : 'planifié';
      events.push({ id:`coop-status-${id}`, kind:'coop', ts:statusAt, fresh:statusAt > lastSeen, text:`${game.title || 'Un jeu'} ${action}${statusBy ? ` par ${statusBy}` : ''}` });
    }
  });
  if (plan?.updatedAt) events.push({ id:'night-plan', kind:'coop', ts:plan.updatedAt, fresh:plan.updatedAt > lastSeen, text:`${plan.createdBy || 'Le groupe'} propose ${plan.gameTitle} à ${plan.time}` });
  let coopAddShown = false;
  return events.sort((left, right) => right.ts - left.ts).filter(event => {
    if (event.kind !== 'coop-add') return true;
    if (coopAddShown) return false;
    coopAddShown = true;
    return true;
  }).slice(0, Math.max(1, limit));
}

export function relativeActivityTime(timestamp, now = Date.now()) {
  const elapsed = Math.max(0, now - normalizeTimestamp(timestamp));
  if (elapsed < 60_000) return 'maintenant';
  if (elapsed < 3_600_000) return `il y a ${Math.floor(elapsed / 60_000)} min`;
  if (elapsed < 86_400_000) return `il y a ${Math.floor(elapsed / 3_600_000)} h`;
  return `il y a ${Math.floor(elapsed / 86_400_000)} j`;
}
