const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { Client } = require('minecraft-launcher-core');
const { autoUpdater } = require('electron-updater');

const config = require('./config.json');
const { AccountStore } = require('./src/auth');
const { syncModpack } = require('./src/sync');
const { ensureJava } = require('./src/java');
const { ensureNeoForge, getNeoForgeJvmArgs } = require('./src/neoforge');

const gameDir = path.join(app.getPath('appData'), config.gameDirName);
let win;
let accounts;
let running = false;

function send(channel, data) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, data);
}
const log = (msg) => { if (msg) send('log', msg); };
const progress = (label, value) => send('progress', { label, value });

function createWindow() {
  win = new BrowserWindow({
    width: 900,
    height: 560,
    resizable: false,
    title: config.appName,
    backgroundColor: '#14161c',
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

async function fetchManifest() {
  const cache = path.join(gameDir, 'manifest.json');
  try {
    const res = await fetch(`${config.manifestUrl}?t=${Date.now()}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const manifest = await res.json();
    fs.mkdirSync(gameDir, { recursive: true });
    fs.writeFileSync(cache, JSON.stringify(manifest));
    return manifest;
  } catch (e) {
    if (fs.existsSync(cache)) {
      log(`Nie udało się pobrać manifestu (${e.message}) – używam zapisanej wersji.`);
      return JSON.parse(fs.readFileSync(cache, 'utf8'));
    }
    throw new Error(`Nie można pobrać listy modów: ${e.message}`);
  }
}

async function play() {
  if (running) return;
  running = true;
  try {
    progress('Sprawdzanie paczki...', 0);
    const manifest = await fetchManifest();
    log(`Paczka: wersja ${manifest.version}`);

    const java = await ensureJava(gameDir, log, progress);
    progress('Synchronizacja modów...', 0);
    await syncModpack(manifest, gameDir, log, progress);

    progress('Przygotowanie NeoForge...', 0);
    const versionId = await ensureNeoForge(gameDir, manifest.loader.version, java.java, log);

    progress('Logowanie...', 0);
    const authorization = await accounts.getLaunchAuth();

    const launcher = new Client();
    launcher.on('progress', (p) => progress(`Pobieranie: ${p.type}`, p.total ? p.task / p.total : 0));
    launcher.on('debug', (m) => log(String(m)));
    launcher.on('data', (m) => log(String(m)));
    launcher.on('close', (code) => {
      log(`Gra zamknięta (kod ${code}).`);
      running = false;
      send('state', 'idle');
      if (win && !win.isDestroyed()) win.restore();
    });

    progress('Uruchamianie gry...', 1);
    const proc = await launcher.launch({
      root: gameDir,
      authorization,
      javaPath: java.javaw,
      version: { number: manifest.minecraft, type: 'release', custom: versionId },
      memory: { min: config.memory.min, max: config.memory.max },
      customArgs: getNeoForgeJvmArgs(gameDir, versionId),
      quickPlay: { type: 'multiplayer', identifier: `${config.server.host}:${config.server.port}` },
      overrides: { detached: false },
    });
    if (!proc) throw new Error('Nie udało się uruchomić gry – zobacz log.');
    send('state', 'running');
    win.minimize();
  } catch (e) {
    running = false;
    send('state', 'idle');
    send('error', e.message || String(e));
  }
}

app.whenReady().then(() => {
  accounts = new AccountStore(path.join(app.getPath('userData'), 'account.json'), config.microsoftClientId);

  ipcMain.handle('config:get', () => ({ appName: config.appName, server: config.server, version: app.getVersion() }));
  ipcMain.handle('account:get', () => accounts.get());
  ipcMain.handle('account:offline', (_e, name) => accounts.setOffline(name));
  ipcMain.handle('account:microsoft', () => accounts.loginMicrosoft());
  ipcMain.handle('account:logout', () => accounts.logout());
  ipcMain.handle('game:play', () => play());
  ipcMain.handle('game:openFolder', () => require('electron').shell.openPath(gameDir));

  createWindow();

  if (app.isPackaged) {
    autoUpdater.on('update-downloaded', () => send('log', 'Pobrano nową wersję launchera – zainstaluje się po zamknięciu.'));
    autoUpdater.checkForUpdatesAndNotify().catch(() => {});
  }
});

app.on('window-all-closed', () => app.quit());
