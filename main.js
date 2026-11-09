const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { Client } = require('minecraft-launcher-core');
const { autoUpdater } = require('electron-updater');

const config = require('./config.json');
const { AccountStore } = require('./src/auth');
const { syncModpack } = require('./src/sync');
const { ensureJava } = require('./src/java');
const { ensureNeoForge, getNeoForgeJvmArgs } = require('./src/neoforge');
const { SettingsStore, isEmptyDir, isInside } = require('./src/settings');

let win;
let accounts;
let settings;
let running = false;
let busy = false; // np. przenoszenie plików

const gb = (s) => parseFloat(String(s)) || 0; // "6G" -> 6
const gameDir = () => settings.get().gameDir;

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

async function fetchManifest(dir) {
  const cache = path.join(dir, 'manifest.json');
  try {
    const res = await fetch(`${config.manifestUrl}?t=${Date.now()}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const manifest = await res.json();
    fs.mkdirSync(dir, { recursive: true });
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
  if (running || busy) return;
  running = true;
  const s = settings.get();
  const dir = s.gameDir;
  try {
    progress('Sprawdzanie paczki...', 0);
    const manifest = await fetchManifest(dir);
    log(`Paczka: wersja ${manifest.version}`);

    const java = await ensureJava(dir, log, progress);
    progress('Synchronizacja modów...', 0);
    await syncModpack(manifest, dir, log, progress);

    progress('Przygotowanie NeoForge...', 0);
    const versionId = await ensureNeoForge(dir, manifest.loader.version, java.java, log);

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

    const extraJvm = s.jvmArgs ? s.jvmArgs.split(/\s+/).filter(Boolean) : [];
    log(`RAM: ${s.minRamGB}–${s.maxRamGB} GB, okno: ${s.fullscreen ? 'pełny ekran' : `${s.width}×${s.height}`}`);

    progress('Uruchamianie gry...', 1);
    const proc = await launcher.launch({
      root: dir,
      authorization,
      javaPath: java.javaw,
      version: { number: manifest.minecraft, type: 'release', custom: versionId },
      memory: { min: `${Math.round(s.minRamGB * 1024)}M`, max: `${Math.round(s.maxRamGB * 1024)}M` },
      window: s.fullscreen ? { fullscreen: true } : { width: s.width, height: s.height },
      customArgs: [...getNeoForgeJvmArgs(dir, versionId), ...extraJvm],
      quickPlay: { type: 'multiplayer', identifier: `${config.server.host}:${config.server.port}` },
      overrides: { detached: s.afterLaunch === 'close' },
    });
    if (!proc) throw new Error('Nie udało się uruchomić gry – zobacz log.');
    send('state', 'running');

    if (s.afterLaunch === 'close') {
      proc.unref();
      setTimeout(() => app.quit(), 3000);
    } else if (s.afterLaunch === 'minimize') {
      win.minimize();
    }
  } catch (e) {
    running = false;
    send('state', 'idle');
    send('error', e.message || String(e));
  }
}

/** Zmiana folderu gry, opcjonalnie z przeniesieniem plików. */
async function changeGameDir(newDir, move) {
  if (running || busy) throw new Error('Poczekaj, aż gra zostanie zamknięta.');
  const oldDir = gameDir();
  newDir = path.resolve(newDir);
  if (path.resolve(oldDir) === newDir) return settings.get();
  if (isInside(newDir, oldDir) || isInside(oldDir, newDir)) {
    throw new Error('Nowy folder nie może być wewnątrz starego (ani odwrotnie).');
  }
  if (isInside(newDir, path.dirname(app.getPath('exe')))) {
    throw new Error('Wybierz folder poza folderem instalacji launchera.');
  }

  if (move && fs.existsSync(oldDir)) {
    if (!isEmptyDir(newDir)) throw new Error('Aby przenieść pliki, wybierz pusty folder.');
    busy = true;
    send('state', 'busy');
    try {
      progress('Przenoszenie plików gry...', 0);
      log(`Przenoszenie ${oldDir} → ${newDir} (może potrwać kilka minut)...`);
      await fs.promises.cp(oldDir, newDir, { recursive: true, errorOnExist: false });
      await fs.promises.rm(oldDir, { recursive: true, force: true });
      log('Pliki przeniesione.');
    } finally {
      busy = false;
      send('state', 'idle');
    }
  } else {
    fs.mkdirSync(newDir, { recursive: true });
  }
  return settings.set({ gameDir: newDir });
}

app.whenReady().then(() => {
  const userData = app.getPath('userData');
  accounts = new AccountStore(path.join(userData, 'account.json'), config.microsoftClientId);
  settings = new SettingsStore(path.join(userData, 'settings.json'), {
    gameDir: path.join(app.getPath('appData'), config.gameDirName),
    maxRamGB: Math.min(gb(config.memory.max) || 6, SettingsStore.systemInfo().maxAllowedRamGB),
    minRamGB: gb(config.memory.min) || 2,
    width: 1280,
    height: 720,
    fullscreen: false,
    afterLaunch: 'minimize',
    jvmArgs: '',
  });

  ipcMain.handle('config:get', () => ({ appName: config.appName, server: config.server, version: app.getVersion() }));
  ipcMain.handle('account:get', () => accounts.get());
  ipcMain.handle('account:offline', (_e, name) => accounts.setOffline(name));
  ipcMain.handle('account:microsoft', () => accounts.loginMicrosoft());
  ipcMain.handle('account:logout', () => accounts.logout());
  ipcMain.handle('game:play', () => play());
  ipcMain.handle('game:openFolder', () => shell.openPath(gameDir()));

  ipcMain.handle('settings:get', () => ({
    settings: settings.get(),
    system: SettingsStore.systemInfo(),
    defaultGameDir: path.join(app.getPath('appData'), config.gameDirName),
  }));
  ipcMain.handle('settings:set', (_e, input) => {
    const { gameDir: _ignored, ...rest } = input || {}; // folder zmienia się osobno
    return settings.set(rest);
  });
  ipcMain.handle('settings:pickFolder', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: 'Wybierz folder instalacji gry',
      defaultPath: gameDir(),
      properties: ['openDirectory', 'createDirectory'],
    });
    return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.handle('settings:changeGameDir', (_e, dir, move) => changeGameDir(dir, move));

  createWindow();

  if (app.isPackaged) {
    autoUpdater.on('update-downloaded', () => send('log', 'Pobrano nową wersję launchera – zainstaluje się po zamknięciu.'));
    autoUpdater.checkForUpdatesAndNotify().catch(() => {});
  }
});

app.on('window-all-closed', () => app.quit());
