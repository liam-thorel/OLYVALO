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

const { app, BaseWindow, WebContentsView, globalShortcut, Tray, Menu, shell, ipcMain, screen } = require('electron');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const { detectGames, gameTransition, nextPollDelay } = require('./lib/game-watch.js');
const { createOverlayState, reduce } = require('./lib/overlay-state.js');
const { parseSettings, sanitize } = require('./lib/settings.js');
const { isAllowedUrl, isSafeExternalUrl, siteUrl } = require('./lib/url-policy.js');

const TITLEBAR_HEIGHT = 36;
const DEFAULT_SIZE = { width: 1100, height: 720 };

let window_ = null;
let siteView = null;
let tray = null;
let pollTimer = null;
let settings = sanitize(null);
let state = createOverlayState();
let lastRunning = { valorant: false, lol: false };

const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');

function loadSettings() {
  try {
    settings = parseSettings(fs.readFileSync(settingsPath(), 'utf8'));
  } catch {
    settings = sanitize(null); // premier lancement, ou fichier illisible
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
  return fits ? bounds : null;
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
  siteView.webContents.loadURL(siteUrl('#live'));
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
function apply(next) {
  const wasVisible = state.visible;
  state = next;
  if (!window_ || window_.isDestroyed()) return;
  if (state.visible === wasVisible) return;

  if (state.visible) {
    window_.show();
    // Le niveau se perd parfois quand une autre application prend le premier
    // plan : on le réaffirme à chaque affichage.
    window_.setAlwaysOnTop(true, 'screen-saver');
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

  if (transition === 'launched') apply(reduce(state, 'game-launched'));
  else if (transition === 'closed') apply(reduce(state, 'game-closed'));

  pollTimer = setTimeout(pollGames, nextPollDelay(running));
  pollTimer.unref?.();
}

// ─── Raccourci et zone de notification ───────────────────────────────────────

function registerHotkey() {
  globalShortcut.unregisterAll();
  // Un raccourci déjà pris par une autre application fait échouer
  // l'enregistrement : sans repli, l'overlay deviendrait inaccessible pour qui
  // n'a pas d'icône dans la zone de notification visible.
  const registered = globalShortcut.register(settings.hotkey, () => apply(reduce(state, 'hotkey')));
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
      label: 'Démarrer avec Windows', type: 'checkbox', checked: settings.openAtLogin,
      click: menuItem => {
        settings.openAtLogin = menuItem.checked;
        saveSettings();
        app.setLoginItemSettings({ openAtLogin: menuItem.checked });
      },
    },
    { type: 'separator' },
    { label: `Raccourci : ${settings.hotkey}`, enabled: false },
    { type: 'separator' },
    { label: 'Quitter', click: () => { app.isQuitting = true; app.quit(); } },
  ]));
}

// Deux instances se disputeraient le raccourci global : la seconde échouerait
// à l'enregistrer et paraîtrait cassée.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => apply(reduce(state, 'show')));

  app.whenReady().then(() => {
    loadSettings();
    createWindow();

    tray = new Tray(path.join(__dirname, 'ui', 'tray.png'));
    tray.setToolTip('OLYCITY Overlay');
    tray.on('click', () => apply(reduce(state, state.visible ? 'hide' : 'show')));
    refreshTrayMenu();

    registerHotkey();
    app.setLoginItemSettings({ openAtLogin: settings.openAtLogin });
    pollGames();
  });

  ipcMain.on('overlay:hide', () => apply(reduce(state, 'hide')));
  ipcMain.on('overlay:home', () => siteView?.webContents.loadURL(siteUrl('#live')));
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
