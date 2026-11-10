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
const { pingServer } = require('./src/ping');
const { PortableUpdater, isPortable } = require('./src/portable-updater');
const skin = require('./src/skin');

let win;
let accounts;
let settings;
let running = false;
let busy = false; // przenoszenie plików / naprawa
let updateState = { state: 'idle' };
let portableUpdater = null;

const gb = (s) => parseFloat(String(s)) || 0; // "6G" -> 6
const gameDir = () => settings.get().gameDir;

function send(channel, data) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, data);
}
const log = (msg) => { if (msg) send('log', msg); };
const progress = (label, value) => send('progress', { label, value });
const setState = (s) => send('state', s);

// ---------- manifest ----------

/** Adres serwera z manifestu (można go zmienić w repo modpack), awaryjnie z config.json. */
function serverFrom(manifest) {
  const s = manifest && manifest.server;
  if (s && s.host && Number(s.port)) return { name: s.name || config.appName, host: s.host, port: Number(s.port) };
  return { name: config.appName, ...config.server };
}

function cachedManifest() {
  try { return JSON.parse(fs.readFileSync(path.join(gameDir(), 'manifest.json'), 'utf8')); }
  catch { return null; }
}

async function fetchManifest(dir, quiet = false) {
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
      if (!quiet) log(`Nie udało się pobrać manifestu (${e.message}) – używam zapisanej wersji.`);
      return JSON.parse(fs.readFileSync(cache, 'utf8'));
    }
    throw new Error(`Nie można pobrać listy modów: ${e.message}`);
  }
}

/** Informacje dla ekranu głównego: serwer, newsy, dodatki. */
function publicInfo(manifest) {
  return {
    server: serverFrom(manifest),
    news: (manifest && manifest.news) || [],
    optional: ((manifest && manifest.optional) || []).map((g) => ({
      id: g.id, name: g.name, description: g.description || '', default: !!g.default,
    })),
    packVersion: manifest ? manifest.version : null,
  };
}

// ---------- gra ----------

/** Java + mody + NeoForge. Zwraca wszystko, czego trzeba do startu. */
async function prepare(dir) {
  progress('Sprawdzanie paczki...', 0);
  const manifest = await fetchManifest(dir);
  log(`Paczka: wersja ${manifest.version}`);
  send('info', publicInfo(manifest));

  const java = await ensureJava(dir, log, progress, manifest.java);
  progress('Synchronizacja modów...', 0);
  await syncModpack(manifest, dir, log, progress, settings.get().addons || {});

  progress('Przygotowanie NeoForge...', 0);
  const versionId = await ensureNeoForge(dir, manifest.loader.version, java.java, log);
  return { manifest, java, versionId };
}

async function play() {
  if (running || busy) return;
  running = true;
  setState('preparing');
  const s = settings.get();
  const dir = s.gameDir;
  try {
    const { manifest, java, versionId } = await prepare(dir);
    const server = serverFrom(manifest);

    progress('Logowanie...', 0);
    const authorization = await accounts.getLaunchAuth();

    const launcher = new Client();
    launcher.on('progress', (p) => progress(`Pobieranie: ${p.type}`, p.total ? p.task / p.total : 0));
    launcher.on('debug', (m) => log(String(m)));
    launcher.on('data', (m) => log(String(m)));
    launcher.on('close', (code) => {
      log(`Gra zamknięta (kod ${code}).`);
      running = false;
      setState('idle');
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
      quickPlay: { type: 'multiplayer', identifier: `${server.host}:${server.port}` },
      overrides: { detached: s.afterLaunch === 'close' },
    });
    if (!proc) throw new Error('Nie udało się uruchomić gry – zobacz log.');
    setState('running');

    if (s.afterLaunch === 'close') {
      proc.unref();
      setTimeout(() => app.quit(), 3000);
    } else if (s.afterLaunch === 'minimize') {
      win.minimize();
    }
  } catch (e) {
    running = false;
    setState('idle');
    send('error', e.message || String(e));
  }
}

