/**
 * Collections de dédoublonnage à taille bornée.
 *
 * Le bot est prévu pour tourner des mois sans redémarrer. Les Set/Map qui
 * mémorisent « cette game a déjà été notifiée » n'étaient jamais purgés : ils
 * grossissaient d'une entrée par game, indéfiniment.
 *
 * Ces structures ne servent qu'à couvrir une fenêtre courte (une game en
 * cours, une fenêtre anti-doublon de 20 minutes) : au-delà, une entrée ne
 * protège plus de rien et ne fait qu'occuper de la mémoire.
 */

/**
 * Set d'identifiants qui ne conserve que les N derniers vus.
 * L'ordre d'insertion d'un Set JS est garanti, la purge suit donc l'ancienneté.
 */
function createBoundedSet(limit = 500) {
  const seen = new Set();
  return {
    has: value => seen.has(value),
    add(value) {
      // Réinsérer remet l'entrée en fin de file : une game encore active ne
      // doit pas être évincée par de plus récentes.
      seen.delete(value);
      seen.add(value);
      while (seen.size > limit) seen.delete(seen.values().next().value);
      return this;
    },
    get size() { return seen.size; },
  };
}

/**
 * Map clé -> timestamp qui oublie les entrées plus vieilles que `maxAgeMs`.
 * La purge est faite à l'écriture : pas de minuterie à gérer ni à arrêter.
 */
function createExpiringMap(maxAgeMs) {
  const entries = new Map();

  const prune = (now = Date.now()) => {
    for (const [key, timestamp] of entries) {
      if (now - timestamp >= maxAgeMs) entries.delete(key);
    }
  };

  return {
    /** true si la clé a été vue il y a moins de maxAgeMs ; sinon l'enregistre. */
    seenRecently(key, now = Date.now()) {
      prune(now);
      const last = entries.get(key);
      if (last != null && now - last < maxAgeMs) return true;
      entries.set(key, now);
      return false;
    },
    get size() { return entries.size; },
  };
}

module.exports = { createBoundedSet, createExpiringMap };
