const assert = require('node:assert/strict');
const { detectGames, anyGameRunning, gameTransition, nextPollDelay,
  IDLE_POLL_MS, ACTIVE_POLL_MS } = require('../overlay/lib/game-watch.js');
const { createOverlayState, reduce } = require('../overlay/lib/overlay-state.js');
const { sanitize, parseSettings, isValidHotkey, DEFAULTS, MIN_OPACITY } = require('../overlay/lib/settings.js');
const { isAllowedUrl, isSafeExternalUrl, siteUrl } = require('../overlay/lib/url-policy.js');

// ─── Détection du jeu ────────────────────────────────────────────────────────
// Sortie réelle de tasklist : colonnes alignées, casse variable.
const TASKLIST_VALORANT = `
Nom de l'image                 PID Nom de la session
========================= ======== ================
explorer.exe                  4512 Console
VALORANT-Win64-Shipping.exe   9184 Console
RiotClientServices.exe        3320 Console
`;
const TASKLIST_MENU_ONLY = `
VALORANT.exe                  9184 Console
RiotClientServices.exe        3320 Console
`;
const TASKLIST_LOL = `
League of Legends.exe        12044 Console
LeagueClient.exe              8800 Console
`;

assert.equal(detectGames(TASKLIST_VALORANT).valorant, true);
assert.equal(detectGames(TASKLIST_LOL).lol, true);

// Le launcher ne compte pas : VALORANT.exe reste en vie dans le menu, et
// l'overlay ne doit pas surgir pendant qu'on discute sur Discord.
assert.equal(detectGames(TASKLIST_MENU_ONLY).valorant, false,
  'le menu Valorant n’est pas une partie');

// Casse et entrées vides ne doivent pas fausser la lecture.
assert.equal(detectGames(TASKLIST_VALORANT.toUpperCase()).valorant, true);
assert.deepEqual(detectGames(''), { valorant: false, lol: false });
assert.deepEqual(detectGames(null), { valorant: false, lol: false });
assert.deepEqual(detectGames(undefined), { valorant: false, lol: false });

assert.equal(anyGameRunning({ valorant: false, lol: true }), true);
assert.equal(anyGameRunning({ valorant: false, lol: false }), false);
assert.equal(anyGameRunning(null), false);

// ─── Transitions ─────────────────────────────────────────────────────────────
// C'est la transition qui pilote l'overlay, pas l'état : sinon la fenêtre se
// ré-afficherait à chaque sondage pendant toute la partie.
const off = { valorant: false, lol: false };
const on = { valorant: true, lol: false };
assert.equal(gameTransition(off, on), 'launched');
assert.equal(gameTransition(on, off), 'closed');
assert.equal(gameTransition(on, on), 'none', 'jeu déjà lancé = rien à faire');
assert.equal(gameTransition(off, off), 'none');
// Passer de Valorant à LoL sans fermer : toujours « un jeu tourne ».
assert.equal(gameTransition({ valorant: true, lol: false }, { valorant: false, lol: true }), 'none');

// ─── Cadence ─────────────────────────────────────────────────────────────────
// L'application tourne toute la journée en fond : sonder toutes les 3 s ferait
// 28 800 processus par jour pour rien.
assert.equal(nextPollDelay(off), IDLE_POLL_MS);
assert.equal(nextPollDelay(on), ACTIVE_POLL_MS);
assert.ok(IDLE_POLL_MS > ACTIVE_POLL_MS, 'on sonde plus souvent quand une game tourne');

// ─── Visibilité ──────────────────────────────────────────────────────────────
let state = createOverlayState();
assert.equal(state.visible, false, 'rien ne s’affiche avant le lancement du jeu');

state = reduce(state, 'game-launched');
assert.equal(state.visible, true, 'le jeu se lance → l’overlay apparaît');

// Le cœur du problème : une fenêtre qu'on ferme ne doit pas revenir toute
// seule au sondage suivant.
state = reduce(state, 'hotkey');
assert.equal(state.visible, false);
state = reduce(state, 'game-launched'); // sondage qui reverrait le jeu
assert.equal(state.manualOverride, false, 'une nouvelle partie remet les compteurs à zéro');

// À la fermeture du jeu, la fenêtre disparaît — même ouverte à la main.
state = reduce(state, 'show');
state = reduce(state, 'game-closed');
assert.equal(state.visible, false, 'rien ne reste au-dessus du bureau après la game');
assert.equal(state.gameRunning, false);

// Le raccourci fonctionne aussi hors partie : c'est le ctrl+shift+F8 attendu.
state = reduce(state, 'hotkey');
assert.equal(state.visible, true, 'le raccourci marche même sans jeu lancé');
state = reduce(state, 'hotkey');
assert.equal(state.visible, false, 'et il referme');

// autoShow désactivé : le jeu ne déclenche plus rien, le raccourci si.
let manual = createOverlayState({ autoShow: false });
manual = reduce(manual, 'game-launched');
assert.equal(manual.visible, false, 'sans auto-affichage, le jeu ne montre rien');
manual = reduce(manual, 'hotkey');
assert.equal(manual.visible, true);