/** Naprawa: usuwa Javę, NeoForge, biblioteki i pliki tymczasowe, potem przygotowuje wszystko od nowa. */
async function repair() {
  if (running || busy) throw new Error('Poczekaj, aż gra zostanie zamknięta.');
  busy = true;
  setState('busy');
  const dir = gameDir();
  try {
    log('Naprawa: usuwanie Javy, NeoForge i bibliotek (światy, ustawienia i zasoby zostają)...');
    for (const sub of ['runtime', 'versions', 'libraries', 'cache']) {
      await fs.promises.rm(path.join(dir, sub), { recursive: true, force: true });
    }
    const modsDir = path.join(dir, 'mods');
    if (fs.existsSync(modsDir)) {
      for (const f of fs.readdirSync(modsDir)) if (f.endsWith('.part')) fs.rmSync(path.join(modsDir, f), { force: true });
    }
    await prepare(dir);
    log('Naprawa zakończona – możesz grać.');
    progress('Naprawa zakończona', 1);
  } catch (e) {
    send('error', e.message || String(e));
    throw e;
  } finally {
    busy = false;
    setState('idle');
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
    setState('busy');
    try {
      progress('Przenoszenie plików gry...', 0);
      log(`Przenoszenie ${oldDir} → ${newDir} (może potrwać kilka minut)...`);
      await fs.promises.cp(oldDir, newDir, { recursive: true, errorOnExist: false });
      await fs.promises.rm(oldDir, { recursive: true, force: true });
      log('Pliki przeniesione.');
    } finally {
      busy = false;
      setState('idle');
    }
  } else {
    fs.mkdirSync(newDir, { recursive: true });
  }
  return settings.set({ gameDir: newDir });
}

// ---------- aktualizacje launchera ----------

function setUpdate(s) {
  updateState = s;
  send('update', s);
}

