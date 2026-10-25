/**
 * OLYCITY Overlay — le site en surimpression au-dessus du jeu.
 *
 * ⚠️ Contrainte à connaître avant tout : une fenêtre « toujours au-dessus » ne
 * peut PAS s'afficher par-dessus un jeu en plein écran exclusif. Windows donne
 * la surface entière au jeu et rien ne passe. Valorant doit être réglé sur
 * « Plein écran fenêtré », LoL en « Sans bordure ». La barre du haut le rappelle,
 * et prévient si LoL est réglé en plein écran (voir lib/display-mode.js).
 *
 * Ce que cette application ne fait PAS, volontairement : aucune injection dans
 * le processus du jeu, aucun hook clavier bas niveau, aucune lecture de la
 * mémoire du jeu. C'est une fenêtre ordinaire posée au-dessus, et le raccourci
 * passe par RegisterHotKey (globalShortcut), une API Win32 publique. Rien ici
 * n'entre en contact avec Vanguard.
 *
 * Seule exception : LoL bloque RegisterHotKey tant qu'il a le focus. Pendant
 * qu'il tourne, on lit donc aussi l'état des touches du raccourci avec
 * GetAsyncKeyState — une question « ces touches sont-elles enfoncées ? », pas
 * un hook : aucune frappe ne nous passe sous les yeux. Voir lib/key-poll.js.
 */

