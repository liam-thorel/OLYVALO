/**
 * OLYCITY Overlay — le site en surimpression au-dessus du jeu.
 *
 * ⚠️ Contrainte à connaître avant tout : une fenêtre « toujours au-dessus » ne
 * peut PAS s'afficher par-dessus un jeu en plein écran exclusif. Windows donne
 * la surface entière au jeu et rien ne passe. Valorant doit être réglé sur
 * « Plein écran fenêtré ». C'est rappelé dans l'interface au premier lancement.
 *
 * Ce que cette application ne fait PAS, volontairement : aucune injection dans
 * le processus du jeu, aucun hook clavier bas niveau, aucune lecture de la
 * mémoire du jeu. C'est une fenêtre ordinaire posée au-dessus, et le raccourci
 * passe par RegisterHotKey (globalShortcut), une API Win32 publique. Rien ici
 * n'entre en contact avec Vanguard.
 */

const { app, BaseWindow, WebContentsView, globalShortcut, Tray, Menu, shell, ipcMain, screen, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const { detectGames, gameTransition, nextPollDelay, anyGameRunning } = require('./lib/game-watch.js');
const { createOverlayState, reduce } = require('./lib/overlay-state.js');
const { parseSettings, sanitize } = require('./lib/settings.js');
const { isAllowedUrl, isSafeExternalUrl, siteUrl } = require('./lib/url-policy.js');
const { createLogger } = require('./lib/logger.js');
const { setupAutoUpdate, shouldCheck, updateLabel, FIRST_CHECK_DELAY_MS } = require('./lib/updater.js');

const TITLEBAR_HEIGHT = 36;
// La vue compacte est dessinée pour une colonne étroite posée sur le côté de
// l'écran, pas pour une fenêtre de navigateur : 1100 px couvraient la moitié
// du jeu pour afficher trois blocs.
const DEFAULT_SIZE = { width: 460, height: 680 };
// En dessous, les lignes « nom · skins » se chevauchent et la barre de titre
// perd ses commandes.
const MIN_SIZE = { width: 320, height: 240 };

let window_ = null;
let siteView = null;
let tray = null;
let pollTimer = null;
let settings = sanitize(null);
let state = createOverlayState();
let lastRunning = { valorant: false, lol: false };
// Jeu actuellement affiché par la vue compacte, via le fragment d'URL.
let shownGame = '';
let firstRun = false;
let updater = null;
let lastUpdateCheckAt = 0;
let log = (...parts) => console.log(...parts); // remplacé dès que userData est connu

const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');

function loadSettings() {
  try {
    settings = parseSettings(fs.readFileSync(settingsPath(), 'utf8'));
    firstRun = false;
  } catch {
    settings = sanitize(null); // premier lancement, ou fichier illisible
    firstRun = true;
  }
  state = createOverlayState({ autoShow: settings.autoShow });
}

function saveSettings() {
  try {
    fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
    fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2));
  } catch (error) {
    console.error('[settings] écriture impossible —', error.message);
  }
}

// ─── Fenêtre ─────────────────────────────────────────────────────────────────

function layoutSiteView() {
  if (!window_ || !siteView) return;
  const { width, height } = window_.getContentBounds();
  siteView.setBounds({ x: 0, y: TITLEBAR_HEIGHT, width, height: Math.max(0, height - TITLEBAR_HEIGHT) });
}

// Une position mémorisée peut pointer sur un écran débranché depuis : la
// fenêtre serait alors invisible et introuvable.
function boundsOnVisibleScreen(bounds) {
  if (!bounds) return null;
  const fits = screen.getAllDisplays().some(display => {
    const area = display.workArea;
    return bounds.x < area.x + area.width && bounds.x + bounds.width > area.x
      && bounds.y < area.y + area.height && bounds.y + bounds.height > area.y;
  });
  if (!fits) return null;
  return {
    ...bounds,
    width: Math.max(bounds.width, MIN_SIZE.width),
    height: Math.max(bounds.height, MIN_SIZE.height),
  };
}

