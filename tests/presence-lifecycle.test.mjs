import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

test('profile presence reconnects after hub returns without duplicate heartbeats', () => {
  const events = {};
  const activeTimers = new Set([1]);
  let nextTimer = 1, offline = 0, online = 0, writes = 0, disconnects = 0;
  const context = {
    window:{ addEventListener:(name, handler) => { events[name] = handler; } },
    console, Set, Date,
    clearInterval:id => activeTimers.delete(id),
    setInterval:() => { activeTimers.add(++nextTimer); return nextTimer; },
    testDb:{goOffline:() => offline++,goOnline:() => online++},
    testSession:{onDisconnect:() => ({remove:() => disconnects++}),set:async () => { writes++; }},
  };
  vm.runInNewContext(readFileSync(new URL('../js/presence.js', import.meta.url), 'utf8') + '\ndb=testDb; sessionRef=testSession; heartbeatTimer=1;', context);
  events.pagehide();
  assert.equal(offline, 1);
  assert.equal(activeTimers.size, 0);
  events.pageshow({persisted:false});
  assert.equal(online, 0);
  events.pageshow({persisted:true});
  assert.equal(online, 1);
  assert.equal(writes, 1);
  assert.equal(disconnects, 1);
  assert.equal(activeTimers.size, 1);
  events.pagehide();
  events.pageshow({persisted:true});
  assert.equal(activeTimers.size, 1);
  assert.equal(writes, 2);
});
