const VALORANT_RANKS = ['Iron', 'Bronze', 'Silver', 'Gold', 'Platine', 'Diamant', 'Ascendant', 'Immortal', 'Radiant'];
const LOL_RANKS = ['IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'EMERALD', 'DIAMOND', 'MASTER', 'GRANDMASTER', 'CHALLENGER'];

export function valorantRank(tier) {
  const value = Number(tier);
  if (!Number.isFinite(value) || value < 3) return null;
  const index = value >= 27 ? 8 : Math.floor((value - 3) / 3);
  return VALORANT_RANKS[index] ? { index, name:VALORANT_RANKS[index] } : null;
}

export function lolRank(value) {
  const tier = String(value?.tier || value || '').toUpperCase();
  const index = LOL_RANKS.indexOf(tier);
  if (index < 0) return null;
  const labels = { IRON:'Iron', BRONZE:'Bronze', SILVER:'Silver', GOLD:'Gold', PLATINUM:'Platine', EMERALD:'Émeraude', DIAMOND:'Diamant', MASTER:'Master', GRANDMASTER:'Grandmaster', CHALLENGER:'Challenger' };
  return { index, name:labels[tier] };
}

export function rankPromotion(game, record = {}) {
  const before = game === 'valorant'
    ? valorantRank(record?.rr?.tierBefore ?? record?.tierBefore)
    : lolRank(record?.rankBefore);
  const after = game === 'valorant'
    ? valorantRank(record?.rr?.tier ?? record?.tierAfter)
    : lolRank(record?.rankAfter);
  if (!before || !after || after.index <= before.index) return null;
  return {
    before:before.name,
    after:after.name,
    memberId:String(record.memberId || ''),
    member:String(record.member || record.playerName || record.player || 'Un membre OLYCITY'),
  };
}