function createWindow() {
  const remembered = boundsOnVisibleScreen(settings.bounds);

  window_ = new BaseWindow({
    ...DEFAULT_SIZE,
    ...(remembered || {}),
    show: false,
    frame: false,
    transparent: false,
    resizable: true,
    minWidth: MIN_SIZE.width,
    minHeight: MIN_SIZE.height,
    skipTaskbar: true,   // l'overlay vit dans la zone de notification
    alwaysOnTop: true,
    title: 'OLYCITY Overlay',
  });

  // 'screen-saver' est le niveau le plus haut : au-dessus des autres fenêtres
  // « toujours visibles », dont celles d'autres outils de jeu.
  window_.setAlwaysOnTop(true, 'screen-saver');
  window_.setOpacity(settings.opacity);

  // La barre de titre est une page locale ; le site vit dans une vue séparée.
  // On évite ainsi l'iframe — et donc toute question de X-Frame-Options — et
  // le site n'a aucun accès au pont IPC de la barre.
  const chrome = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  chrome.webContents.loadFile(path.join(__dirname, 'ui', 'shell.html'));
  window_.contentView.addChildView(chrome);

  siteView = new WebContentsView({
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  siteView.webContents.loadURL(siteUrl('overlay.html'));
  window_.contentView.addChildView(siteView);

  const resizeChrome = () => {
    const { width } = window_.getContentBounds();
    chrome.setBounds({ x: 0, y: 0, width, height: TITLEBAR_HEIGHT });
    layoutSiteView();
  };
  resizeChrome();
  window_.on('resize', resizeChrome);

  // La fenêtre flotte au-dessus du jeu et démarre avec Windows : elle ne doit
  // pas pouvoir devenir un navigateur généraliste. Tout ce qui sort du site
  // part dans le navigateur par défaut, et seulement en http(s).
  const confine = contents => {
    contents.on('will-navigate', (event, url) => {
      if (isAllowedUrl(url)) return;
      event.preventDefault();
      if (isSafeExternalUrl(url)) shell.openExternal(url);
    });
    contents.setWindowOpenHandler(({ url }) => {
      if (isSafeExternalUrl(url) && !isAllowedUrl(url)) shell.openExternal(url);
      return { action: 'deny' }; // jamais de seconde fenêtre au-dessus du jeu
    });
  };
  confine(siteView.webContents);
  confine(chrome.webContents);

  const rememberBounds = () => {
    if (!window_ || window_.isDestroyed() || !window_.isVisible()) return;
    settings.bounds = window_.getBounds();
    saveSettings();
  };
  window_.on('moved', rememberBounds);
  window_.on('resized', rememberBounds);

  // Fermer la fenêtre la masque : quitter passe par la zone de notification.
  window_.on('close', event => {
    if (app.isQuitting) return;
    event.preventDefault();
    apply(reduce(state, 'hide'));
  });
}

/** Applique un nouvel état : c'est le seul endroit qui montre ou masque. */
/**
 * Repose le niveau « au-dessus de tout » et remonte la fenêtre dans l'ordre
 * d'empilement. Windows rétrograde une fenêtre always-on-top quand une autre
 * application passe au premier plan — un jeu qui démarre, typiquement — et
 * l'overlay se retrouve alors derrière sans que rien ne le signale.
 *
 * Aucun effet sur un jeu en plein écran EXCLUSIF : là, Windows ne laisse
 * aucune fenêtre au-dessus, et seul un changement de réglage dans le jeu peut
 * y remédier.
 */
function assertOnTop() {
  if (!window_ || window_.isDestroyed() || !window_.isVisible()) return;
  // Le second appel force une réévaluation même si Electron pense que le
  // niveau est déjà bon.
  window_.setAlwaysOnTop(false);
  window_.setAlwaysOnTop(true, 'screen-saver');
  window_.moveTop();
}

/** État réel de la fenêtre, pour le journal. */
function logWindowState(context) {
  if (!window_ || window_.isDestroyed()) {
    log(`[fenêtre] ${context} — fenêtre absente`);
    return;
  }
  const bounds = window_.getBounds();
  log(`[fenêtre] ${context} — visible=${window_.isVisible()}`,
    `auDessus=${window_.isAlwaysOnTop()}`,
    `position=${bounds.x},${bounds.y} ${bounds.width}x${bounds.height}`);
}

function apply(next) {
  const wasVisible = state.visible;
  state = next;
  if (!window_ || window_.isDestroyed()) return;
  if (state.visible === wasVisible) return;

  if (state.visible) {
    // Prendre le focus fait revenir la barre des tâches : Windows constate que
    // la fenêtre au premier plan n'est plus le jeu en plein écran et réaffiche
    // le shell. On n'active donc la fenêtre que lorsque l'utilisateur l'a
    // explicitement demandée — c'est qu'il veut s'en servir.
    //
    // manualOverride distingue les deux : il est faux quand l'affichage vient
    // du lancement d'une partie, vrai après un raccourci ou le menu.
    if (state.manualOverride && !settings.neverFocus) window_.show();
    else window_.showInactive(); // surgit sans voler le focus au jeu
    assertOnTop();
  } else {
    window_.hide();
  }
  refreshTrayMenu();
}

// ─── Détection du jeu ────────────────────────────────────────────────────────

function readTasklist() {
  return new Promise(resolve => {
    // execFile et non exec : pas de cmd.exe, donc pas de fenêtre noire qui
    // clignote au-dessus du jeu à chaque sondage.
    execFile('tasklist.exe', ['/fo', 'csv', '/nh'], { windowsHide: true, timeout: 5000 },
      (error, stdout) => resolve(error ? '' : stdout));
  });
}

async function pollGames() {
  const running = detectGames(await readTasklist());
  const transition = gameTransition(lastRunning, running);
  lastRunning = running;

  if (transition === 'launched') {
    const games = Object.entries(running).filter(([, on]) => on).map(([game]) => game).join(', ');
    log('[jeu] lancé :', games);
    apply(reduce(state, 'game-launched'));
    logWindowState('après lancement du jeu');
  } else if (transition === 'closed') {
    log('[jeu] fermé');
    apply(reduce(state, 'game-closed'));
  }

  showGame(running);

  if (anyGameRunning(running) && state.visible) assertOnTop();

  maybeCheckForUpdate(anyGameRunning(running));

  pollTimer = setTimeout(pollGames, nextPollDelay(running));
  pollTimer.unref?.();
}

/**
 * Aligne la vue sur le jeu lancé. Sans ça, une session Valorant encore
 * fraîche de la partie précédente s'affiche par-dessus la game LoL en cours :
 * la vue prend la plus récente des deux flux confondus.
 *
 * Valorant l'emporte si les deux tournent — on ne joue pas aux deux à la fois,
 * mais le client LoL reste souvent ouvert en fond.
 */
function showGame(running) {
  const next = running.valorant ? 'valorant' : running.lol ? 'lol' : '';
  if (next === shownGame) return;
  shownGame = next;
  log('[vue] jeu affiché :', next || 'aucun');
  const target = next ? `#${next}` : '';
  siteView?.webContents
    .executeJavaScript(`location.hash = ${JSON.stringify(target)}`)
    // La page peut ne pas être chargée (démarrage, réseau coupé) : on
    // retombe sur un chargement complet, qui portera le bon fragment.
    .catch(() => siteView?.webContents.loadURL(siteUrl(`overlay.html${target}`)));
}

function maybeCheckForUpdate(gameRunning) {
  if (!updater) return;
  const now = Date.now();
  if (!shouldCheck({ gameRunning, lastCheckAt: lastUpdateCheckAt, now })) return;
  lastUpdateCheckAt = now;
  updater.check();
}

// ─── Raccourci et zone de notification ───────────────────────────────────────

function registerHotkey() {
  globalShortcut.unregisterAll();
  // Un raccourci déjà pris par une autre application fait échouer
  // l'enregistrement : sans repli, l'overlay deviendrait inaccessible pour qui
  // n'a pas d'icône dans la zone de notification visible.
  const registered = globalShortcut.register(settings.hotkey, () => {
    apply(reduce(state, 'hotkey'));
    logWindowState('après raccourci');
  });
  if (!registered) {
    console.error(`[hotkey] ${settings.hotkey} est déjà pris par une autre application`);
    if (settings.hotkey !== 'Control+Shift+F8') {
      settings.hotkey = 'Control+Shift+F8';
      saveSettings();
      globalShortcut.register(settings.hotkey, () => apply(reduce(state, 'hotkey')));
    }
  }
  return registered;
}

/**
 * Le mode portable d'electron-builder extrait l'application dans un dossier
 * temporaire et l'exécute depuis là : process.execPath désigne ce dossier, qui
 * n'existera plus au prochain démarrage de Windows. Le lanceur portable publie
 * le chemin du vrai .exe dans PORTABLE_EXECUTABLE_FILE.
 */
function applyLoginItem() {
  const portableExe = process.env.PORTABLE_EXECUTABLE_FILE;
  try {
    app.setLoginItemSettings(portableExe
      ? { openAtLogin: settings.openAtLogin, path: portableExe, args: [] }
      : { openAtLogin: settings.openAtLogin });
    // Windows peut refuser silencieusement (stratégie de groupe, antivirus,
    // entrée supprimée par un nettoyeur). On relit ce qu'il a réellement
    // retenu plutôt que de supposer que l'appel a suffi.
    const effectif = app.getLoginItemSettings().openAtLogin;
    if (effectif === settings.openAtLogin) {
      log('[demarrage-windows]', settings.openAtLogin ? 'activé' : 'désactivé', portableExe ? '(portable)' : '');
    } else {
      log('[demarrage-windows] REFUSÉ par Windows — demandé:', settings.openAtLogin, 'effectif:', effectif);
    }
  } catch (error) {
    log('[demarrage-windows] échec —', error.message);
  }
}

function refreshTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: state.visible ? 'Masquer' : 'Afficher', click: () => apply(reduce(state, state.visible ? 'hide' : 'show')) },
    { type: 'separator' },
    {
      label: 'Afficher au lancement du jeu', type: 'checkbox', checked: settings.autoShow,
      click: menuItem => {
        settings.autoShow = menuItem.checked;
        saveSettings();
        apply(reduce(state, 'set-auto-show', menuItem.checked));
      },
    },
    {
      label: 'Ne jamais prendre le focus', type: 'checkbox', checked: settings.neverFocus,
      // Le focus est ce qui fait réapparaître la barre des tâches par-dessus
      // le jeu : sans lui, elle reste masquée.
      click: menuItem => {
        settings.neverFocus = menuItem.checked;
        saveSettings();
      },
    },
    {
      label: 'Démarrer avec Windows', type: 'checkbox', checked: settings.openAtLogin,
      click: menuItem => {
        settings.openAtLogin = menuItem.checked;
        saveSettings();
        applyLoginItem();
      },
    },
    { type: 'separator' },
    { label: `Raccourci : ${settings.hotkey}`, enabled: false },
    { type: 'separator' },
    // Pour qu'un diagnostic à distance ne demande pas de naviguer jusqu'à
    // %APPDATA% à l'aveugle.
    ...(updater?.pending() ? [
      { label: updateLabel(updater.pending()), click: () => { app.isQuitting = true; updater.installNow(); } },
      { type: 'separator' },
    ] : []),
    { label: 'Ouvrir le journal', click: () => shell.openPath(path.join(app.getPath('userData'), 'overlay.log')) },
    { type: 'separator' },
    { label: 'Quitter', click: () => { app.isQuitting = true; app.quit(); } },
  ]));
}

