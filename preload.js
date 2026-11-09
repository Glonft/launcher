const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('launcher', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  getAccount: () => ipcRenderer.invoke('account:get'),
  loginOffline: (name) => ipcRenderer.invoke('account:offline', name),
  loginMicrosoft: () => ipcRenderer.invoke('account:microsoft'),
  logout: () => ipcRenderer.invoke('account:logout'),
  play: () => ipcRenderer.invoke('game:play'),
  openFolder: () => ipcRenderer.invoke('game:openFolder'),
  on: (channel, cb) => {
    if (['log', 'progress', 'state', 'error'].includes(channel)) {
      ipcRenderer.on(channel, (_e, data) => cb(data));
    }
  },
});
