const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { findLaunchItem, loginItemVerdict, unblockCommand, verdictMessage, samePath,
  STARTUP_APPROVED_KEY, STARTUP_SETTINGS_URL } = require('../overlay/lib/login-item.js');
const { sanitize } = require('../overlay/lib/settings.js');

const EXE = 'C:\\Users\\liam\\AppData\\Local\\Programs\\olycity-overlay\\OLYCITY Overlay.exe';

// ─── Le défaut corrigé ───────────────────────────────────────────────────────
// Windows tient deux registres. `openAtLogin` ne lit que le premier : une
// application désactivée dans le Gestionnaire des tâches répond donc « oui, je
// démarre » tout en ne démarrant jamais. C'est le symptôme rapporté — la case
// est cochée, le journal dit « activé », et rien ne se lance.
const bloque = loginItemVerdict({
  wanted: true,
  execPath: EXE,
  platform: 'win32',
  readback: {
    openAtLogin: true,             // la clé Run est bien là...
    executableWillLaunchAtLogin: false, // ...mais Windows la neutralise
    launchItems: [{ name: 'OLYCITY Overlay', path: EXE, args: [], scope: 'user', enabled: false }],
  },
});
assert.equal(bloque.status, 'blocked', 'inscrit mais désactivé par Windows');
assert.equal(bloque.name, 'OLYCITY Overlay', 'le nom sert à lever le blocage');

// ─── Cas nominal ─────────────────────────────────────────────────────────────
const ok = loginItemVerdict({
  wanted: true, execPath: EXE, platform: 'win32',
  readback: {
    openAtLogin: true, executableWillLaunchAtLogin: true,
    launchItems: [{ name: 'OLYCITY Overlay', path: EXE, enabled: true }],
  },
});
assert.equal(ok.status, 'ok');

// ─── L'inscription elle-même a échoué ────────────────────────────────────────
// Antivirus ou stratégie de groupe : la clé Run n'a pas été écrite.
assert.equal(loginItemVerdict({
  wanted: true, execPath: EXE, platform: 'win32',
  readback: { openAtLogin: false, launchItems: [] },
}).status, 'refused');

// ─── Désactivation demandée ──────────────────────────────────────────────────
assert.equal(loginItemVerdict({
  wanted: false, execPath: EXE, platform: 'win32',
  readback: { openAtLogin: false, launchItems: [] },
}).status, 'ok', 'retrait effectif');

assert.equal(loginItemVerdict({
  wanted: false, execPath: EXE, platform: 'win32',
  readback: {
    openAtLogin: true, executableWillLaunchAtLogin: true,
    launchItems: [{ name: 'OLYCITY Overlay', path: EXE, enabled: true }],
  },
}).status, 'refused', 'l’entrée survit au retrait');

// Une entrée qui subsiste mais que Windows neutralise ne démarrera pas : le
// retrait demandé est satisfait dans les faits, inutile d'alerter.
assert.equal(loginItemVerdict({
  wanted: false, execPath: EXE, platform: 'win32',
  readback: {
    openAtLogin: true, executableWillLaunchAtLogin: false,
    launchItems: [{ name: 'OLYCITY Overlay', path: EXE, enabled: false }],
  },
}).status, 'ok');

// ─── Absence d'information ───────────────────────────────────────────────────
// Electron ne renseigne pas toujours le détail (autre plateforme, version
// ancienne). On ne doit ni inventer un blocage ni affirmer un succès.
assert.equal(loginItemVerdict({
  wanted: true, execPath: EXE, platform: 'win32',
  readback: { openAtLogin: true },
}).status, 'unsupported');
assert.equal(verdictMessage('unsupported'), '', 'aucune alerte sans certitude');

assert.equal(loginItemVerdict({
  wanted: true, execPath: '/Applications/Overlay.app', platform: 'darwin',
  readback: { openAtLogin: true },
}).status, 'ok', 'hors Windows, openAtLogin fait foi');

