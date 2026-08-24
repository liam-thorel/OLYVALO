export function localDateKey(now = new Date()) {
  const date = now instanceof Date ? now : new Date(now);
  const pad = value => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function normalizeGroupNight(value = {}, today = localDateKey()) {
  if (!value || typeof value !== 'object' || value.date !== today) return null;
  const responses = value.responses && typeof value.responses === 'object' ? value.responses : {};
  return {
    date:today,
    time:/^\d{2}:\d{2}$/.test(String(value.time || '')) ? value.time : '21:30',
    gameId:String(value.gameId || ''),
    gameTitle:String(value.gameTitle || 'Jeu à décider'),
    createdBy:String(value.createdBy || ''),
    updatedAt:Number(value.updatedAt) || 0,
    responses,
  };
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
    const name = memberName(match, members);
    const won = String(match.result || '').toLowerCase() === 'win';
    events.push({ id:`valorant-${id}`, kind:'valorant', ts, fresh:ts > lastSeen, text:`${name} a ${won ? 'gagné' : 'terminé'} sur ${match.map || 'Valorant'}` });
  });
  Object.entries(lol || {}).forEach(([id, match]) => {
    const ts = normalizeTimestamp(match?.ts);
    if (!ts) return;
    const name = memberName(match, members);
    const champion = match.champion?.name || match.championName || match.champion || 'League';
    events.push({ id:`lol-${id}`, kind:'lol', ts, fresh:ts > lastSeen, text:`${name} a ${match.win ? 'gagné' : 'joué'} avec ${champion}` });
  });
  Object.entries(coop || {}).forEach(([id, game]) => {
    const submittedAt = normalizeTimestamp(game?.submittedAt);
    if (submittedAt) events.push({ id:`coop-add-${id}`, kind:'coop', ts:submittedAt, fresh:submittedAt > lastSeen, text:`${game.title || 'Un jeu'} a rejoint la liste Coop` });
    const statusAt = normalizeTimestamp(game?.statusAt);
    if (statusAt && statusAt !== submittedAt) events.push({ id:`coop-status-${id}`, kind:'coop', ts:statusAt, fresh:statusAt > lastSeen, text:`${game.title || 'Un jeu'} · ${game.status === 'replay' ? 'à rejouer' : game.status === 'planned' ? 'planifié' : 'liste actualisée'}` });
  });
  if (plan?.updatedAt) events.push({ id:'night-plan', kind:'coop', ts:plan.updatedAt, fresh:plan.updatedAt > lastSeen, text:`${plan.createdBy || 'Le groupe'} propose ${plan.gameTitle} à ${plan.time}` });
  return events.sort((left, right) => right.ts - left.ts).slice(0, Math.max(1, limit));
}

export function relativeActivityTime(timestamp, now = Date.now()) {
  const elapsed = Math.max(0, now - normalizeTimestamp(timestamp));
  if (elapsed < 60_000) return 'maintenant';
  if (elapsed < 3_600_000) return `il y a ${Math.floor(elapsed / 60_000)} min`;
  if (elapsed < 86_400_000) return `il y a ${Math.floor(elapsed / 3_600_000)} h`;
  return `il y a ${Math.floor(elapsed / 86_400_000)} j`;
}
