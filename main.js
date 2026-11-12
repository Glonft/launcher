const { app, BrowserWindow, ipcMain, dialog, shell, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const { Client } = require('minecraft-launcher-core');
const { autoUpdater } = require('electron-updater');

const config = require('./config.json');
const { AccountStore } = require('./src/auth');
const { syncModpack } = require('./src/sync');
const { downloadInBackground } = require('./src/seed');
const { ensureServerEntry } = require('./src/servers-dat');
const { sendHello } = require('./src/stats');
const { PlayerMods, packModIds } = require('./src/player-mods');
const { enabledAddons } = require('./src/sync');
const { ensureJava } = require('./src/java');
const { ensureLoader, LOADERS } = require('./src/loaders');
const { SettingsStore, isEmptyDir, isInside } = require('./src/settings');
const { pingServer } = require('./src/ping');
const mineskin = require('./src/mineskin');
const { PortableUpdater, isPortable } = require('./src/portable-updater');
const skin = require('./src/skin');
const { readChangelog, entriesBetween } = require('./src/changelog');
const { newer } = require('./src/portable-updater');

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

/** Informacja dla adminów (zakładka Gracze w panelu). */
function hello(manifest, force) {
  try {
    const m = manifest || cachedManifest();
    const addons = m ? enabledAddons(m, settings.get().addons || {}).map((g) => g.id) : [];
    const mods = new PlayerMods(gameDir()).list().filter((x) => x.enabled).slice(0, 50).map((x) => ({ name: x.name, source: x.source }));
    sendHello(config.statsUrl, { account: accounts.state().active, version: app.getVersion(), addons, mods }, { force });
  } catch { /* bez znaczenia dla gracza */ }
}

/** Porównanie wersji x.y.z: <0, 0, >0. */
function cmpVersion(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
}

/** Wymagana nowsza wersja launchera (z manifestu) albo null. */
function requiredLauncher(manifest) {
  const min = manifest && manifest.minLauncher;
  return min && cmpVersion(app.getVersion(), min) < 0 ? min : null;
}

/** Informacje dla ekranu głównego: serwer, newsy, dodatki, ogłoszenie. */
function publicInfo(manifest) {
  return {
    announcement: (manifest && manifest.announcement) || null,
    requiredLauncher: requiredLauncher(manifest),
    server: serverFrom(manifest),
    news: (manifest && manifest.news) || [],
    optional: ((manifest && manifest.optional) || []).map((g) => ({
      id: g.id, name: g.name, description: g.description || '', default: !!g.default,
      size: g.files.reduce((n, f) => n + (Number(f.size) || 0), 0),
      replacesData: g.files.some((f) => f.seed),
    })),
    packVersion: manifest ? manifest.version : null,
  };
}

// ---------- gra ----------

/** Java + mody + silnik (vanilla/Fabric/NeoForge). Zwraca wszystko, czego trzeba do startu. */
async function prepare(dir) {
  progress('Sprawdzanie paczki...', 0);
  const manifest = await fetchManifest(dir);
  log(`Paczka: wersja ${manifest.version}`);
  send('info', publicInfo(manifest));
  hello(manifest, true);
  const need = requiredLauncher(manifest);
  if (need) {
    throw new Error(`Serwer wymaga launchera w wersji ${need} lub nowszej (masz ${app.getVersion()}). Zaktualizuj launcher – przycisk na górze okna albo strona serwera.`);
  }

  const java = await ensureJava(dir, log, progress, manifest.java);
  progress('Synchronizacja modów...', 0);
  const seedTodo = await syncModpack(manifest, dir, log, progress, settings.get().addons || {});
  startSeedDownloads(seedTodo);

  const type = String((manifest.loader && manifest.loader.type) || 'vanilla').toLowerCase();
  progress(`Przygotowanie: ${LOADERS[type] || type}...`, 0);
  const loader = await ensureLoader(dir, manifest, java.java, log);
  return { manifest, java, loader };
}

// ---------- duże pliki dodatków w tle (np. teren Distant Horizons) ----------

let seedJob = null;
function startSeedDownloads(todo) {
  if (seedJob || !todo.length) return;
  seedJob = downloadInBackground(todo, log, (st) => send('seed', st))
    .finally(() => {
      seedJob = null;
      if (quitWhenSeedDone) app.quit();
    });
}
let quitWhenSeedDone = false;

async function play(opts = {}) {
  if (running || busy) return;
  running = true;
  setState('preparing');
  const s = settings.get();
  const dir = s.gameDir;
  try {
    const { manifest, java, loader } = await prepare(dir);
    const server = serverFrom(manifest);
    try {
      if (ensureServerEntry(dir, server)) log(`Lista serwerów: ustawiono „${server.name}” (${server.host}:${server.port}).`);
    } catch (e) { log(`Lista serwerów: ${e.message}`); }
    try {
      new PlayerMods(dir).install(packModIds(dir, manifest), !!opts.withoutMine, log);
    } catch (e) { log(`Moje mody: ${e.message}`); }

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
      version: loader.versionId
        ? { number: manifest.minecraft, type: 'release', custom: loader.versionId }
        : { number: manifest.minecraft, type: 'release' },
      memory: { min: `${Math.round(s.minRamGB * 1024)}M`, max: `${Math.round(s.maxRamGB * 1024)}M` },
      window: s.fullscreen ? { fullscreen: true } : { width: s.width, height: s.height },
      customArgs: [...loader.jvmArgs, ...extraJvm],
      quickPlay: { type: 'multiplayer', identifier: `${server.host}:${server.port}` },
      overrides: { detached: s.afterLaunch === 'close' },
    });
    if (!proc) throw new Error('Nie udało się uruchomić gry – zobacz log.');
    setState('running');

    if (s.afterLaunch === 'close' && seedJob) {
      // nie zamykamy w trakcie pobierania w tle – launcher zamknie się sam po pobraniu
      proc.unref();
      log('Launcher zamknie się po pobraniu dodatku w tle.');
      quitWhenSeedDone = true;
      win.minimize();
    } else if (s.afterLaunch === 'close') {
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

/** Naprawa: usuwa Javę, silnik, biblioteki i pliki tymczasowe, potem przygotowuje wszystko od nowa. */
async function repair() {
  if (running || busy) throw new Error('Poczekaj, aż gra zostanie zamknięta.');
  busy = true;
  setState('busy');
  const dir = gameDir();
  try {
    log('Naprawa: usuwanie Javy, silnika i bibliotek (światy, ustawienia i zasoby zostają)...');
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

// Aktualizacje nie instalują się same: gracz klika „Zaktualizuj” albo „Później”.
// Wyjątek: minimalna wersja ustawiona przez admina w panelu (minLauncher) – wtedy aktualizacja jest wymagana.
let installWhenReady = false;

function forcedVersion() {
  return requiredLauncher(cachedManifest());
}

function setUpdate(s) {
  updateState = { ...s, forced: forcedVersion(), skipped: !!s.version && settings.get().skippedUpdate === s.version };
  send('update', updateState);
  if (updateState.state === 'ready' && installWhenReady && !running) {
    installWhenReady = false;
    setTimeout(() => installUpdate(), 800);
  }
}

function checkForUpdate() {
  if (!app.isPackaged) return setUpdate({ state: 'dev' });
  if (['downloading', 'ready', 'manual'].includes(updateState.state)) return updateState;
  if (portableUpdater) return portableUpdater.check();
  return autoUpdater.checkForUpdates().catch((e) => setUpdate({ state: 'error', error: String(e.message || e).split('\n')[0] }));
}

/** „Zaktualizuj”: pobiera i od razu instaluje (restart launchera). */
function startUpdate() {
  if (!app.isPackaged) return;
  if (updateState.state === 'ready') return installUpdate();
  if (updateState.state !== 'available') return;
  installWhenReady = true;
  setUpdate({ state: 'downloading', version: updateState.version, percent: 0 });
  if (portableUpdater) return portableUpdater.download();
  return autoUpdater.downloadUpdate().catch((e) => setUpdate({ state: 'error', error: String(e.message || e).split('\n')[0] }));
}

function installUpdate() {
  if (running) throw new Error('Zamknij grę przed aktualizacją launchera.');
  if (updateState.state !== 'ready') return;
  if (portableUpdater) portableUpdater.install(() => app.quit());
  else autoUpdater.quitAndInstall(true, true);
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
  } else {
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.on('checking-for-update', () => setUpdate({ state: 'checking' }));
    autoUpdater.on('update-not-available', () => setUpdate({ state: 'latest' }));
    autoUpdater.on('update-available', (i) => setUpdate({ state: 'available', version: i.version }));
    autoUpdater.on('download-progress', (p) => setUpdate({ ...updateState, state: 'downloading', percent: Math.round(p.percent) }));
    autoUpdater.on('update-downloaded', (i) => setUpdate({ state: 'ready', version: i.version }));
    autoUpdater.on('error', (e) => setUpdate({ state: 'error', error: String(e && e.message || e).split('\n')[0] }));
  }
  checkForUpdate();
  setInterval(checkForUpdate, 60 * 60 * 1000);
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

  const changelog = () => readChangelog(path.join(__dirname, 'CHANGELOG.md'));
  ipcMain.handle('app:get', () => {
    // „Co nowego”: pokaż zmiany od ostatnio widzianej wersji (raz po aktualizacji)
    const cur = app.getVersion();
    const seen = settings.get().lastSeenVersion;
    let whatsNew = [];
    if (seen) {
      if (newer(cur, seen)) whatsNew = entriesBetween(changelog(), seen, cur);
    } else if (accounts.state().list.length) {
      whatsNew = changelog().filter((e) => e.version === cur); // aktualizacja ze starszej wersji
    }
    if (seen !== cur) { try { settings.set({ lastSeenVersion: cur }); } catch { /* ignoruj */ } }
    return { appName: config.appName, version: cur, portable: isPortable(), info: publicInfo(cachedManifest()), whatsNew };
  });
  ipcMain.handle('changelog:get', () => changelog());
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

  // ---- skin i peleryna ----
  // Premium: oficjalne API Minecrafta. Non-premium: MineSkin + komenda SkinRestorera do schowka.
  const activeAcc = () => accounts.state().active;
  const offlineSkinFile = (acc) => path.join(app.getPath('userData'), 'skins', `${acc.id.replace(/[^a-z0-9_-]/gi, '_')}.json`);
  const readOfflineSkin = (acc) => { try { return JSON.parse(fs.readFileSync(offlineSkinFile(acc), 'utf8')); } catch { return {}; } };

  const skinState = async () => {
    const acc = activeAcc();
    if (!acc) throw new Error('Najpierw dodaj konto.');
    if (acc.type !== 'microsoft') {
      const o = readOfflineSkin(acc);
      return { name: acc.name, offline: true, variant: o.variant || 'classic', dataUrl: o.dataUrl || null, capes: [], command: o.command || null };
    }
    const token = await accounts.getMinecraftToken();
    const p = await skin.getProfile(token);
    const capes = [];
    for (const c of p.capes) {
      try { capes.push({ id: c.id, name: c.name, active: c.active, dataUrl: await skin.toDataUrl(c.url) }); }
      catch { /* pojedyncza peleryna się nie wczytała – pomijamy */ }
    }
    return {
      name: p.name,
      offline: false,
      variant: p.skin ? p.skin.variant : 'classic',
      dataUrl: p.skin ? await skin.toDataUrl(p.skin.url) : null,
      capes,
      command: null,
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
    const acc = activeAcc();
    if (!acc) throw new Error('Najpierw dodaj konto.');

    if (acc.type !== 'microsoft') {
      const prev = readOfflineSkin(acc);
      let buf;
      if (file) buf = fs.readFileSync(file);
      else if (prev.dataUrl) buf = Buffer.from(prev.dataUrl.split(',')[1], 'base64'); // tylko zmiana modelu
      else throw new Error('Najpierw wybierz plik skina.');
      skin.validateSkin(buf);
      const url = await mineskin.generateSkin(mineskin.mineskinKey(__dirname), buf, variant, `MelinaSMP ${acc.name}`);
      const command = mineskin.skinCommand(variant, url);
      const saved = { variant, url, command, dataUrl: `data:image/png;base64,${buf.toString('base64')}`, at: new Date().toISOString() };
      fs.mkdirSync(path.dirname(offlineSkinFile(acc)), { recursive: true });
      fs.writeFileSync(offlineSkinFile(acc), JSON.stringify(saved));
      clipboard.writeText(command);
      log(`Skin gotowy – komenda skopiowana do schowka: ${command}`);
      return skinState();
    }

    const token = await accounts.getMinecraftToken();
    let buf;
    if (file) {
      buf = fs.readFileSync(file);
    } else {
      // tylko zmiana modelu – wysyłamy ponownie obecny skin
      const p = await skin.getProfile(token);
      if (!p.skin) throw new Error('Najpierw wybierz plik skina.');
      const res = await fetch(p.skin.url);
      if (!res.ok) throw new Error(`Nie udało się pobrać obecnego skina (HTTP ${res.status})`);
      buf = Buffer.from(await res.arrayBuffer());
    }
    await skin.uploadSkin(token, buf, variant);
    log(`Ustawiono nowego skina (${variant === 'slim' ? 'model smukły' : 'model klasyczny'}).`);
    return skinState();
  });
  ipcMain.handle('skin:copyCommand', async () => {
    const st = await skinState();
    if (!st.command) throw new Error('Najpierw ustaw skina.');
    clipboard.writeText(st.command);
    return st.command;
  });
  ipcMain.handle('skin:setCape', async (_e, capeId) => {
    await skin.setCape(await accounts.getMinecraftToken(), capeId || null);
    log(capeId ? 'Założono pelerynę.' : 'Schowano pelerynę.');
    return skinState();
  });
  ipcMain.handle('skin:reset', async () => {
    const acc = activeAcc();
    if (acc && acc.type !== 'microsoft') {
      fs.rmSync(offlineSkinFile(acc), { force: true });
      clipboard.writeText('/skin clear');
      log('Przywracanie domyślnego skina – komenda /skin clear skopiowana do schowka.');
      return { ...(await skinState()), command: '/skin clear' };
    }
    await skin.resetSkin(await accounts.getMinecraftToken());
    log('Przywrócono domyślnego skina.');
    return skinState();
  });

  ipcMain.handle('game:play', (_e, opts) => play(opts || {}));

  // ---------- Moje mody ----------
  const pmTarget = () => {
    const m = cachedManifest();
    if (!m) throw new Error('Najpierw uruchom launcher z internetem, żeby pobrać informacje o paczce.');
    const loader = (m.loader && m.loader.type) || 'neoforge';
    if (loader === 'vanilla') throw new Error('Serwer działa bez modów (vanilla) – własnych modów nie da się dodać.');
    return { mc: m.minecraft, loader };
  };
  const pm = () => new PlayerMods(gameDir());
  ipcMain.handle('mymods:list', () => {
    const m = cachedManifest();
    return { list: pm().list(), mc: m && m.minecraft, loader: m && m.loader && m.loader.type };
  });
  ipcMain.handle('mymods:search', (_e, q, opts) => { const t = pmTarget(); return PlayerMods.search(String(q || ''), t.mc, t.loader, opts || {}); });
  ipcMain.handle('mymods:addModrinth', async (_e, id) => {
    if (running) throw new Error('Zamknij grę, zanim zmienisz mody.');
    const t = pmTarget();
    return pm().addModrinth(String(id), t.mc, t.loader);
  });
  ipcMain.handle('mymods:addFile', async (_e, filePath) => {
    if (running) throw new Error('Zamknij grę, zanim zmienisz mody.');
    const t = pmTarget();
    let p = filePath;
    if (!p) {
      const r = await dialog.showOpenDialog(win, { title: 'Wybierz mod (.jar)', filters: [{ name: 'Mody', extensions: ['jar'] }], properties: ['openFile', 'multiSelections'] });
      if (r.canceled) return [];
      return r.filePaths.map((f) => { try { return { ok: pm().addFile(f, t.loader).name }; } catch (e) { return { error: `${path.basename(f)}: ${e.message}` }; } });
    }
    return [(() => { try { return { ok: pm().addFile(p, t.loader).name }; } catch (e) { return { error: `${path.basename(p)}: ${e.message}` }; } })()];
  });
  ipcMain.handle('mymods:toggle', (_e, id, on) => pm().setEnabled(String(id), on));
  ipcMain.handle('mymods:remove', (_e, id) => {
    if (running) throw new Error('Zamknij grę, zanim zmienisz mody.');
    return pm().remove(String(id));
  });
  ipcMain.handle('mymods:updates', () => { const t = pmTarget(); return pm().checkUpdates(t.mc, t.loader); });
  ipcMain.handle('mymods:update', async (_e, u) => {
    if (running) throw new Error('Zamknij grę, zanim zmienisz mody.');
    return pm().applyUpdate(u);
  });
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

  ipcMain.handle('update:get', () => ({
    ...updateState,
    forced: forcedVersion(),
    skipped: !!updateState.version && settings.get().skippedUpdate === updateState.version,
  }));
  ipcMain.handle('update:check', () => {
    // ręczne sprawdzenie w ustawieniach „odkrywa” odłożoną wersję
    if (settings.get().skippedUpdate) settings.set({ skippedUpdate: null });
    return checkForUpdate();
  });
  ipcMain.handle('update:start', () => startUpdate());
  ipcMain.handle('update:later', () => {
    if (forcedVersion()) throw new Error('Ta aktualizacja jest wymagana przez serwer.');
    if (updateState.version) settings.set({ skippedUpdate: updateState.version });
    setUpdate({ ...updateState });
  });
  ipcMain.handle('update:install', () => installUpdate());
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
  setTimeout(() => hello(null, false), 5000);
});

app.on('window-all-closed', () => app.quit());
