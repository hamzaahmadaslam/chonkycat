'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (cb) => {
  const fn = (_e, data) => cb(data);
  ipcRenderer.on(channel, fn);
  return () => ipcRenderer.removeListener(channel, fn);
};

contextBridge.exposeInMainWorld('arshia', {
  init: () => ipcRenderer.invoke('init'),
  onStatus: on('status'),
  onFx: on('fx'),
  onStats: on('stats'),
  onSettings: on('settings'),
  onCursor: on('cursor'),
  onBounds: on('bounds'),
  onPermission: on('permission'),
  onPermissionResolved: on('permission-resolved'),
  setHitRects: (rects) => ipcRenderer.send('hit-rects', rects),
  setViewport: (vp) => ipcRenderer.invoke('set-viewport', vp),
  moveDisplay: (pt) => ipcRenderer.invoke('move-display', pt),
  savePosition: (pos) => ipcRenderer.send('save-position', pos),
  decide: (id, decision) => ipcRenderer.send('permission-decision', { id, decision }),
  feed: () => ipcRenderer.invoke('feed'),
  pet: () => ipcRenderer.send('pet'),
  openSettings: () => ipcRenderer.send('open-settings'),
  quit: () => ipcRenderer.send('quit'),
  trayIcon: (dataUrl) => ipcRenderer.send('tray-icon', dataUrl),
  focusOverlay: (on) => ipcRenderer.send('focus-overlay', on),
  ask: (q) => ipcRenderer.invoke('ask', q),
  foregroundWindow: () => ipcRenderer.invoke('fg-window'),
  sessionWindow: (project) => ipcRenderer.invoke('session-window', project),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (patch) => ipcRenderer.invoke('save-settings', patch),
  getStats: () => ipcRenderer.invoke('get-stats'),
  previewFx: (type) => ipcRenderer.invoke('preview-fx', type),
});
