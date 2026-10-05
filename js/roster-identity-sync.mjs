import { fetchJsonWithTimeout } from './request-utils.mjs?v=20260930-consistent-live';

// Read-only identity refresh. Failed requests never replace known accounts.
export function createRosterIdentitySync({fetchAccounts,onChange,initial={}}) {
  let fingerprint = JSON.stringify(initial);
  let pending = null;
  let controller = null;
  let generation = 0;
  function pause() {
    generation++;
    controller?.abort();
    controller = null;
    pending = null;
  }
  function refresh() {
    if (pending) return pending;
    const current = generation;
    const requestController = new AbortController();
    controller = requestController;
    pending = Promise.resolve().then(()=>fetchAccounts(requestController.signal)).then(accounts=>{
      if (current !== generation || !accounts || typeof accounts !== 'object' || Array.isArray(accounts)) return;
      const next = JSON.stringify(accounts);
      if (next === fingerprint) return;
      onChange(accounts);
      fingerprint = next;
    }).catch(()=>{}).finally(()=>{
      if (current === generation) { pending=null;controller=null; }
    });
    return pending;
  }
  return {refresh,pause};
}

export function initRosterIdentitySync({initial={},onChange}) {
  const sync = createRosterIdentitySync({initial,onChange,
    fetchAccounts:signal=>fetchJsonWithTimeout('https://realtime-database-5bb9f-default-rtdb.europe-west1.firebasedatabase.app/rosterOverlay/accounts.json', {timeoutMs:4_000,signal}),
  });
  const refresh = () => { if (document.visibilityState === 'visible') void sync.refresh(); };
  const visibility = () => document.visibilityState === 'visible' ? refresh() : sync.pause();
  window.addEventListener('pagehide',sync.pause);
  window.addEventListener('pageshow',refresh);
  document.addEventListener('visibilitychange',visibility);
  window.addEventListener('olycity:page-change',refresh);
  const timer = window.setInterval(refresh,30_000);
  refresh();
  return ()=>{
    sync.pause();window.clearInterval(timer);
    window.removeEventListener('pagehide',sync.pause);
    window.removeEventListener('pageshow',refresh);
    document.removeEventListener('visibilitychange',visibility);
    window.removeEventListener('olycity:page-change',refresh);
  };
}