// Activer l'option pendant une partie doit se voir tout de suite, sinon on
// croit que le réglage est cassé.
let live = reduce(createOverlayState({ autoShow: false }), 'game-launched');
live = reduce(live, 'set-auto-show', true);
assert.equal(live.visible, true);

// …mais pas si l'utilisateur venait de fermer la fenêtre exprès.
let respected = reduce(createOverlayState({ autoShow: false }), 'game-launched');
respected = reduce(respected, 'hide');
respected = reduce(respected, 'set-auto-show', true);
assert.equal(respected.visible, false, 'un choix explicite n’est pas écrasé par un réglage');

// Un évènement inconnu ne doit rien casser.
assert.deepEqual(reduce(state, 'nimportequoi'), state);

// ─── Réglages ────────────────────────────────────────────────────────────────
// Le fichier est éditable à la main et l'application démarre avec Windows :
// une valeur aberrante ne doit jamais empêcher le lancement.
assert.deepEqual(sanitize(null), DEFAULTS);
assert.deepEqual(sanitize('pas un objet'), DEFAULTS);
assert.deepEqual(parseSettings('{ json cassé'), DEFAULTS);
assert.deepEqual(parseSettings(''), DEFAULTS);

// Une opacité trop basse rendrait la fenêtre introuvable.
assert.equal(sanitize({ opacity: 0 }).opacity, MIN_OPACITY);
assert.equal(sanitize({ opacity: -5 }).opacity, MIN_OPACITY);
assert.equal(sanitize({ opacity: 12 }).opacity, 1);
assert.equal(sanitize({ opacity: 'beaucoup' }).opacity, DEFAULTS.opacity);
assert.equal(sanitize({ opacity: 0.6 }).opacity, 0.6);

// Un raccourci sans modificateur capterait la touche partout dans Windows,
// jeu compris : on refuse.
assert.equal(isValidHotkey('F8'), false);
assert.equal(isValidHotkey('A'), false);
assert.equal(isValidHotkey('Control+Shift+'), false);
assert.equal(isValidHotkey('Control+Shift'), false, 'il faut une vraie touche à la fin');
assert.equal(isValidHotkey(''), false);
assert.equal(isValidHotkey(null), false);
assert.equal(isValidHotkey(42), false);
assert.equal(isValidHotkey('Control+Shift+F8'), true);
assert.equal(isValidHotkey('CommandOrControl+Alt+O'), true);
assert.equal(isValidHotkey('Alt+Tab'), true);
assert.equal(sanitize({ hotkey: 'F8' }).hotkey, DEFAULTS.hotkey, 'un raccourci refusé retombe au défaut');

// Une position mémorisée incomplète ne doit pas placer la fenêtre à NaN.
assert.equal(sanitize({ bounds: { x: 1, y: 2 } }).bounds, null);
assert.equal(sanitize({ bounds: { x: 0, y: 0, width: 0, height: 100 } }).bounds, null);
assert.deepEqual(sanitize({ bounds: { x: 10.6, y: 20.2, width: 800.9, height: 600.1 } }).bounds,
  { x: 11, y: 20, width: 801, height: 600 });

// ─── Focus et barre des tâches ───────────────────────────────────────────────
// Prendre le focus fait réapparaître la barre des tâches par-dessus le jeu :
// Windows constate que la fenêtre au premier plan n'est plus le jeu en plein
// écran. L'affichage automatique ne doit donc jamais activer la fenêtre ;
// manualOverride est ce qui distingue les deux cas.
let auto = createOverlayState();
auto = reduce(auto, 'game-launched');
assert.equal(auto.visible, true);
assert.equal(auto.manualOverride, false, 'un affichage automatique ne prend pas le focus');

let asked = reduce(createOverlayState(), 'hotkey');
assert.equal(asked.manualOverride, true, 'un affichage demandé peut prendre le focus');
assert.equal(reduce(createOverlayState(), 'show').manualOverride, true);

// Le réglage « ne jamais prendre le focus » survit à un fichier abîmé.
assert.equal(sanitize({}).neverFocus, false, 'le focus reste permis par défaut');
assert.equal(sanitize({ neverFocus: true }).neverFocus, true);
assert.equal(sanitize({ neverFocus: 'oui' }).neverFocus, false, 'une valeur non booléenne retombe au défaut');
assert.equal(sanitize(null).neverFocus, false);

// ─── Navigation ──────────────────────────────────────────────────────────────
// La fenêtre est toujours au-dessus du jeu et lancée au démarrage : elle ne
// doit pas pouvoir devenir un navigateur généraliste.
assert.equal(isAllowedUrl(siteUrl()), true);
assert.equal(isAllowedUrl(siteUrl('#live')), true);
assert.equal(isAllowedUrl('https://liam-thorel.github.io/OLYVALO/data/roster.json'), true);
assert.equal(isAllowedUrl('https://liam-thorel.github.io/'), false, 'la racine héberge d’autres dépôts');
assert.equal(isAllowedUrl('https://liam-thorel.github.io/AutreProjet/'), false);
// Un chemin qui commence par les mêmes lettres n'est pas le même dépôt.
assert.equal(isAllowedUrl('https://liam-thorel.github.io/OLYVALO-autre/'), false);
assert.equal(isAllowedUrl('http://liam-thorel.github.io/OLYVALO/'), false, 'http n’est pas https');
assert.equal(isAllowedUrl('https://evil.example/OLYVALO/'), false);
assert.equal(isAllowedUrl('file:///C:/Windows/System32/'), false);
assert.equal(isAllowedUrl('pas une url'), false);
assert.equal(isAllowedUrl(null), false);