// ─── Identification de NOTRE entrée ──────────────────────────────────────────
// Le nom est choisi par Electron et a pu changer d'une version à l'autre ; le
// chemin, lui, est celui qu'on vient d'inscrire.
const items = [
  { name: 'Discord', path: 'C:\\Users\\liam\\AppData\\Local\\Discord\\Update.exe', enabled: true },
  { name: 'Ancien nom', path: EXE, enabled: false },
];
assert.equal(findLaunchItem(items, EXE)?.name, 'Ancien nom');
assert.equal(findLaunchItem(items, 'C:\\Autre\\app.exe'), null);
assert.equal(findLaunchItem(null, EXE), null);
assert.equal(findLaunchItem(undefined, EXE), null);

// Windows ignore la casse et mélange les séparateurs selon qui a écrit l'entrée.
assert.equal(samePath(EXE, EXE.toUpperCase()), true);
assert.equal(samePath('C:/jeux/app.exe', 'C:\\Jeux\\app.exe'), true);
assert.equal(samePath('', ''), false, 'deux chemins vides ne sont pas la même entrée');
assert.equal(samePath(null, EXE), false);

// ─── Levée du blocage ────────────────────────────────────────────────────────
// Supprimer la valeur suffit : Windows considère comme activée toute entrée Run
// qui ne figure pas dans StartupApproved. On ne réécrit aucun drapeau.
const cmd = unblockCommand('OLYCITY Overlay');
assert.equal(cmd.file, 'reg');
assert.deepEqual(cmd.args, ['delete', STARTUP_APPROVED_KEY, '/v', 'OLYCITY Overlay', '/f']);
assert.match(STARTUP_APPROVED_KEY, /^HKCU\\/, 'jamais HKLM : pas de droits administrateur requis');

// Sans nom exploitable on ne fait rien — effacer au hasard toucherait l'entrée
// d'une autre application.
assert.equal(unblockCommand(''), null);
assert.equal(unblockCommand(null), null);
assert.equal(unblockCommand('   '), null);

// ─── Messages ────────────────────────────────────────────────────────────────
assert.match(verdictMessage('blocked'), /Paramètres → Applications → Démarrage/);
assert.match(verdictMessage('refused'), /shell:startup/, 'une solution de repli concrète');
assert.equal(verdictMessage('ok'), '');
assert.equal(STARTUP_SETTINGS_URL, 'ms-settings:startupapps');

// ─── Réglage persisté ────────────────────────────────────────────────────────
// L'avertissement ne doit pas se rouvrir à chaque ouverture de session.
assert.equal(sanitize(null).startupWarnedFor, '');
assert.equal(sanitize({ startupWarnedFor: 'blocked' }).startupWarnedFor, 'blocked');
assert.equal(sanitize({ startupWarnedFor: 42 }).startupWarnedFor, '', 'valeur illisible → défaut');

// ─── Câblage dans main.js ────────────────────────────────────────────────────
// Le module ne sert à rien s'il n'est pas branché ; et une inscription faite en
// développement enregistrerait electron.exe au démarrage de Windows.
const main = readFileSync(path.join(__dirname, '..', 'overlay', 'main.js'), 'utf8');
assert.match(main, /require\('\.\/lib\/login-item\.js'\)/);
assert.match(main, /if \(!app\.isPackaged\)/, 'pas d’inscription hors application packagée');
assert.match(main, /applyLoginItem\(\{ explicit: true \}\)/, 'le clic sur la case lève un blocage');
// La relecture doit porter les mêmes path/args que l'écriture, sinon Electron
// répond pour l'exécutable par défaut — faux dès qu'on est en mode portable.
assert.match(main, /app\.getLoginItemSettings\(options\)/);
assert.doesNotMatch(main, /getLoginItemSettings\(\)/, 'relecture sans options = réponse à côté');

console.log('overlay-login-item: blocage Windows détecté, levé sur demande, et signalé une fois');
