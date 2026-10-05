// PUUID identifies the account; LCU gameflow/lobby identify the current mode.
// Prefer Riot's current metadata, retaining unknown modes rather than guessing ranked.
const QUEUES = {
  0:['CLASSIC','Partie personnalisée'], 400:['CLASSIC','Normale · Draft'],
  420:['CLASSIC','Classée Solo/Duo'], 430:['CLASSIC','Normale · Aveugle'],
  440:['CLASSIC','Classée Flex'], 450:['ARAM','ARAM'],
  480:['SWIFTPLAY','Swiftplay'], 490:['CLASSIC','Partie rapide'],
  700:['CLASSIC','Clash'], 720:['ARAM','Clash · ARAM'],
  830:['CLASSIC','Coop vs IA · Introduction'], 840:['CLASSIC','Coop vs IA · Débutant'],
  850:['CLASSIC','Coop vs IA · Intermédiaire'], 900:['URF','ARURF'],
  1010:['URF','ARURF · Neige'], 1020:['ONEFORALL','Un pour tous'],
  1090:['TFT','TFT · Normal'], 1100:['TFT','TFT · Classé'],
  1110:['TFT','TFT · Tutoriel'], 1130:['TFT','TFT · Hyper Roll'],
  1111:['TFT','TFT · Test'], 1210:['TFT','TFT · Trésor de Choncc'],
  1150:['TFT','TFT · Double Up'], 1160:['TFT','TFT · Double Up'],
  1300:['NEXUSBLITZ','Nexus Blitz'], 1400:['ULTBOOK','Grimoire ultime'],
  1700:['CHERRY','Arène'], 1710:['CHERRY','Arène'],
  1810:['STRAWBERRY','Swarm'], 1820:['STRAWBERRY','Swarm'], 1830:['STRAWBERRY','Swarm'],
  1840:['STRAWBERRY','Swarm'], 2300:['BRAWL','Brawl'], 2400:['ARAM','ARAM · Mayhem'],
  1900:['URF','URF'], 2000:['TUTORIAL','Tutoriel'], 2010:['TUTORIAL','Tutoriel'],
  2020:['TUTORIAL','Tutoriel'],
};
function numberOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : null;
}
function lolGameMetadata(session = {}, lobby = {}) {
  const data = session.gameData || {};
  const queue = data.queue || {};
  const config = lobby.gameConfig || {};
  const queueId = numberOrNull(queue.id ?? data.queueId ?? config.queueId);
  const fallback = QUEUES[queueId] || [];
  const practice = queue.isPracticeTool === true || config.isPracticeTool === true
    || String(config.gameMode || '').toUpperCase() === 'PRACTICETOOL';
  const mode = practice ? 'PRACTICETOOL' : String(queue.gameMode || data.gameMode || config.gameMode || fallback[0] || '').toUpperCase();
  const mapId = numberOrNull(data.mapId ?? queue.mapId ?? config.mapId);
  return {
    queueId, mode, mapId,
    gameFamily:mode.startsWith('TFT') || fallback[0] === 'TFT' || mapId === 22 ? 'tft' : 'lol',
    queueDescription: mode === 'PRACTICETOOL' ? 'Outil d’entraînement'
      : String(queue.description || config.queueDescription || fallback[1] || (mode ? `Mode ${mode}` : queueId !== null ? `File ${queueId}` : 'Mode en cours de détection')),
  };
}
module.exports = { lolGameMetadata };
