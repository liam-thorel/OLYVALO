const EventSource = require('eventsource');
const { FIREBASE_URL } = require('./config.js');

async function fbGet(path) {
  const res = await fetch(`${FIREBASE_URL}/${path}.json`);
  if (!res.ok) throw new Error(`Firebase GET ${path} — HTTP ${res.status}`);
  return res.json();
}

async function fbPut(path, data) {
  const res = await fetch(`${FIREBASE_URL}/${path}.json`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Firebase PUT ${path} — HTTP ${res.status}`);
  return res.json();
}

async function fbPost(path, data) {
  const res = await fetch(`${FIREBASE_URL}/${path}.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Firebase POST ${path} — HTTP ${res.status}`);
  return res.json(); // { name: '<pushId>' }
}

async function fbDelete(path) {
  const res = await fetch(`${FIREBASE_URL}/${path}.json`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`Firebase DELETE ${path} — HTTP ${res.status}`);
}

// Applique `data` au chemin relatif `subPath` (ex: "/abc/result") à l'intérieur
// de `root`, en fusionnant (pas en écrasant les clés soeurs à chaque niveau).
function applyAtPath(root, subPath, data) {
  const segments = String(subPath || '').split('/').filter(Boolean);
  if (segments.length === 0) return data ?? {};

  let cursor = root;
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i];
    if (typeof cursor[seg] !== 'object' || cursor[seg] === null) cursor[seg] = {};
    cursor = cursor[seg];
  }
  const lastSeg = segments[segments.length - 1];
  if (data === null) delete cursor[lastSeg];
  else cursor[lastSeg] = data;
  return root;
}

/**
 * Écoute un noeud Firebase RTDB en continu (SSE). onUpdate reçoit l'objet complet
 * du noeud à chaque changement. Firebase envoie `put` avec path:"/" pour le noeud
 * entier à la connexion, puis un sous-chemin (potentiellement profond, ex:
 * "/abc/result") pour chaque modif partielle ultérieure — on fusionne à la bonne
 * profondeur pour ne jamais écraser les clés soeurs au même niveau.
 */
// Firebase envoie un événement `keep-alive` toutes les ~30 s sur chaque flux. Si plus
// rien n'arrive pendant ce délai, la connexion est morte sans erreur (ex : le Wi-Fi du
// serveur s'est reconnecté et la socket TCP est restée ouverte dans le vide) : EventSource
// ne la rouvrirait jamais tout seul, et le bot raterait toutes les parties suivantes.
const STALL_MS = 90 * 1000;
const WATCHDOG_INTERVAL_MS = 15 * 1000;

function watchNode(path, onUpdate, onError = () => {}) {
  let es = null;
  let snapshot = {};
  let lastEventAt = Date.now();
  const alive = () => { lastEventAt = Date.now(); };

  const open = () => {
    es = new EventSource(`${FIREBASE_URL}/${path}.json`);
    es.onopen = alive;
    es.addEventListener('keep-alive', alive);

    es.addEventListener('put', event => {
      alive();
      try {
        const { path: subPath, data } = JSON.parse(event.data);
        if (subPath === '/') snapshot = data || {};
        else applyAtPath(snapshot, subPath, data);
        onUpdate({ ...snapshot });
      } catch (error) {
        onError(error);
      }
    });

    es.addEventListener('patch', event => {
      alive();
      try {
        const { path: subPath, data } = JSON.parse(event.data);
        Object.entries(data || {}).forEach(([key, value]) => {
          applyAtPath(snapshot, `${subPath}/${key}`, value);
        });
        onUpdate({ ...snapshot });
      } catch (error) {
        onError(error);
      }
    });

    es.onerror = () => onError(new Error(`Flux Firebase interrompu (${path}) — reconnexion auto`));
  };

  open();

  // Chien de garde : flux silencieux trop longtemps → on le referme et on le rouvre.
  // Firebase renvoie alors le noeud entier (`put` sur "/"), qui remplace le snapshot.
  const watchdog = setInterval(() => {
    const silentFor = Date.now() - lastEventAt;
    if (silentFor < STALL_MS) return;
    onError(new Error(`Flux Firebase silencieux depuis ${Math.round(silentFor / 1000)} s (${path}) — reconnexion forcée`));
    es.close();
    alive();
    open();
  }, WATCHDOG_INTERVAL_MS);
  watchdog.unref?.();

  return () => {
    clearInterval(watchdog);
    es.close();
  };
}

module.exports = { fbGet, fbPut, fbPost, fbDelete, watchNode };
