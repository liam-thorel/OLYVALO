/**
 * Pont entre la barre de titre et le processus principal. Volontairement
 * minuscule : trois messages sortants, aucun retour, aucun accès à
 * Node exposé. Le site, lui, tourne dans une vue séparée sans preload — il
 * n'a donc aucun moyen d'atteindre ce pont.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('overlay', {
  hide: () => ipcRenderer.send('overlay:hide'),
  openLivechat: () => ipcRenderer.send('overlay:livechat'),
  setOpacity: value => ipcRenderer.send('overlay:opacity', Number(value)),
});
