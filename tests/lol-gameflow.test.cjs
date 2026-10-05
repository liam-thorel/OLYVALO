const test = require('node:test');
const assert = require('node:assert/strict');
const { lolGameMetadata } = require('../live/lol-gameflow.js');
const session = (id, extra = {}) => ({gameData:{queue:{id,...extra}}});

test('all known League queues retain their mode without becoming ranked', () => {
  for (const [id, mode] of [[420,'CLASSIC'],[440,'CLASSIC'],[450,'ARAM'],[900,'URF'],[1400,'ULTBOOK'],[1700,'CHERRY'],[1840,'STRAWBERRY'],[2300,'BRAWL'],[2400,'ARAM']]) {
    const result = lolGameMetadata(session(id));
    assert.equal(result.queueId,id);
    assert.equal(result.mode,mode);
    assert.equal(result.gameFamily,'lol');
  }
});
test('TFT queues are not League, even with misleading CLASSIC data', () => {
  for (const id of [1090,1100,1110,1111,1130,1150,1160,1210]) {
    const result = lolGameMetadata(session(id,{gameMode:'CLASSIC'}));
    assert.equal(result.gameFamily,'tft');
    assert.match(result.queueDescription,/TFT/);
  }
  assert.equal(lolGameMetadata(session(9999,{gameMode:'TFT_NEW'})).gameFamily,'tft');
  assert.equal(lolGameMetadata(session(9999,{mapId:22})).gameFamily,'tft');
});
test('custom and practice metadata use current lobby, preserving zero queue ID', () => {
  const practice = lolGameMetadata(session(0),{gameConfig:{isPracticeTool:true,mapId:11}});
  assert.equal(practice.mode,'PRACTICETOOL');
  assert.equal(practice.queueId,0);
  assert.equal(practice.mapId,11);
  assert.equal(lolGameMetadata({}, {gameConfig:{queueId:450,gameMode:'ARAM'}}).mode,'ARAM');
});
test('missing metadata never borrows an old ranked file and future modes pass through', () => {
  assert.equal(lolGameMetadata({}).queueId,null);
  const unknown = lolGameMetadata(session(9999,{gameMode:'NEW_MODE',description:'Nouveau mode Riot'}));
  assert.equal(unknown.mode,'NEW_MODE');
  assert.equal(unknown.queueDescription,'Nouveau mode Riot');
});
