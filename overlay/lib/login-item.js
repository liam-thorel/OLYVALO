/**
 * Démarrage avec Windows — pourquoi une case cochée ne suffit pas.
 *
 * Windows tient DEUX registres pour le démarrage automatique :
 *
 *  1. la clé `Run`, où l'application s'inscrit elle-même — c'est ce
 *     qu'écrit `app.setLoginItemSettings({ openAtLogin: true })` ;
 *  2. `StartupApproved`, où Windows note ce qui a été DÉSACTIVÉ depuis le
 *     Gestionnaire des tâches, l'onglet « Démarrage » des Paramètres, ou par
 *     Windows lui-même (il désactive les applications qu'il juge lentes au
 *     démarrage, et certains nettoyeurs le font aussi).
 *
 * `getLoginItemSettings().openAtLogin` ne lit QUE la première. Une
 * application désactivée dans le second renvoie donc `openAtLogin: true`
 * tout en ne démarrant jamais : la case est cochée, le journal dit
 * « activé », et rien ne se lance. C'est exactement le symptôme rapporté.
 *
 * `launchItems` (Windows uniquement) donne l'état réel, entrée par entrée,
 * avec le drapeau `enabled` qui reflète les deux registres. C'est lui qu'on
 * regarde, et le nom qu'il porte est celui à rétablir.
 */

const STARTUP_APPROVED_KEY =
  'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run';

/** Page « Applications de démarrage » des Paramètres Windows. */
const STARTUP_SETTINGS_URL = 'ms-settings:startupapps';

function samePath(left, right) {
  if (!left || !right) return false;
  // Windows ne distingue pas la casse, et mélange les deux séparateurs selon
  // qui a écrit l'entrée (l'installeur, Electron, un import de registre).
  const normalize = value => String(value).replace(/\//g, '\\').trim().toLowerCase();
  return normalize(left) === normalize(right);
}

/**
 * Retrouve NOTRE entrée de démarrage parmi celles de l'utilisateur.
 *
 * On identifie par le chemin de l'exécutable et non par le nom : le nom est
 * choisi par Electron (`app.getName()`) et a pu changer entre deux versions,
 * alors que le chemin est celui qu'on vient d'inscrire.
 */
function findLaunchItem(launchItems, execPath) {
  if (!Array.isArray(launchItems)) return null;
  return launchItems.find(item => samePath(item?.path, execPath)) || null;
}

/**
 * Ce que Windows fera réellement au prochain démarrage.
 *
 *  - `ok`                 : conforme à ce qui est demandé ;
 *  - `blocked`            : inscrit dans `Run`, mais désactivé par Windows —
 *                           l'application ne démarrera pas ;
 *  - `refused`            : l'inscription elle-même n'a pas pris (stratégie
 *                           de groupe, antivirus, droits) ;
 *  - `unsupported`        : pas Windows, ou Electron ne renseigne pas l'état
 *                           détaillé — on s'en tient à ce qu'il affirme.
 *
 * `readback` est la valeur rendue par `app.getLoginItemSettings()`, relue
 * avec les MÊMES `path`/`args` que ceux passés à l'écriture (sans quoi
 * Electron compare à l'exécutable par défaut et répond à côté).
 */
function loginItemVerdict({ wanted, readback = {}, execPath = '', platform = process.platform } = {}) {
  const registered = readback.openAtLogin === true;
  const item = platform === 'win32' ? findLaunchItem(readback.launchItems, execPath) : null;

  if (!wanted) {
    // Désactivation : seule compte la disparition de la clé Run. Une entrée
    // désactivée par Windows ne démarre pas non plus, donc elle nous convient.
    return { status: registered && item?.enabled !== false ? 'refused' : 'ok', item, name: item?.name || '' };
  }

  if (!registered) return { status: 'refused', item, name: item?.name || '' };
  if (platform !== 'win32') return { status: 'ok', item: null, name: '' };

  // `executableWillLaunchAtLogin` tient compte des deux registres ; il peut
  // manquer sur d'anciennes versions d'Electron, d'où la retombée sur
  // l'entrée elle-même, puis sur « on ne sait pas ».
  if (readback.executableWillLaunchAtLogin === false || item?.enabled === false) {
    return { status: 'blocked', item, name: item?.name || '' };
  }
  if (readback.executableWillLaunchAtLogin === true || item?.enabled === true) {
    return { status: 'ok', item, name: item?.name || '' };
  }
  return { status: 'unsupported', item, name: item?.name || '' };
}

/**
 * Commande qui lève le blocage.
 *
 * Supprimer la valeur de `StartupApproved` suffit : Windows considère comme
 * activée toute entrée `Run` qui n'y figure pas. On ne réécrit donc aucun
 * drapeau, on retire seulement l'interdiction.
 *
 * Retourne `null` faute de nom exploitable — mieux vaut ne rien faire que
 * d'effacer l'entrée d'une autre application.
 */
function unblockCommand(name) {
  const value = String(name || '').trim();
  if (!value) return null;
  return { file: 'reg', args: ['delete', STARTUP_APPROVED_KEY, '/v', value, '/f'] };
}

/** Explication destinée à l'utilisateur, pas au journal. */
function verdictMessage(status) {
  if (status === 'blocked') {
    return [
      'Windows empêche OLYCITY Overlay de démarrer automatiquement.',
      '',
      'L’option est bien activée dans l’overlay, mais Windows l’a désactivée de son côté — il le fait tout seul pour les applications qu’il juge lentes au démarrage, et le Gestionnaire des tâches le fait aussi.',
      '',
      'Pour la rétablir : Paramètres → Applications → Démarrage, puis activez « OLYCITY Overlay ».',
    ].join('\n');
  }
  if (status === 'refused') {
    return [
      'Windows a refusé d’enregistrer OLYCITY Overlay au démarrage.',
      '',
      'C’est généralement un antivirus ou une stratégie d’entreprise qui protège la clé de démarrage.',
      '',
      'Solution de repli : placez un raccourci vers OLYCITY Overlay dans le dossier de démarrage (touche Windows + R, puis « shell:startup »).',
    ].join('\n');
  }
  return '';
}

module.exports = {
  STARTUP_APPROVED_KEY, STARTUP_SETTINGS_URL,
  findLaunchItem, loginItemVerdict, unblockCommand, verdictMessage, samePath,
};
