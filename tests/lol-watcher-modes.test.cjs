const test = require('node:test');
const assert = require('node:assert/strict');
const { createLolWatcher } = require('../live/lol-watcher.js');

test('real watcher publishes TFT separately, refreshes presence and survives rename/account/mode transitions', async () => {
  const realNow = Date.now;
  let now = 2_000_000_000_000;
  Date.now = () => now;
  const writes = [];
  let account = {puuid:'stable-P',gameName:'Liam',tagLine:'OLY'};
  let flow = {phase:'InProgress',gameData:{gameId:100,queue:{id:1100,gameMode:'CLASSIC'},playerChampionSelections:[{puuid:'stable-P',championId:1}]}};
  const watcher = createLolWatcher({
    putFB:async (path,value) => writes.push({path,value}),
    ts:()=>'test',scriptVersion:'test',log:()=>{},readClientLock:()=>({port:1}),
    getIdentity:()=>({memberId:'liam',memberName:'Liam'}),
    loadChampions:async()=>({1:{name:'Annie'}}),
    loadSoloProfile:async()=>({}),
    requestLcu:async (_,endpoint)=>({ok:true,data: endpoint === '/lol-gameflow/v1/session' ? flow
      : endpoint === '/lol-summoner/v1/current-summoner' ? account
      : endpoint === '/riotclient/region-locale' ? {webRegion:'euw'} : null}),
  });
  const sessions = () => writes.filter(write=>write.path.startsWith('live/lolSessions/') && write.value);
  try {
    await watcher.poll();
    let current = sessions().at(-1);
    assert.equal(current.value.gameFamily,'tft');
    assert.equal(current.value.champion,null);
    assert.equal(current.value.rank,null);
    const firstPath = current.path;
    account = {...account,gameName:'Renamed'};
    now += 21_000;
    await watcher.poll();
    current = sessions().at(-1);
    assert.equal(current.path,firstPath);
    assert.equal(current.value.matchId,'100');
    assert.equal(current.value.playerName,'Renamed#OLY');
    assert.equal(sessions().filter(write=>write.value.active===false).length,0);
    const clients = writes.filter(write=>write.path.startsWith('live/lolClients/') && write.value?.connected);
    assert.equal(clients.length,2,'presence refresh must precede the site 55s expiry');

    // New ARAM game does not inherit TFT metadata or rely on display name.
    flow = {phase:'InProgress',gameData:{gameId:101,queue:{id:450},playerChampionSelections:[{puuid:'stable-P',championId:1}]}};
    now += 21_000;
    await watcher.poll();
    current = sessions().at(-1);
    assert.equal(current.value.mode,'ARAM');
    assert.equal(current.value.gameFamily,'lol');
    assert.equal(current.value.champion.name,'Annie');
    assert.equal(current.value.matchId,'101');

    // Exercise publication, not just the metadata helper, for special queues.
    for (const [queueId, mode] of [[420,'CLASSIC'],[440,'CLASSIC'],[450,'ARAM'],[1700,'CHERRY'],[1840,'STRAWBERRY'],[1900,'URF'],[2300,'BRAWL'],[2400,'ARAM'],[9999,'FUTURE_MODE']]) {
      flow = {phase:'InProgress',gameData:{gameId:1000+queueId,queue:{id:queueId,...(queueId===9999?{gameMode:mode}:{})}}};
      now += 21_000;
      await watcher.poll();
      current = sessions().at(-1);
      assert.equal(current.value.mode,mode);
      assert.equal(current.value.queueId,queueId);
      assert.equal(current.value.puuid,'stable-P');
    }

    // Account switch closes the OLD PUUID first, not the new account's node.
    account = {puuid:'other-P',gameName:'Other',tagLine:'OLY'};
    flow.gameData.gameId = 102;
    now += 21_000;
    await watcher.poll();
    assert.ok(sessions().some(write=>write.path===firstPath && write.value.active===false && write.value.puuid==='stable-P'));
    assert.equal(sessions().at(-1).path,'live/lolSessions/other-P');

    // Selection must clear the previous active match immediately.
    flow = {phase:'ChampSelect',gameData:{queue:{id:400}}};
    now += 21_000;
    await watcher.poll();
    assert.equal(sessions().at(-1).value.active,false);
  } finally { Date.now = realNow; }
});
