const { contextBridge, ipcRenderer, webUtils } = require('electron');

const invoke = (ch, ...a) => ipcRenderer.invoke(ch, ...a);

contextBridge.exposeInMainWorld('launcher', {
  getApp: () => invoke('app:get'),
  getChangelog: () => invoke('changelog:get'),
  refreshInfo: () => invoke('info:refresh'),
  pingServer: () => invoke('server:ping'),

  getAccounts: () => invoke('accounts:get'),
  addOffline: (name) => invoke('accounts:addOffline', name),
  addMicrosoft: () => invoke('accounts:addMicrosoft'),
  selectAccount: (id) => invoke('accounts:select', id),
  removeAccount: (id) => invoke('accounts:remove', id),

  getSkin: () => invoke('skin:get'),
  pickSkin: () => invoke('skin:pick'),
  setSkin: (file, variant) => invoke('skin:set', file, variant),
  resetSkin: () => invoke('skin:reset'),
  setCape: (capeId) => invoke('skin:setCape', capeId),
  copySkinCommand: () => invoke('skin:copyCommand'),

  play: (opts) => invoke('game:play', opts),
  myMods: () => invoke('mymods:list'),
  myModsSearch: (q, opts) => invoke('mymods:search', q, opts),
  myModsAddModrinth: (id) => invoke('mymods:addModrinth', id),
  myModsAddFile: (p) => invoke('mymods:addFile', p),
  myModsToggle: (id, on) => invoke('mymods:toggle', id, on),
  myModsRemove: (id) => invoke('mymods:remove', id),
  myModsUpdates: () => invoke('mymods:updates'),
  myModsUpdate: (u) => invoke('mymods:update', u),
  pathForFile: (f) => webUtils.getPathForFile(f),
  repair: () => invoke('game:repair'),
  openFolder: () => invoke('game:openFolder'),
  openExternal: (url) => invoke('open:external', url),

  getSettings: () => invoke('settings:get'),
  saveSettings: (s) => invoke('settings:set', s),
  pickFolder: () => invoke('settings:pickFolder'),
  changeGameDir: (dir, move) => invoke('settings:changeGameDir', dir, move),

  getUpdate: () => invoke('update:get'),
  checkUpdate: () => invoke('update:check'),
  installUpdate: () => invoke('update:install'),
  startUpdate: () => invoke('update:start'),
  laterUpdate: () => invoke('update:later'),
  showUpdateFile: () => invoke('update:showFile'),

  on: (channel, cb) => {
    if (['log', 'progress', 'state', 'error', 'info', 'update', 'seed'].includes(channel)) {
      ipcRenderer.on(channel, (_e, data) => cb(data));
    }
  },
});
