/**
 * OLYCITY — Présence temps réel via Firebase
 * Chargé comme script standard (non-module) pour compatibilité
 */

const FIREBASE_CDN_BASE = 'https://www.gstatic.com/firebasejs/9.23.0';
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyBOfJ_6l3Elifz4DC_1iqpyzLjlzPRskCE",
  databaseURL: "https://realtime-database-5bb9f-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "realtime-database-5bb9f",
};

let db = null;
let sessionRef = null;
window._activeProfiles = new Set();

function loadScript(src) {
  return new Promise((res, rej) => {
    if (document.querySelector(`script[src="${src}"]`)) return res();
    const s = document.createElement('script');
    s.src = src; s.onload = res; s.onerror = rej;
    document.head.appendChild(s);
  });
}

async function initPresence() {
  const profile = localStorage.getItem('olycity-profile');
  if (!profile) return;

  await loadScript(`${FIREBASE_CDN_BASE}/firebase-app-compat.js`);
  await loadScript(`${FIREBASE_CDN_BASE}/firebase-database-compat.js`);

  if (!window.firebase.apps.length) window.firebase.initializeApp(FIREBASE_CONFIG);
  db = window.firebase.database();

  // Register session
  const sessionId = Math.random().toString(36).slice(2, 9);
  sessionRef = db.ref(`sessions/${profile}/${sessionId}`);
  await sessionRef.set({ ts: Date.now() });
  sessionRef.onDisconnect().remove();

  // Heartbeat every 8s
  setInterval(() => sessionRef.set({ ts: Date.now() }), 8000);

  // Watch all sessions
  db.ref('sessions').on('value', snap => {
    window._activeProfiles = new Set();
    if (snap.exists()) {
      snap.forEach(profileSnap => {
        let alive = false;
        profileSnap.forEach(s => { if (Date.now() - (s.val()?.ts || 0) < 20000) alive = true; });
        if (alive) window._activeProfiles.add(profileSnap.key);
      });
    }
    window._presenceLoaded = true;
    // Refresh picker if open
    const picker = document.getElementById('profile-picker');
    if (picker && picker.style.display !== 'none') {
      window.OLYCITY?._refreshPickerDots?.();
    }
  });

  window._presenceReady = true;
}

window._initPresence = initPresence;
window._changePresence = async (newProfile) => {
  if (sessionRef) await sessionRef.remove();
  sessionRef = null;
  // Re-init with new profile after small delay
  setTimeout(initPresence, 100);
};