function initUpdater() {
  if (!app.isPackaged) { updateState = { state: 'dev' }; return; }
  if (isPortable()) {
    // wersja portable: własny mechanizm (pobranie obok pliku + podmiana po restarcie)
    const pkg = require('./package.json');
    const pub = pkg.build.publish[0];
    portableUpdater = new PortableUpdater({
      owner: pub.owner, repo: pub.repo, currentVersion: app.getVersion(),
      downloadsDir: app.getPath('downloads'), onState: setUpdate,
    });
    portableUpdater.check();
    setInterval(() => {
      if (!['ready', 'manual', 'downloading'].includes(updateState.state)) portableUpdater.check();
    }, 60 * 60 * 1000);
    return;
  }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => setUpdate({ state: 'checking' }));
  autoUpdater.on('update-not-available', () => setUpdate({ state: 'latest' }));
  autoUpdater.on('update-available', (i) => setUpdate({ state: 'downloading', version: i.version, percent: 0 }));
  autoUpdater.on('download-progress', (p) => setUpdate({ ...updateState, state: 'downloading', percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (i) => setUpdate({ state: 'ready', version: i.version }));
  autoUpdater.on('error', (e) => setUpdate({ state: 'error', error: String(e && e.message || e).split('\n')[0] }));
  autoUpdater.checkForUpdates().catch(() => {});
  setInterval(() => { if (updateState.state !== 'ready') autoUpdater.checkForUpdates().catch(() => {}); }, 60 * 60 * 1000);
}

// ---------- start ----------

app.whenReady().then(() => {
  const userData = app.getPath('userData');
  accounts = new AccountStore(path.join(userData, 'accounts.json'), config.microsoftClientId);
  settings = new SettingsStore(path.join(userData, 'settings.json'), {
    gameDir: path.join(app.getPath('appData'), config.gameDirName),
    maxRamGB: Math.min(gb(config.memory.max) || 6, SettingsStore.systemInfo().maxAllowedRamGB),
    minRamGB: gb(config.memory.min) || 2,
    width: 1280,
    height: 720,
    fullscreen: false,
    afterLaunch: 'minimize',
    jvmArgs: '',
    addons: {},
  });

  ipcMain.handle('app:get', () => ({ appName: config.appName, version: app.getVersion(), portable: isPortable(), info: publicInfo(cachedManifest()) }));
  ipcMain.handle('info:refresh', async () => {
    try { return publicInfo(await fetchManifest(gameDir(), true)); } catch { return publicInfo(cachedManifest()); }
  });
  ipcMain.handle('server:ping', async () => {
    const srv = serverFrom(cachedManifest());
    return { server: srv, ...(await pingServer(srv.host, srv.port)) };
  });

  ipcMain.handle('accounts:get', () => accounts.state());
  ipcMain.handle('accounts:addOffline', (_e, name) => accounts.addOffline(name));
  ipcMain.handle('accounts:addMicrosoft', () => accounts.addMicrosoft());
  ipcMain.handle('accounts:select', (_e, id) => accounts.select(id));
  ipcMain.handle('accounts:remove', (_e, id) => accounts.remove(id));

  // ---- skin (konta Microsoft) ----
  const skinState = async () => {
    const token = await accounts.getMinecraftToken();
    const p = await skin.getProfile(token);
    return {
      name: p.name,
      variant: p.skin ? p.skin.variant : 'classic',
      dataUrl: p.skin ? await skin.toDataUrl(p.skin.url) : null,
    };
  };
  ipcMain.handle('skin:get', () => skinState());
  ipcMain.handle('skin:pick', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: 'Wybierz plik skina (PNG 64×64)',
      filters: [{ name: 'Skin Minecraft', extensions: ['png'] }],
      properties: ['openFile'],
    });
    if (r.canceled) return null;
    const buf = fs.readFileSync(r.filePaths[0]);
    const size = skin.validateSkin(buf);
    return { path: r.filePaths[0], ...size, dataUrl: `data:image/png;base64,${buf.toString('base64')}` };
  });
  ipcMain.handle('skin:set', async (_e, file, variant) => {
    const buf = fs.readFileSync(file);
    await skin.uploadSkin(await accounts.getMinecraftToken(), buf, variant);
    log(`Ustawiono nowego skina (${variant === 'slim' ? 'model smukły' : 'model klasyczny'}).`);
    return skinState();
  });
  ipcMain.handle('skin:reset', async () => {
    await skin.resetSkin(await accounts.getMinecraftToken());
    log('Przywrócono domyślnego skina.');
    return skinState();
  });

  ipcMain.handle('game:play', () => play());
  ipcMain.handle('game:repair', () => repair());
  ipcMain.handle('game:openFolder', () => shell.openPath(gameDir()));
  ipcMain.handle('open:external', (_e, url) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
  });

  ipcMain.handle('settings:get', () => ({
    settings: settings.get(),
    system: SettingsStore.systemInfo(),
    defaultGameDir: path.join(app.getPath('appData'), config.gameDirName),
    optional: publicInfo(cachedManifest()).optional,
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

  ipcMain.handle('update:get', () => updateState);
  ipcMain.handle('update:check', () => {
    if (!app.isPackaged) return setUpdate({ state: 'dev' });
    if (portableUpdater) return portableUpdater.check();
    return autoUpdater.checkForUpdates().catch((e) => setUpdate({ state: 'error', error: e.message }));
  });
  ipcMain.handle('update:install', () => {
    if (running) throw new Error('Zamknij grę przed aktualizacją launchera.');
    if (updateState.state !== 'ready') return;
    if (portableUpdater) portableUpdater.install(() => app.quit());
    else autoUpdater.quitAndInstall(true, true);
  });
  ipcMain.handle('update:showFile', () => {
    if (updateState.state === 'manual' && updateState.file) shell.showItemInFolder(updateState.file);
  });

  win = new BrowserWindow({
    width: 980,
    height: 600,
    resizable: false,
    title: config.appName,
    icon: path.join(__dirname, 'renderer', 'logo.png'),
    backgroundColor: '#14161c',
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  initUpdater();
});

app.on('window-all-closed', () => app.quit());