// Ce qu'on refuse d'afficher peut partir dans le navigateur — mais seulement
// en http(s). Sinon openExternal lancerait n'importe quel protocole enregistré
// sur la machine.
assert.equal(isSafeExternalUrl('https://discord.com/channels/1'), true);
assert.equal(isSafeExternalUrl('http://exemple.fr'), true);
assert.equal(isSafeExternalUrl('file:///C:/Windows/System32/cmd.exe'), false);
assert.equal(isSafeExternalUrl('ms-settings:privacy'), false);
assert.equal(isSafeExternalUrl('javascript:alert(1)'), false);
assert.equal(isSafeExternalUrl('steam://run/730'), false);
assert.equal(isSafeExternalUrl(''), false);

// ─── Journal ─────────────────────────────────────────────────────────────────
// Sans trace écrite, un plantage au démarrage est parfaitement silencieux :
// c'est exactement ce qui s'est passé au premier essai sur un vrai poste.
const { createLogger, MAX_LOG_BYTES } = require('../overlay/lib/logger.js');

const fakeFs = (files = {}) => ({
  files,
  mkdirSync() {},
  statSync(f) { if (!(f in files)) throw new Error('ENOENT'); return { size: files[f].length }; },
  unlinkSync(f) { delete files[f]; },
  appendFileSync(f, data) { files[f] = (files[f] || '') + data; },
});

{
  const impl = fakeFs();
  const { log, file } = createLogger('/tmp/olycity', { fsImpl: impl, now: () => new Date('2026-09-11T07:00:00Z') });
  log('[demarrage]', 'test');
  assert.match(impl.files[file], /2026-09-11T07:00:00\.000Z\] \[demarrage\] test/);

  // Le journal vit à côté des réglages et l'application démarre avec Windows :
  // sans plafond, le fichier grossirait indéfiniment.
  impl.files[file] = 'x'.repeat(MAX_LOG_BYTES + 1);
  log('après rotation');
  assert.ok(impl.files[file].length < MAX_LOG_BYTES, 'le journal est reparti de zéro');
  assert.match(impl.files[file], /après rotation/);
}

{
  // Un disque plein ou un dossier en lecture seule ne doit jamais empêcher
  // l'application de tourner — journaliser n'est pas sa raison d'être.
  const cassé = { mkdirSync() { throw new Error('EACCES'); }, statSync() { throw new Error('EACCES'); },
    unlinkSync() {}, appendFileSync() { throw new Error('EACCES'); } };
  const { log } = createLogger('/interdit', { fsImpl: cassé });
  assert.doesNotThrow(() => log('toujours vivant'));
  assert.doesNotThrow(() => log('et on n’insiste pas'));
}

// ─── Mise à jour automatique ─────────────────────────────────────────────────
const { shouldCheck, updateLabel, CHECK_INTERVAL_MS } = require('../overlay/lib/updater.js');

// Ne jamais télécharger 90 Mo pendant une partie : ça mange la bande passante
// au pire moment, et l'installation devra de toute façon attendre la fermeture.
assert.equal(shouldCheck({ gameRunning: true, lastCheckAt: 0, now: 1e12 }), false,
  'aucune vérification pendant une game, même si on n’a jamais vérifié');

// Hors partie : une première fois tout de suite, puis espacé.
assert.equal(shouldCheck({ gameRunning: false, lastCheckAt: 0, now: 1e12 }), true);
assert.equal(shouldCheck({ gameRunning: false, lastCheckAt: 1e12, now: 1e12 + 1000 }), false,
  'on n’interroge pas GitHub à chaque sondage du jeu');
assert.equal(shouldCheck({ gameRunning: false, lastCheckAt: 1e12, now: 1e12 + CHECK_INTERVAL_MS }), true);

// Le sondage du jeu tourne toutes les 5 à 15 secondes : sans l'intervalle,
// l'overlay interrogerait GitHub des milliers de fois par jour.
let checks = 0;
let last = 0;
for (let t = 0; t < 24 * 3600_000; t += 15_000) {
  if (shouldCheck({ gameRunning: false, lastCheckAt: last, now: t })) { checks += 1; last = t; }
}
assert.ok(checks <= 5, `au plus quelques vérifications par jour, obtenu ${checks}`);

// Le libellé du menu doit nommer la version quand on la connaît.
assert.match(updateLabel({ version: '1.2.0' }), /1\.2\.0/);
assert.match(updateLabel(null), /Redémarrer/);
assert.match(updateLabel({}), /Redémarrer/);

console.log('overlay-logic: détection du jeu, visibilité, réglages et navigation validés');
