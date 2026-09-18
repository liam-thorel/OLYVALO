/**
 * Choix du raccourci global.
 *
 * `globalShortcut.register` passe par RegisterHotKey : une combinaison ne peut
 * appartenir qu'à UNE application à la fois, premier arrivé premier servi. Si
 * une autre application détient déjà la combinaison au moment où l'overlay
 * démarre, l'enregistrement échoue — et l'overlay devient inatteignable au
 * clavier sans qu'aucun message ne le dise.
 *
 * Le raccourci n'était modifiable qu'en éditant settings.json à la main : rien
 * dans l'interface ne permettait d'en sortir. D'où cette liste de rechange.
 */

/**
 * Combinaisons proposées.
 *
 * Toutes évitent ce que les jeux et les overlays existants occupent déjà :
 * Maj+Tab (Steam), Alt+Z et Alt+F9 (NVIDIA), Ctrl+Maj+~ (Discord), Win+G
 * (Xbox Game Bar). Les touches F11/F12 sont écartées — LoL s'en sert.
 */
const HOTKEY_CHOICES = [
  'Control+Shift+F8',
  'Control+Shift+F7',
  'Control+Shift+O',
  'Alt+Shift+O',
  'Control+Alt+O',
];

const DISPLAY = {
  control: 'Ctrl', ctrl: 'Ctrl', commandorcontrol: 'Ctrl', cmdorctrl: 'Ctrl',
  shift: 'Maj', alt: 'Alt', altgr: 'AltGr', super: 'Win', meta: 'Win',
  command: 'Cmd', cmd: 'Cmd', option: 'Option',
};

/** « Control+Shift+F8 » → « Ctrl+Maj+F8 », pour un menu lisible en français. */
function hotkeyLabel(accelerator) {
  return String(accelerator || '')
    .split('+')
    .map(part => DISPLAY[part.trim().toLowerCase()] || part.trim())
    .filter(Boolean)
    .join('+');
}

/**
 * Liste à afficher : les combinaisons proposées, plus celle en cours si elle
 * vient d'ailleurs (settings.json édité à la main). Sans ça, le réglage actif
 * n'apparaîtrait nulle part dans le menu.
 */
function hotkeyOptions(current) {
  const active = String(current || '').trim();
  if (!active || HOTKEY_CHOICES.some(choice => choice.toLowerCase() === active.toLowerCase())) {
    return [...HOTKEY_CHOICES];
  }
  return [active, ...HOTKEY_CHOICES];
}

/**
 * Message d'état du raccourci, pour le menu et le journal.
 *
 * `registered` vient de `globalShortcut.isRegistered` : c'est la seule façon
 * de savoir si la combinaison nous appartient encore. Une autre application
 * peut nous la prendre APRÈS notre démarrage.
 */
function hotkeyStatusLabel(accelerator, registered) {
  const label = hotkeyLabel(accelerator);
  return registered ? `Raccourci : ${label}` : `Raccourci : ${label} (pris par une autre application)`;
}

module.exports = { HOTKEY_CHOICES, hotkeyLabel, hotkeyOptions, hotkeyStatusLabel };
