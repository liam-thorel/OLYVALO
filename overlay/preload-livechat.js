/**
 * Pont de la fenêtre « Livechat ». Comme preload.js : quelques
 * messages, aucun accès à Node. Les évènements clavier/souris ne passent que
 * réduits à leurs codes ; c'est le processus principal qui les traduit et
 * écrit les réglages du Live.
 */
const { contextBridge, ipcRenderer } = require('electron');

const pick = event => ({
  keyCode: event.keyCode, button: event.button,
  ctrlKey: event.ctrlKey, shiftKey: event.shiftKey, altKey: event.altKey, metaKey: event.metaKey,
});

contextBridge.exposeInMainWorld('livechatKeys', {
  read: () => ipcRenderer.invoke('livechat:read'),
  captureKeyboard: (action, event) => ipcRenderer.invoke('livechat:capture', action, 'keyboard', pick(event)),
  captureMouse: (action, event) => ipcRenderer.invoke('livechat:capture', action, 'mouse', pick(event)),
  remove: action => ipcRenderer.invoke('livechat:remove', action),
  reset: action => ipcRenderer.invoke('livechat:reset', action),
  set: changes => ipcRenderer.invoke('livechat:set', {
    enabled: changes?.enabled, volume: changes?.volume, maxVideoSeconds: changes?.maxVideoSeconds,
  }),
  openPage: () => ipcRenderer.invoke('livechat:open-page'),
});
