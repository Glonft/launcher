const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('launcher', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  getAccount: () => ipcRenderer.invoke('account:get'),
  loginOffline: (name) => ipcRenderer.invoke('account:offline', name),
  loginMicrosoft: () => ipcRenderer.invoke('account:microsoft'),
  logout: () => ipcRenderer.invoke('account:logout'),
  play: () => ipcRenderer.invoke('game:play'),
  openFolder: () => ipcRenderer.invoke('game:openFolder'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (s) => ipcRenderer.invoke('settings:set', s),
  pickFolder: () => ipcRenderer.invoke('settings:pickFolder'),
  changeGameDir: (dir, move) => ipcRenderer.invoke('settings:changeGameDir', dir, move),
  on: (channel, cb) => {
    if (['log', 'progress', 'state', 'error', 'server'].includes(channel)) {
      ipcRenderer.on(channel, (_e, data) => cb(data));
    }
  },
});
