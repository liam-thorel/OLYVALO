const EventSource = require('eventsource');
const { FIREBASE_URL, FIREBASE_AUTH_SECRET } = require('./config.js');

// Les règles de la base réservent betting/, discordConfig/, rankTracking/ et
// valorantAwards/ aux requêtes authentifiées : ce sont les données de valeur
// (soldes, paris, configuration), et le bot est le seul à les écrire depuis
// une machine privée. Le script live, lui, est distribué publiquement — aucun
// secret ne peut lui être confié, d'où des règles ouvertes de son côté.
//
// Sans secret configuré, on n'ajoute rien : le bot continue de fonctionner
// exactement comme avant tant que les règles n'ont pas été appliquées.
function withAuth(path) {
  const url = `${FIREBASE_URL}/${path}.json`;
  return FIREBASE_AUTH_SECRET ? `${url}?auth=${encodeURIComponent(FIREBASE_AUTH_SECRET)}` : url;
}

async function fbGet(path) {
  const res = await fetch(withAuth(path));
  if (!res.ok) throw new Error(`Firebase GET ${path} — HTTP ${res.status}`);
  return res.json();
}

async function fbPut(path, data) {
  const res = await fetch(withAuth(path), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Firebase PUT ${path} — HTTP ${res.status}`);
  return res.json();
}

async function fbPost(path, data) {
  const res = await fetch(withAuth(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Firebase POST ${path} — HTTP ${res.status}`);
  return res.json(); // { name: '<pushId>' }
}

async function fbDelete(path) {
  const res = await fetch(withAuth(path), { method: 'DELETE' });
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
function watchNode(path, onUpdate, onError = () => {}) {
  const es = new EventSource(withAuth(path));
  let snapshot = {};

  es.addEventListener('put', event => {
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

  return () => es.close();
}

module.exports = { fbGet, fbPut, fbPost, fbDelete, watchNode };
