/**
 * Ajout de lineups par le roster.
 *
 * Le modèle ne stocke aucun contenu : un lineup est une référence vers une
 * vidéo YouTube et un horodatage. Le créateur d'origine garde ses vues et sa
 * paternité, et nous n'hébergeons rien qui ne nous appartienne.
 *
 * Le point de friction est là : personne ne va lire un ID de vidéo dans une
 * URL ni convertir « 1m35s » en secondes. On accepte donc l'URL telle qu'elle
 * est copiée depuis la barre d'adresse ou le bouton Partager.
 */

const YOUTUBE_HOSTS = new Set([
  'youtube.com', 'www.youtube.com', 'm.youtube.com',
  'youtu.be', 'www.youtu.be', 'music.youtube.com',
]);

// Un ID YouTube fait exactement 11 caractères de cet alphabet.
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

/**
 * « 95 », « 1m35s », « 1h02m03s », « 02:35 » → secondes.
 * Retourne 0 pour tout ce qui n'est pas interprétable : démarrer au début est
 * un défaut acceptable, une valeur inventée ne l'est pas.
 */
export function parseTimestamp(value) {
  if (value == null) return 0;
  const raw = String(value).trim().toLowerCase();
  if (!raw) return 0;

  if (/^\d+$/.test(raw)) return Number(raw);

  // Format 1h02m03s / 5m / 90s
  const parts = raw.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  if (parts && parts.slice(1).some(Boolean)) {
    return Number(parts[1] || 0) * 3600 + Number(parts[2] || 0) * 60 + Number(parts[3] || 0);
  }

  // Format 2:35 ou 1:02:35
  if (/^\d{1,2}(:\d{1,2}){1,2}$/.test(raw)) {
    return raw.split(':').reduce((total, unit) => total * 60 + Number(unit), 0);
  }

  return 0;
}

/**
 * Extrait { videoId, start } d'une URL YouTube, quelle que soit sa forme.
 * Retourne null si ce n'est pas une vidéo YouTube identifiable — mieux vaut
 * refuser la saisie que d'enregistrer un lineup qui n'affichera rien.
 */
export function parseYouTubeRef(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;

  // Un ID collé seul est accepté : c'est ce qu'on lit dans data/lineups.json.
  if (VIDEO_ID.test(raw)) return { videoId: raw, start: 0 };

  let url;
  try {
    url = new URL(raw.includes('://') ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  if (!YOUTUBE_HOSTS.has(url.hostname.toLowerCase())) return null;

  const segments = url.pathname.split('/').filter(Boolean);
  const candidate = url.searchParams.get('v')
    || (url.hostname.endsWith('youtu.be') ? segments[0] : null)
    // /embed/ID et /shorts/ID
    || (['embed', 'shorts', 'live'].includes(segments[0]) ? segments[1] : null);

  if (!candidate || !VIDEO_ID.test(candidate)) return null;

  const start = parseTimestamp(url.searchParams.get('t') || url.searchParams.get('start') || 0);
  return { videoId: candidate, start };
}

const TYPES = new Set(['ATK', 'DEF']);
const DIFFICULTIES = new Set(['Facile', 'Moyen', 'Difficile']);

/**
 * Valide une saisie et retourne { ok, lineup } ou { ok:false, erreurs }.
 * Le rendu insère ces champs dans du HTML : un lineup incomplet casserait la
 * carte de la map pour tout le monde, pas seulement pour son auteur.
 */
export function validateLineup(input = {}) {
  const erreurs = [];
  const name = String(input.name || '').trim();
  const desc = String(input.desc || '').trim();
  const ref = parseYouTubeRef(input.video);

  if (!name) erreurs.push('Un nom est requis.');
  if (name.length > 80) erreurs.push('Le nom dépasse 80 caractères.');
  if (!ref) erreurs.push('Lien YouTube non reconnu.');
  if (!desc) erreurs.push('Une description est requise.');
  if (desc.length > 240) erreurs.push('La description dépasse 240 caractères.');
  if (!TYPES.has(input.type)) erreurs.push('Côté attendu : ATK ou DEF.');
  if (!DIFFICULTIES.has(input.diff)) erreurs.push('Difficulté attendue : Facile, Moyen ou Difficile.');
  if (!String(input.map || '').trim()) erreurs.push('Carte manquante.');
  if (!String(input.agent || '').trim()) erreurs.push('Agent manquant.');

  if (erreurs.length) return { ok: false, erreurs };
  return {
    ok: true,
    map: String(input.map).trim(),
    agent: String(input.agent).trim(),
    lineup: { name, type: input.type, diff: input.diff, videoId: ref.videoId, start: ref.start, desc },
  };
}

/**
 * Fusionne les lineups livrés avec le dépôt et ceux ajoutés par le roster
 * depuis le site. Les ajouts viennent après, à agent égal : la liste versionnée
 * reste la référence, les ajouts s'y empilent.
 *
 * Un même lineup ajouté deux fois — deux personnes qui trouvent la même vidéo —
 * n'apparaît qu'une fois : même vidéo au même instant, c'est le même lineup.
 */
export function mergeLineups(base = {}, added = {}) {
  const merged = {};
  const maps = new Set([...Object.keys(base || {}), ...Object.keys(added || {})]);

  for (const map of maps) {
    const agents = new Set([
      ...Object.keys(base?.[map] || {}),
      ...Object.keys(added?.[map] || {}),
    ]);
    const byAgent = {};
    for (const agent of agents) {
      const seen = new Set();
      const list = [...(base?.[map]?.[agent] || []), ...Object.values(added?.[map]?.[agent] || {})]
        .filter(entry => entry && entry.videoId)
        .filter(entry => {
          const key = `${entry.videoId}@${entry.start || 0}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      if (list.length) byAgent[agent] = list;
    }
    if (Object.keys(byAgent).length) merged[map] = byAgent;
  }
  return merged;
}

/** Nombre de lineups par carte, pour signaler celles qui n'en ont aucun. */
export function lineupCoverage(lineups = {}, maps = []) {
  return maps.map(map => ({
    map,
    count: Object.values(lineups?.[map] || {}).reduce((total, list) => total + (list?.length || 0), 0),
  }));
}