const { app, BaseWindow, BrowserWindow, WebContentsView, globalShortcut, Tray, Menu, shell, ipcMain, screen, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const { detectGames, gameTransition, nextPollDelay, anyGameRunning } = require('./lib/game-watch.js');
const { createOverlayState, reduce } = require('./lib/overlay-state.js');
const { parseSettings, sanitize } = require('./lib/settings.js');
const { discordLoginStep, isAllowedUrl, isDiscordUrl, isSafeExternalUrl, siteUrl, LIVECHAT_PAGE } = require('./lib/url-policy.js');
const { createLogger } = require('./lib/logger.js');
const { setupAutoUpdate, shouldCheck, shouldInstallNow, updateLabel, FIRST_CHECK_DELAY_MS } = require('./lib/updater.js');
const { loginItemVerdict, unblockCommand, verdictMessage, STARTUP_SETTINGS_URL } = require('./lib/login-item.js');
const { hotkeyOptions, hotkeyLabel, hotkeyStatusLabel } = require('./lib/hotkey.js');
const { lolConfigPaths, lolWindowMode, displayHint } = require('./lib/display-mode.js');
const { acceleratorKeys, createKeyPoller, createDebounce } = require('./lib/key-poll.js');
const { centeredBounds } = require('./lib/placement.js');
const livechatKeys = require('./lib/livechat-keys.js');

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
let chromeView = null; // la barre du haut
let tray = null;
let pollTimer = null;
let settings = sanitize(null);
let state = createOverlayState();
let lastRunning = { valorant: false, lol: false };
let firstRun = false;
let updater = null;
let lastUpdateCheckAt = 0;
// Dernier verdict de Windows sur le démarrage automatique, pour que le menu
// de la zone de notification dise la vérité plutôt que l'intention.
let loginItemStatus = 'ok';
// Lecture directe du raccourci pendant LoL (voir lib/key-poll.js).
let keyPoller = null;
let readKey; // undefined : pas encore chargé · null : indisponible
// Partagé par les deux chemins : un même appui peut arriver par les deux.
const acceptHotkeyPress = createDebounce();
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
  chromeView = chrome;
  window_.contentView.addChildView(chrome);

  siteView = new WebContentsView({
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  // L'échec est traité par did-fail-load ci-dessous ; la promesse rejetée,
  // laissée sans suite, finirait en exception non interceptée.
  siteView.webContents.loadURL(siteUrl()).catch(() => {});
  window_.contentView.addChildView(siteView);

  // L'overlay démarre avec Windows, souvent avant que le réseau soit prêt :
  // la page d'erreur de Chromium restait alors affichée jusqu'au redémarrage.
  let failedLoads = 0;
  siteView.webContents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
    if (!isMainFrame || code === -3) return; // -3 : navigation remplacée par une autre
    failedLoads += 1;
    const delay = Math.min(60_000, 5_000 * failedLoads);
    log('[site] chargement échoué —', description, `(${code}), nouvel essai dans ${delay / 1000} s`);
    const timer = setTimeout(() => siteView?.webContents.loadURL(url || siteUrl()).catch(() => {}), delay);
    timer.unref?.();
  });
  siteView.webContents.on('did-finish-load', () => { failedLoads = 0; });

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
  // La connexion Discord a sa propre fenêtre (voir openDiscordLogin).
  const confine = contents => {
    contents.on('will-navigate', (event, url) => {
      if (isAllowedUrl(url)) return;
      event.preventDefault();
      if (isDiscordUrl(url)) openDiscordLogin(url, contents);
      else if (isSafeExternalUrl(url)) shell.openExternal(url);
    });
    contents.setWindowOpenHandler(({ url }) => {
      if (isDiscordUrl(url)) openDiscordLogin(url, contents);
      else if (isSafeExternalUrl(url) && !isAllowedUrl(url)) shell.openExternal(url);
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

/** Mode d'affichage de LoL lu dans son game.cfg, ou null s'il est introuvable. */
function readLolWindowMode() {
  for (const cfgPath of lolConfigPaths()) {
    try {
      if (fs.existsSync(cfgPath)) return lolWindowMode(fs.readFileSync(cfgPath, 'utf8'));
    } catch { /* fichier verrouillé ou illisible : on essaie le suivant */ }
  }
  return null;
}

/**
 * Met à jour le rappel de la barre du haut selon le jeu lancé. Si LoL est en
 * plein écran, l'overlay ne PEUT pas passer par-dessus : on le dit, au lieu de
 * laisser croire que le raccourci ne marche pas.
 */
function refreshDisplayHint(running) {
  const lolMode = running.lol ? readLolWindowMode() : null;
  if (running.lol) log('[jeu] mode d\'affichage LoL :', lolMode || 'inconnu');
  const hint = displayHint(running, lolMode);
  if (hint.warn) log('[jeu] ⚠️', hint.text);
  chromeView?.webContents
    .executeJavaScript(`window.setHint && window.setHint(${JSON.stringify(hint.text)}, ${hint.warn})`)
    .catch(() => {});
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
    ensureHotkeyAlive(`lancement de ${games}`);
    refreshDisplayHint(running);
    apply(reduce(state, 'game-launched'));
    logWindowState('après lancement du jeu');
  } else if (transition === 'closed') {
    log('[jeu] fermé');
    refreshDisplayHint(running);
    apply(reduce(state, 'game-closed'));
  }
  syncKeyPoller(running);

  if (anyGameRunning(running) && state.visible) assertOnTop();

  maybeCheckForUpdate(anyGameRunning(running));
  maybeInstallUpdate();

  pollTimer = setTimeout(pollGames, nextPollDelay(running));
  pollTimer.unref?.();
}

/**
 * Installe la mise à jour téléchargée dès que personne ne peut s'en
 * apercevoir — voir shouldInstallNow. Appelé à chaque sondage des jeux et dès
 * la fin d'un téléchargement : une mise à jour arrivée pendant une partie
 * s'installe à la fin de celle-ci, une fois l'overlay masqué.
 */
function maybeInstallUpdate() {
  // Déjà en train de quitter (installation lancée au tour précédent) : le
  // sondage suivant ne doit pas la relancer.
  if (!updater || app.isQuitting) return;
  const downloaded = updater.pending();
  if (!shouldInstallNow({ downloaded, gameRunning: anyGameRunning(lastRunning), visible: state.visible })) return;
  log('[maj] installation silencieuse de la', downloaded?.version || '?');
  app.isQuitting = true;
  updater.installNow();
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
  const registered = globalShortcut.register(settings.hotkey, () => onHotkey('windows'));
  if (!registered) {
    log('[raccourci]', hotkeyLabel(settings.hotkey), '— refusé, déjà pris par une autre application');
    if (settings.hotkey !== 'Control+Shift+F8') {
      settings.hotkey = 'Control+Shift+F8';
      saveSettings();
      return registerHotkey();
    }
  } else {
    log('[raccourci]', hotkeyLabel(settings.hotkey), '— enregistré');
  }
  return registered;
}

/** Un appui sur le raccourci, qu'il vienne de Windows ou de la lecture directe. */
function onHotkey(source) {
  // Le même appui arrive deux fois quand LoL tourne sans avoir le focus.
  if (!acceptHotkeyPress()) return;
  // Tracé AVANT d'agir : c'est ce qui permet de distinguer « la touche ne
  // nous parvient pas » de « elle nous parvient mais la fenêtre ne se voit
  // pas ». Sans cette ligne, les deux pannes sont indiscernables.
  log('[raccourci]', hotkeyLabel(settings.hotkey), source === 'sondage' ? 'reçu (lecture directe)' : 'reçu');
  apply(reduce(state, 'hotkey'));
  logWindowState('après raccourci');
}

/** GetAsyncKeyState via koffi, ou null si le module natif ne se charge pas. */
function asyncKeyReader() {
  if (readKey !== undefined) return readKey;
  readKey = null;
  if (process.platform !== 'win32') return readKey;
  try {
    const koffi = require('koffi');
    const GetAsyncKeyState = koffi.load('user32.dll').func('short __stdcall GetAsyncKeyState(int vKey)');
    // Bit de poids fort : la touche est enfoncée en ce moment.
    readKey = vk => (GetAsyncKeyState(vk) & 0x8000) !== 0;
  } catch (error) {
    log('[raccourci] lecture directe indisponible —', error.message);
  }
  return readKey;
}

/**
 * LoL déclare son clavier avec RIDEV_NOHOTKEYS : tant qu'il a le focus,
 * Windows ne nous transmet plus le raccourci. On lit alors les touches
 * nous-mêmes, mais seulement pendant que LoL tourne.
 */
function syncKeyPoller(running) {
  if (!running.lol) {
    if (keyPoller?.running()) {
      keyPoller.stop();
      log('[raccourci] lecture directe arrêtée');
    }
    return;
  }
  if (keyPoller?.running()) return;
  const isDown = asyncKeyReader();
  if (!isDown) return;
  const keys = acceleratorKeys(settings.hotkey);
  if (!keys) {
    log('[raccourci]', hotkeyLabel(settings.hotkey), '— lecture directe impossible pour cette combinaison');
    return;
  }
  keyPoller = createKeyPoller({
    isDown, keys,
    onPress: () => onHotkey('sondage'),
    onError: error => log('[raccourci] lecture directe interrompue —', error.message),
  });
  if (keyPoller.start()) log('[raccourci]', hotkeyLabel(settings.hotkey), '— lecture directe active (LoL bloque les raccourcis Windows)');
}

// ─── Connexion Discord ───────────────────────────────────────────────────────
// Le site part vers discord.com/oauth2/authorize et Discord y renvoie avec le
// jeton dans l'adresse. Cette fenêtre accueille tout le parcours chez Discord
// (connexion, captcha, double authentification), puis rend l'adresse de
// retour à la vue du site : c'est elle qui a posé l'état à vérifier, et c'est
// dans SON stockage que le compte doit être enregistré.
let discordLoginWindow = null;

function openDiscordLogin(url, target) {
  if (discordLoginWindow && !discordLoginWindow.isDestroyed()) discordLoginWindow.close();
  const login = new BrowserWindow({
    width: 520, height: 780, minimizable: false, maximizable: false, autoHideMenuBar: true,
    alwaysOnTop: true, title: 'Connexion Discord', backgroundColor: '#313338',
    // Même session que la vue du site : Discord se souvient de la connexion.
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  discordLoginWindow = login;
  login.setMenu(null);
  // Au-dessus de l'overlay, lui-même au niveau le plus haut.
  login.setAlwaysOnTop(true, 'screen-saver');
  // Le captcha de Discord se méfie d'un navigateur qui se dit « Electron ».
  const contents = login.webContents;
  contents.setUserAgent(contents.getUserAgent().replace(/\s(Electron|olycity[\w-]*)\/\S+/gi, ''));

  let returned = false;
  const backToSite = returnUrl => {
    if (returned) return;
    returned = true;
    log('[discord] connexion terminée, retour au site');
    if (target && !target.isDestroyed()) target.loadURL(returnUrl).catch(() => {});
    if (!login.isDestroyed()) login.close();
  };
  const guard = (event, url) => {
    const step = discordLoginStep(url);
    if (step === 'stay') return;
    event.preventDefault();
    if (step === 'return') backToSite(url);
    else if (step === 'external') shell.openExternal(url);
  };
  contents.on('will-navigate', (event, url) => guard(event, event.url || url));
  // Discord peut aussi renvoyer par une redirection du serveur. Les cadres
  // (captcha) vont où ils veulent : seule la page compte.
  contents.on('will-redirect', (event, url, _inPlace, isMainFrame) => {
    if ((event.isMainFrame ?? isMainFrame) === false) return;
    guard(event, event.url || url);
  });
  contents.setWindowOpenHandler(({ url }) => {
    if (discordLoginStep(url) === 'external') shell.openExternal(url);
    return { action: 'deny' };
  });
  login.on('closed', () => { if (discordLoginWindow === login) discordLoginWindow = null; });
  log('[discord] fenêtre de connexion ouverte');
  login.loadURL(url).catch(() => {});
}

/** Ouvre la page d'envoi du livechat dans l'overlay. */
function openLivechatPage() {
  siteView?.webContents.loadURL(LIVECHAT_PAGE).catch(() => {});
  apply(reduce(state, 'show'));
}

// ─── Livechat ────────────────────────────────────────────────────────────────
// Le livechat d'OLYCITY Live réglé ici plutôt que dans LIVECHAT.bat : activé
// ou coupé, volume, durée, touches (voir lib/livechat-keys.js).
let livechatWindow = null;

function openLivechatWindow() {
  if (livechatWindow && !livechatWindow.isDestroyed()) { livechatWindow.show(); livechatWindow.focus(); return; }
  livechatWindow = new BrowserWindow({
    width: 460, height: 720, minWidth: 380, minHeight: 360, minimizable: false, maximizable: false,
    alwaysOnTop: true, autoHideMenuBar: true, title: 'Livechat', backgroundColor: '#12151c',
    webPreferences: { preload: path.join(__dirname, 'preload-livechat.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  livechatWindow.setMenu(null);
  livechatWindow.setAlwaysOnTop(true, 'screen-saver');
  livechatWindow.loadFile(path.join(__dirname, 'ui', 'livechat.html')).catch(() => {});
  // Une page locale : aucune navigation, aucune fenêtre ouverte depuis elle.
  livechatWindow.webContents.on('will-navigate', event => event.preventDefault());
  livechatWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  livechatWindow.on('closed', () => { livechatWindow = null; });
}

function registerLivechatKeysIpc() {
  const write = (action, key) => {
    const result = livechatKeys.writeLivechatKey(action, key);
    if (result.ok) log('[livechat] touche', action, '→', livechatKeys.hotkeyLabel(key));
    return result;
  };
  ipcMain.handle('livechat:read', () => livechatKeys.readLivechatKeys());
  ipcMain.handle('livechat:capture', (_event, action, source, raw) => {
    const captured = source === 'mouse' ? livechatKeys.keyFromMouseEvent(raw) : livechatKeys.keyFromKeyboardEvent(raw);
    if (!captured) return null;
    if (captured.cancel) return { cancel: true };
    return write(action, captured.key);
  });
  ipcMain.handle('livechat:set', (_event, changes) => {
    const result = livechatKeys.writeLivechatSettings(changes);
    if (result.ok) log('[livechat] réglages', JSON.stringify(result.written));
    return result;
  });
  ipcMain.handle('livechat:open-page', () => { openLivechatPage(); return { ok: true }; });
  ipcMain.handle('livechat:remove', (_event, action) => write(action, null));
  ipcMain.handle('livechat:reset', (_event, action) => write(action,
    action === 'toggle' ? livechatKeys.DEFAULT_TOGGLE_KEY : livechatKeys.DEFAULT_SKIP_KEY));
}

/**
 * Ramène la fenêtre au milieu de l'écran où se trouve la souris. Une position
 * mémorisée sur un second écran éteint ou tourné ailleurs laisse sinon
 * l'overlay « affiché » sans que personne ne le voie.
 */
function bringWindowHere() {
  if (!window_ || window_.isDestroyed()) return;
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  window_.setBounds(centeredBounds(window_.getBounds(), display.workArea));
  settings.bounds = window_.getBounds();
  saveSettings();
  apply(reduce(state, 'show'));
  assertOnTop();
  logWindowState('ramenée sur l\'écran de la souris');
}

/**
 * Une autre application peut prendre la combinaison APRÈS notre démarrage :
 * RegisterHotKey est premier arrivé premier servi, et rien ne nous prévient.
 * On revérifie donc au lancement d'une partie — le moment exact où le
 * raccourci sert.
 */
function ensureHotkeyAlive(reason) {
  const alive = globalShortcut.isRegistered(settings.hotkey);
  if (alive) {
    log('[raccourci]', hotkeyLabel(settings.hotkey), '— actif', `(${reason})`);
    return true;
  }
  log('[raccourci]', hotkeyLabel(settings.hotkey), '— PERDU, nouvel essai', `(${reason})`);
  const recovered = registerHotkey();
  refreshTrayMenu();
  return recovered;
}

/** Change la combinaison depuis le menu, et dit tout de suite si ça a pris. */
function setHotkey(accelerator) {
  const previous = settings.hotkey;
  settings.hotkey = accelerator;
  saveSettings();
  const registered = registerHotkey();
  // La lecture directe sonde les touches de l'ancienne combinaison.
  keyPoller?.stop();
  keyPoller = null;
  syncKeyPoller(lastRunning);
  refreshTrayMenu();
  if (registered) return;
  dialog.showMessageBox({
    type: 'warning', title: 'OLYCITY Overlay', message: 'Raccourci indisponible',
    detail: `${hotkeyLabel(accelerator)} est déjà pris par une autre application (jeu, Discord, NVIDIA, Steam…).\n\nWindows n'accorde une combinaison qu'à une seule application à la fois. Essaies-en une autre dans le menu.`,
    buttons: ['Fermer'], noLink: true,
  }).catch(() => {});
  log('[raccourci] retour à', hotkeyLabel(previous));
}

/**
 * Le mode portable d'electron-builder extrait l'application dans un dossier
 * temporaire et l'exécute depuis là : process.execPath désigne ce dossier, qui
 * n'existera plus au prochain démarrage de Windows. Le lanceur portable publie
 * le chemin du vrai .exe dans PORTABLE_EXECUTABLE_FILE.
 */
function loginItemTarget() {
  return process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
}

/** Lève le blocage posé par Windows. Résout `true` si la commande a abouti. */
function unblockLoginItem(name) {
  const command = unblockCommand(name);
  if (!command) return Promise.resolve(false);
  return new Promise(resolve => {
    execFile(command.file, command.args, { windowsHide: true }, error => {
      if (error) log('[demarrage-windows] déblocage impossible —', error.message);
      resolve(!error);
    });
  });
}

/**
 * Inscrit (ou retire) l'application au démarrage de Windows, puis VÉRIFIE ce
 * que Windows en a réellement fait — voir lib/login-item.js : une case cochée
 * et une application qui démarre sont deux choses différentes.
 *
 * `explicit` distingue le réglage appliqué à chaque lancement de celui que
 * l'utilisateur vient de cocher lui-même. Dans le second cas seulement on
 * lève un blocage posé par Windows : l'intention est fraîche et sans
 * ambiguïté. Au démarrage, on se contente de le constater et de le dire —
 * une application qui se réactive toute seule après avoir été désactivée
 * dans le Gestionnaire des tâches n'est pas un comportement acceptable.
 */
async function applyLoginItem({ explicit = false } = {}) {
  // En développement (npm start), process.execPath est electron.exe :
  // l'inscrire au démarrage lancerait Electron à vide à chaque ouverture de
  // session, et laisserait une entrée que l'application packagée ne saurait
  // pas retirer.
  if (!app.isPackaged) {
    log('[demarrage-windows] ignoré — application non packagée');
    return;
  }

  const target = loginItemTarget();
  const options = { openAtLogin: settings.openAtLogin, path: target, args: [] };

  try {
    app.setLoginItemSettings(options);
  } catch (error) {
    loginItemStatus = 'refused';
    log('[demarrage-windows] échec —', error.message);
    return;
  }

  // La relecture DOIT porter les mêmes path/args que l'écriture, sinon
  // Electron répond pour l'exécutable par défaut — c'est-à-dire à côté dès
  // qu'on est en mode portable.
  const readback = app.getLoginItemSettings(options);
  let verdict = loginItemVerdict({ wanted: settings.openAtLogin, readback, execPath: target });

  if (verdict.status === 'blocked' && explicit) {
    log('[demarrage-windows] bloqué par Windows — levée du blocage sur', verdict.name);
    if (await unblockLoginItem(verdict.name)) {
      verdict = loginItemVerdict({
        wanted: settings.openAtLogin,
        readback: app.getLoginItemSettings(options),
        execPath: target,
      });
    }
  }

  loginItemStatus = verdict.status;
  log('[demarrage-windows]', settings.openAtLogin ? 'demandé: activé' : 'demandé: désactivé',
    '— verdict:', verdict.status, '— exécutable:', target,
    readback.wasOpenedAtLogin ? '(cette session a été ouverte au démarrage)' : '');

  refreshTrayMenu();

  // Le journal ne suffit pas : personne ne va le lire pour comprendre pourquoi
  // « rien ne se passe » au démarrage. On le dit une fois, à l'écran, et on
  // laisse l'utilisateur ouvrir la page des Paramètres concernée.
  const message = verdictMessage(verdict.status);
  if (!message || !settings.openAtLogin) {
    // Rien à signaler : on oublie l'avertissement précédent, pour qu'un blocage
    // qui reviendrait plus tard soit de nouveau signalé.
    if (settings.startupWarnedFor) { settings.startupWarnedFor = ''; saveSettings(); }
    return;
  }
  if (!explicit && settings.startupWarnedFor === verdict.status) return;

  settings.startupWarnedFor = verdict.status;
  saveSettings();

  const buttons = verdict.status === 'blocked' ? ['Ouvrir les Paramètres', 'Plus tard'] : ['Fermer'];
  const choice = await dialog.showMessageBox({
    type: 'warning', title: 'OLYCITY Overlay', message: 'Démarrage avec Windows', detail: message,
    buttons, defaultId: 0, cancelId: buttons.length - 1, noLink: true,
  }).catch(() => null);

  if (verdict.status === 'blocked' && choice?.response === 0) {
    shell.openExternal(STARTUP_SETTINGS_URL).catch(error =>
      log('[demarrage-windows] ouverture des Paramètres impossible —', error.message));
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
      // Le libellé porte le verdict de Windows : cocher la case et démarrer
      // réellement sont deux choses différentes, et l'écart est invisible
      // partout ailleurs.
      label: settings.openAtLogin && loginItemStatus === 'blocked'
        ? 'Démarrer avec Windows (bloqué par Windows)'
        : settings.openAtLogin && loginItemStatus === 'refused'
          ? 'Démarrer avec Windows (refusé par Windows)'
          : 'Démarrer avec Windows',
      type: 'checkbox', checked: settings.openAtLogin,
      click: menuItem => {
        settings.openAtLogin = menuItem.checked;
        saveSettings();
        // Coché à la main : intention fraîche, on lève un blocage éventuel.
        applyLoginItem({ explicit: true }).catch(error => log('[demarrage-windows]', error.message));
      },
    },
    ...(settings.openAtLogin && loginItemStatus === 'blocked' ? [{
      label: 'Ouvrir les réglages de démarrage de Windows',
      click: () => shell.openExternal(STARTUP_SETTINGS_URL).catch(() => {}),
    }] : []),
    { type: 'separator' },
    {
      // C'était une étiquette morte : le raccourci ne se changeait qu'en
      // éditant settings.json à la main. Quand une autre application détient
      // la combinaison, il n'y avait donc aucune porte de sortie.
      label: hotkeyStatusLabel(settings.hotkey, globalShortcut.isRegistered(settings.hotkey)),
      submenu: hotkeyOptions(settings.hotkey).map(choice => ({
        label: hotkeyLabel(choice), type: 'radio', checked: choice === settings.hotkey,
        click: () => setHotkey(choice),
      })),
    },
    { type: 'separator' },
    // Pour qu'un diagnostic à distance ne demande pas de naviguer jusqu'à
    // %APPDATA% à l'aveugle.
    ...(updater?.pending() ? [
      { label: updateLabel(updater.pending()), click: () => { app.isQuitting = true; updater.installNow(); } },
      { type: 'separator' },
    ] : []),
    { label: 'Livechat…', click: openLivechatWindow },
    { label: 'Envoyer un livechat', click: openLivechatPage },
    // La page d'envoi est sur le hub : de quoi revenir au tracker en un clic.
    { label: 'Revenir au tracker', click: () => siteView?.webContents.loadURL(siteUrl()).catch(() => {}) },
    { label: 'Ramener la fenêtre sur cet écran', click: bringWindowHere },
    // Le site est chargé une fois au démarrage et reste ouvert des jours.
    { label: 'Recharger la page', click: () => siteView?.webContents.reloadIgnoringCache() },
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
    applyLoginItem().catch(error => log('[demarrage-windows]', error.stack || error.message));

    // require() tardif : en développement (npm start) le paquet peut ne pas
    // être installé, et l'absence de mise à jour automatique ne doit pas
    // empêcher l'overlay de tourner.
    try {
      const { autoUpdater } = require('electron-updater');
      updater = setupAutoUpdate({
        autoUpdater, log,
        onStateChange: () => { refreshTrayMenu(); maybeInstallUpdate(); }, // « Redémarrer pour installer », ou installation directe
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
  ipcMain.on('overlay:livechat', () => openLivechatWindow());
  registerLivechatKeysIpc();
  ipcMain.on('overlay:opacity', (_event, value) => {
    settings.opacity = sanitize({ ...settings, opacity: value }).opacity;
    window_?.setOpacity(settings.opacity);
    saveSettings();
  });

  app.on('window-all-closed', () => { /* on vit dans la zone de notification */ });
  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    keyPoller?.stop();
    if (pollTimer) clearTimeout(pollTimer);
  });
}