// Sans console, une exception au démarrage tue l'application en silence :
// l'utilisateur voit « rien ne se passe » et n'a rien à rapporter. On trace,
// et on le dit à l'écran plutôt que de disparaître.
process.on('uncaughtException', error => {
  log('[erreur]', error.stack || error.message);
  try {
    dialog.showErrorBox('OLYCITY Overlay',
      `${error.message}\n\nDétails dans :\n${path.join(app.getPath('userData'), 'overlay.log')}`);
  } catch { /* trop tôt pour une boîte de dialogue */ }
});

// Deux instances se disputeraient le raccourci global : la seconde échouerait
// à l'enregistrer et paraîtrait cassée.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => apply(reduce(state, 'show')));

  app.whenReady().then(() => {
    ({ log } = createLogger(app.getPath('userData')));
    log('[demarrage] OLYCITY Overlay', app.getVersion(), '· Electron', process.versions.electron);

    loadSettings();
    log('[reglages]', settingsPath(), firstRun ? '(premier lancement)' : '');
    createWindow();

    try {
      tray = new Tray(path.join(__dirname, 'ui', 'tray.png'));
      tray.setToolTip('OLYCITY Overlay — Ctrl+Shift+F8');
      tray.on('click', () => apply(reduce(state, state.visible ? 'hide' : 'show')));
      refreshTrayMenu();
      log('[zone-notification] icône créée');
    } catch (error) {
      // Sans icône l'application reste pilotable au raccourci : on continue,
      // mais on le dit, sinon « rien ne se passe » reste inexplicable.
      log('[zone-notification] échec —', error.message);
    }

    registerHotkey();
    applyLoginItem();

    // require() tardif : en développement (npm start) le paquet peut ne pas
    // être installé, et l'absence de mise à jour automatique ne doit pas
    // empêcher l'overlay de tourner.
    try {
      const { autoUpdater } = require('electron-updater');
      updater = setupAutoUpdate({
        autoUpdater, log,
        onStateChange: () => refreshTrayMenu(), // fait apparaître « Redémarrer pour installer »
      });
      const firstCheck = setTimeout(() => maybeCheckForUpdate(false), FIRST_CHECK_DELAY_MS);
      firstCheck.unref?.();
    } catch (error) {
      log('[maj] indisponible —', error.message);
    }

    pollGames();

    // Un premier lancement qui ne montre RIEN laisse croire que l'exécutable
    // n'a pas démarré : sur Windows 11 l'icône atterrit dans le débordement
    // masqué de la zone de notification, et personne ne la voit.
    if (firstRun) {
      log('[demarrage] premier lancement — affichage de la fenêtre');
      apply(reduce(state, 'show'));
    }
  });

  ipcMain.on('overlay:hide', () => apply(reduce(state, 'hide')));
  ipcMain.on('overlay:home', () => siteView?.webContents.loadURL(siteUrl('overlay.html')));
  ipcMain.on('overlay:full-site', () => siteView?.webContents.loadURL(siteUrl('#live')));
  ipcMain.on('overlay:opacity', (_event, value) => {
    settings.opacity = sanitize({ ...settings, opacity: value }).opacity;
    window_?.setOpacity(settings.opacity);
    saveSettings();
  });

  app.on('window-all-closed', () => { /* on vit dans la zone de notification */ });
  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    if (pollTimer) clearTimeout(pollTimer);
  });
}
