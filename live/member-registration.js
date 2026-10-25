/**
 * Inscription au roster partagé d'une personne créée par ce PC.
 *
 * ask-identity.js inscrit la « nouvelle personne » dans rosterOverlay/members
 * au moment du choix. Si Firebase était injoignable à cet instant, il
 * annonçait que l'ajout « se fera au prochain démarrage »… sans que rien ne
 * le fasse : la personne restait absente du site (accueil, roster) pour
 * toujours. Le script vérifie donc à chaque démarrage.
 *
 * Écriture champ par champ, jamais de la fiche entière : une fiche déjà là
 * (avec l'identifiant Discord ajouté par /relier, une photo…) n'est jamais
 * écrasée, même si la lecture a échoué.
 */
async function ensureMemberRegistered({ identity, getFB, putFB, log = () => {}, now = Date.now() }) {
  if (!identity?.isNewMember || !/^[a-z0-9_-]{1,48}$/.test(String(identity.memberId || ''))) return false;
  const base = `rosterOverlay/members/${identity.memberId}`;
  const [member, hidden] = await Promise.all([
    getFB(base),
    getFB(`rosterOverlay/hiddenMembers/${identity.memberId}`),
  ]);
  // Retiré depuis l'admin : on ne le fait pas revenir.
  if (hidden === true) return false;
  if (member && member.name) return false;
  const name = String(identity.memberName || identity.memberId).slice(0, 32);
  const written = await putFB(`${base}/name`, name);
  if (!written) return false;
  if (!member) {
    await putFB(`${base}/createdBy`, 'olycity-live');
    await putFB(`${base}/createdAt`, now);
  }
  log(`👤 ${name} ajouté au roster OLYCITY (inscription rattrapée)`);
  return true;
}

module.exports = { ensureMemberRegistered };
