const { app, BrowserWindow, ipcMain, dialog, shell, clipboard, screen, Menu, nativeImage } = require('electron');
const pathMod = require('path');
// Dane launchera (konta, ustawienia, cache) zawsze w tym samym folderze – także gdy nazwa launchera
// zmieni się z panelu i nowa wersja zostanie zbudowana pod inną nazwą.
app.setPath('userData', pathMod.join(app.getPath('appData'), 'MelinaSMP Launcher'));
const { modIcon } = require('./src/jar');
const { queryFull } = require('./src/query');
const { DiscordPresence } = require('./src/discord-rpc');
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
const { PlayerMods, packModIds, packModInfo, packProjects, IRIS } = require('./src/player-mods');
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

let prefetchSkin = () => {};
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

// ---------- rozmiar interfejsu ----------

const ZOOM_STEPS = [0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];
let baseContentSize = [980, 600];

/** „Automatycznie”: większy interfejs na monitorach 1440p / 4K (z uwzględnieniem skalowania Windows). */
function autoZoom() {
  try {
    const d = win ? screen.getDisplayMatching(win.getBounds()) : screen.getPrimaryDisplay();
    const physical = d.size.height * d.scaleFactor;
    const desired = physical >= 2000 ? 1.75 : physical >= 1400 ? 1.25 : 1;
    return Math.max(1, Math.round((desired / d.scaleFactor) * 20) / 20);
  } catch { return 1; }
}

function currentZoom() {
  const z = settings.get().uiScale;
  return typeof z === 'number' ? z : autoZoom();
}

function applyZoom() {
  if (!win || win.isDestroyed()) return;
  let f = currentZoom();
  try {
    // nie większe niż ekran
    const area = screen.getDisplayMatching(win.getBounds()).workAreaSize;
    const fit = Math.min((area.width - 40) / baseContentSize[0], (area.height - 60) / baseContentSize[1]);
    if (f > fit) f = Math.max(0.8, Math.floor(fit * 20) / 20);
  } catch { /* zostaje f */ }
  win.webContents.setZoomFactor(f);
  const w = Math.round(baseContentSize[0] * f);
  const h = Math.round(baseContentSize[1] * f);
  win.setMinimumSize(Math.round(w * 0.85), Math.round(h * 0.85));
  if (win.isMaximized() || win.isFullScreen()) return; // zmaksymalizowane zostaje zmaksymalizowane
  // nowy rozmiar, ale okno zostaje tam, gdzie je postawiłeś (ten sam środek, w granicach ekranu)
  const b = win.getBounds();
  const area = screen.getDisplayMatching(b).workArea;
  let x = Math.round(b.x + b.width / 2 - w / 2);
  let y = Math.round(b.y + b.height / 2 - h / 2);
  x = Math.min(Math.max(x, area.x), area.x + area.width - w);
  y = Math.min(Math.max(y, area.y), area.y + area.height - h);
  win.setBounds({ x, y, width: w, height: h });
}

/** Informacja dla adminów (zakładka Gracze w panelu). */
/**
 * Ikona moda z pliku .jar jako data: URL (64 px), zapamiętana w <gameDir>/.melinasmp-icons/<sha1>.png.
 * Brak ikony zapamiętujemy pustym plikiem, żeby nie czytać jara za każdym razem.
 */
function jarIcon(dir, file, sha1) {
  const iconDir = path.join(dir, '.melinasmp-icons');
  const key = sha1 || file.replace(/[^\w.-]/g, '_');
  const cache = path.join(iconDir, `${key}.png`);
  try {
    const c = fs.readFileSync(cache);
    return c.length ? `data:image/png;base64,${c.toString('base64')}` : null;
  } catch { /* jeszcze nie ma */ }
  let png = null;
  try {
    const raw = modIcon(fs.readFileSync(path.join(dir, 'mods', file)));
    if (raw) {
      const img = nativeImage.createFromBuffer(raw);
      if (!img.isEmpty()) {
        const { width } = img.getSize();
        png = (width > 64 ? img.resize({ width: 64, quality: 'best' }) : img).toPNG();
      }
    }
  } catch { png = null; }
  try { fs.mkdirSync(iconDir, { recursive: true }); fs.writeFileSync(cache, png || Buffer.alloc(0)); } catch { /* bez znaczenia */ }
  return png ? `data:image/png;base64,${png.toString('base64')}` : null;
}

function hello(manifest, force) {
  try {
    const m = manifest || cachedManifest();
    const addons = m ? enabledAddons(m, settings.get().addons || {}).map((g) => g.id) : [];
    const mods = new PlayerMods(gameDir(), (m && m.blockedMods) || []).list().filter((x) => x.enabled && !x.blocked).slice(0, 50).map((x) => ({ name: x.name, source: x.source, kind: x.kind }));
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
    discord: discordLink(manifest),
    appearance: appearanceFrom(manifest),
    serverChangelog: serverChangelogFrom(manifest),
  };
}

/** Zmiany na serwerze (z panelu) – tylko tekst, od najnowszych. */
function serverChangelogFrom(manifest) {
  const list = manifest && Array.isArray(manifest.changelog) ? manifest.changelog : [];
  const str = (v, max) => String(v == null ? '' : v).slice(0, max);
  return list.slice(0, 200).filter((e) => e && typeof e === 'object').map((e) => ({
    title: str(e.title, 120),
    date: str(e.date, 40),
    items: Array.isArray(e.items) ? e.items.slice(0, 60).map((x) => str(x, 400)).filter(Boolean) : [],
    text: str(e.text, 4000),
  }));
}

/** Wygląd launchera z panelu: kolory, tło i układ ekranu Start (wszystko sprawdzone, nic „na słowo”). */
function appearanceFrom(manifest) {
  const a = manifest && manifest.appearance;
  if (!a || typeof a !== 'object') return null;
  const HEX = /^#[0-9a-f]{6}$/i;
  const c = a.colors || {};
  const colors = ['bg', 'card', 'accent', 'second'].every((k) => HEX.test(c[k] || '')) ? { bg: c.bg, card: c.card, accent: c.accent, second: c.second } : null;
  const b = a.background;
  const background = b && /^https:\/\//.test(b.url || '') && /^[0-9a-f]{40}$/i.test(b.sha1 || '')
    ? { url: b.url, sha1: b.sha1.toLowerCase(), dim: Math.min(90, Math.max(0, Number(b.dim) || 0)), blur: Math.min(20, Math.max(0, Number(b.blur) || 0)) }
    : null;
  const img = (x) => (x && /^https:\/\//.test(x.url || '') && /^[0-9a-f]{40}$/i.test(x.sha1 || '') ? { url: x.url, sha1: x.sha1.toLowerCase() } : null);
  const l = a.layout || {};
  const layout = {
    style: l.style === 'scene' ? 'scene' : 'tiles',
    discordCard: l.discordCard !== false,
    news: ['right', 'left', 'below', 'hidden'].includes(l.news) ? l.news : 'right',
    modsFirst: !!l.modsFirst,
    modsHidden: !!l.modsHidden,
    ...railFrom(l),
  };
  const name = typeof a.appName === 'string' ? a.appName.replace(/[^\p{L}\p{N} ._'!-]/gu, '').trim().slice(0, 40) : '';
  // przezroczystość kafelków (0–90%) i rozmycie tła za nimi – z panelu
  const t = a.tiles && typeof a.tiles === 'object' ? a.tiles : null;
  const tiles = t ? { opacity: Math.max(0, Math.min(90, Math.round(Number(t.opacity) || 0))), blur: !!t.blur } : null;
  return { colors, background, layout, icon: img(a.icon), appName: name || null, tiles };
}

/** Pasek boczny z panelu: kolejność górnych ikon i ikony ukryte (Start i Ustawienia zostają zawsze). */
const RAIL_TOP = ['players', 'news', 'addons', 'changelog', 'mymods'];
function railFrom(l) {
  const order = (Array.isArray(l.railOrder) ? l.railOrder : []).filter((k, i, arr) => RAIL_TOP.includes(k) && arr.indexOf(k) === i);
  for (const k of RAIL_TOP) if (!order.includes(k)) order.push(k);
  const hidden = (Array.isArray(l.railHidden) ? l.railHidden : []).filter((k, i, arr) => RAIL_TOP.includes(k) && arr.indexOf(k) === i);
  // Discord: kafelek na Start, ikona na pasku albo oba (dawniej: ukryta ikona / wyłączony kafelek)
  let discord = ['card', 'rail', 'both'].includes(l.discord) ? l.discord : null;
  if (!discord) discord = (l.railHidden || []).includes('discord') ? 'card' : l.discordCard === false ? 'rail' : 'card';
  return { railOrder: order, railHidden: hidden, discord };
}

/** Obrazek z panelu (ikona, obrazek newsa): pobierany raz do folderu launchera i sprawdzany sumą. Zwraca ścieżkę pliku. */
async function cachedImage(img) {
  if (!img || !/^https:\/\//.test(img.url || '') || !/^[0-9a-f]{40}$/i.test(img.sha1 || '')) return null;
  const dir = path.join(app.getPath('userData'), 'images');
  const ext = (img.url.match(/\.(jpe?g|png|webp)(?:$|\?)/i) || [, 'png'])[1].toLowerCase();
  const file = path.join(dir, `${img.sha1.toLowerCase()}.${ext}`);
  if (fs.existsSync(file)) return file;
  const res = await fetch(img.url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > 8 * 1024 * 1024) throw new Error('za duży obrazek');
  if (require('crypto').createHash('sha1').update(buf).digest('hex') !== img.sha1.toLowerCase()) throw new Error('obrazek nie zgadza się z sumą kontrolną');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, buf);
  return file;
}
const MIME = { png: 'image/png', webp: 'image/webp', jpg: 'image/jpeg', jpeg: 'image/jpeg' };
async function imageDataUrl(img) {
  const file = await cachedImage(img);
  if (!file) return null;
  return `data:${MIME[path.extname(file).slice(1)] || 'image/png'};base64,${fs.readFileSync(file).toString('base64')}`;
}

/** Ikona okna i paska zadań z panelu (ikona pliku .exe jest wbudowana przy budowaniu). */
async function applyWindowIcon(manifest) {
  if (!win || win.isDestroyed()) return;
  const a = appearanceFrom(manifest);
  win.setTitle((a && a.appName) || `${config.appName} Launcher`);
  try {
    if (a && a.icon) {
      const file = await cachedImage(a.icon);
      const icon = file ? nativeImage.createFromPath(file) : null;
      if (icon && !icon.isEmpty()) win.setIcon(icon);
    } else {
      const def = path.join(__dirname, 'renderer', 'app-icon.png');
      if (fs.existsSync(def)) win.setIcon(nativeImage.createFromPath(def));
    }
  } catch (e) { log(`Ikona launchera: ${e.message}`); }
}

/** Liczba osób na Discordzie z zaproszenia (publiczne API Discorda, bez klucza) – co najwyżej raz na 10 minut. */
let discordCounts = { at: 0, code: null, data: null };
async function discordInviteCounts(manifest) {
  const link = discordLink(manifest);
  const code = link && (link.match(/(?:discord\.gg|discord\.com\/invite)\/([\w-]+)/i) || [])[1];
  if (!code) return null;
  if (discordCounts.code === code && Date.now() - discordCounts.at < 10 * 60 * 1000) return discordCounts.data;
  try {
    const res = await fetch(`https://discord.com/api/v9/invites/${encodeURIComponent(code)}?with_counts=true`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = await res.json();
    const data = { members: j.approximate_member_count || null, online: j.approximate_presence_count || null, name: (j.guild && j.guild.name) || null };
    discordCounts = { at: Date.now(), code, data };
    return data;
  } catch { return discordCounts.code === code ? discordCounts.data : null; }
}

/** Tło z panelu: pobierane raz i trzymane w folderze launchera. Zwraca data: URL (albo null). */
async function backgroundImage(bg) {
  if (!bg || !bg.url || !bg.sha1) return null;
  const dir = path.join(app.getPath('userData'), 'backgrounds');
  const ext = (bg.url.match(/\.(jpe?g|png|webp)(?:$|\?)/i) || [, 'jpg'])[1].toLowerCase();
  const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
  const file = path.join(dir, `${bg.sha1}.${ext}`);
  let buf = null;
  try { buf = fs.readFileSync(file); } catch { /* jeszcze nie ma */ }
  if (!buf) {
    const res = await fetch(bg.url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 8 * 1024 * 1024) throw new Error('za duże tło');
    if (require('crypto').createHash('sha1').update(buf).digest('hex') !== bg.sha1) throw new Error('tło nie zgadza się z sumą kontrolną');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, buf);
    // stare tła usuwamy
    for (const f of fs.readdirSync(dir)) if (f !== path.basename(file)) { try { fs.unlinkSync(path.join(dir, f)); } catch { /* trudno */ } }
  }
  return `data:${mime};base64,${buf.toString('base64')}`;
}

// ---------- status na Discordzie (Rich Presence) ----------
let presence = null;
let gameStartedAt = null;
let presencePlayers = null;
let presenceTimer = null;

/** Application ID aplikacji Discord z panelu. */
function discordAppId(manifest) {
  const id = manifest && manifest.links && manifest.links.discordAppId;
  return /^\d{15,22}$/.test(String(id || '')) ? String(id) : null;
}

/** Ustawia status na Discordzie według tego, co się teraz dzieje (launcher / gra). */
function updatePresence() {
  if (!presence) presence = new DiscordPresence({ log });
  const s = settings.get();
  const m = cachedManifest();
  const appId = discordAppId(m);
  if (s.discordRpc === false || !appId) {
    presence.stop();
    clearInterval(presenceTimer);
    presenceTimer = null;
    return;
  }
  const srv = serverFrom(m);
  const name = srv.name || config.appName;
  const activity = {
    details: gameStartedAt ? `Gra na ${name}` : 'W launcherze',
    state: gameStartedAt
      ? (presencePlayers ? `${presencePlayers.online}/${presencePlayers.max} graczy online` : 'Na serwerze')
      : `Serwer ${name}`,
    assets: { large_image: (m.links && m.links.discordImage) || 'logo', large_text: name },
    instance: false,
  };
  if (gameStartedAt) activity.timestamps = { start: gameStartedAt };
  const invite = discordLink(m);
  if (s.discordRpcButton && invite) activity.buttons = [{ label: 'Dołącz do Discorda', url: invite }];
  presence.start(appId);
  presence.setActivity(activity);
  // w trakcie gry co minutę odświeżamy liczbę graczy
  if (gameStartedAt && !presenceTimer) {
    const tick = () => pingServer(srv.host, srv.port)
      .then((r) => { presencePlayers = r && r.online ? r.players : null; if (gameStartedAt) updatePresence(); })
      .catch(() => {});
    tick();
    presenceTimer = setInterval(tick, 60 * 1000);
  } else if (!gameStartedAt && presenceTimer) {
    clearInterval(presenceTimer);
    presenceTimer = null;
    presencePlayers = null;
  }
}
const safePresence = () => { try { updatePresence(); } catch (e) { log(`Status Discorda: ${e.message}`); } };

/** Zaproszenie na Discord z panelu (tylko linki discord.gg / discord.com). */
function discordLink(manifest) {
  const url = manifest && manifest.links && manifest.links.discord;
  return typeof url === 'string' && /^https:\/\/(www\.)?(discord\.gg|discord\.com\/invite)\/[\w-]+\/?$/i.test(url.trim()) ? url.trim() : null;
}

// ---------- gra ----------

/** Java + mody + silnik (vanilla/Fabric/NeoForge). Zwraca wszystko, czego trzeba do startu. */
// ---------- anulowanie przygotowania gry ----------
let cancelRequested = false;
function checkCancel() {
  if (!cancelRequested) return;
  const e = new Error('Anulowano.');
  e.cancelled = true;
  throw e;
}

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

  checkCancel();
  const java = await ensureJava(dir, log, progress, manifest.java);
  checkCancel();
  progress('Synchronizacja modów...', 0);
  const seedTodo = await syncModpack(manifest, dir, log, progress, settings.get().addons || {}, checkCancel);
  startSeedDownloads(seedTodo);
  checkCancel();

  const type = String((manifest.loader && manifest.loader.type) || 'vanilla').toLowerCase();
  progress(`Przygotowanie: ${LOADERS[type] || type}...`, 0);
  const loader = await ensureLoader(dir, manifest, java.java, log);
  checkCancel();
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
  cancelRequested = false;
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
      new PlayerMods(dir, manifest.blockedMods || []).install(packModIds(dir, manifest), !!opts.withoutMine, log);
    } catch (e) { log(`Moje mody: ${e.message}`); }

    checkCancel();
    progress('Logowanie...', 0);
    const authorization = await accounts.getLaunchAuth();
    // bilet na serwerze logowania (nick + IP) – dzięki niemu serwer gry wie, że to naprawdę Ty
    try {
      const t = await accounts.gameTicket();
      if (t) log(`Potwierdzono konto na serwerze logowania: ${t.nick}`);
    } catch (e) {
      if (/zaloguj się ponownie/i.test(e.message)) { send('accounts', accounts.state()); throw e; }
      log(`Uwaga: nie udało się potwierdzić konta na serwerze logowania (${e.message}). Jeśli serwer wymaga logowania, może Cię nie wpuścić.`);
    }

    const launcher = new Client();
    launcher.on('progress', (p) => progress(`Pobieranie: ${p.type}`, p.total ? p.task / p.total : 0));
    launcher.on('debug', (m) => log(String(m)));
    launcher.on('data', (m) => log(String(m)));
    launcher.on('close', (code) => {
      log(`Gra zamknięta (kod ${code}).`);
      running = false;
      gameStartedAt = null;
      safePresence();
      setState('idle');
      if (win && !win.isDestroyed()) win.restore();
    });

    const extraJvm = s.jvmArgs ? s.jvmArgs.split(/\s+/).filter(Boolean) : [];
    log(`RAM: ${s.minRamGB}–${s.maxRamGB} GB, okno: ${s.fullscreen ? 'pełny ekran' : `${s.width}×${s.height}`}`);

    checkCancel();
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
    });
    if (!proc) throw new Error('Nie udało się uruchomić gry – zobacz log.');
    if (cancelRequested) { try { proc.kill(); } catch { /* już zamknięta */ } checkCancel(); }
    setState('running');
    gameStartedAt = Date.now();
    safePresence();

    if (s.afterLaunch === 'minimize') {
      win.minimize();
    }
  } catch (e) {
    running = false;
    setState('idle');
    if (e && e.cancelled) { log('Uruchamianie anulowane.'); progress('Anulowano', 0); return; }
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
  Menu.setApplicationMenu(null);
  const userData = app.getPath('userData');
  accounts = new AccountStore(path.join(userData, 'accounts.json'), config.microsoftClientId, config.authUrl);
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
    discordRpc: true, // status na Discordzie – domyślnie włączony
    discordRpcButton: false, // przycisk z zaproszeniem pod statusem – domyślnie wyłączony
    uiAnim: true, // animacje przejść między stronami
    lang: 'pl', // język launchera (przycisk PL/EN w rogu)
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
    return { appName: config.appName, version: cur, portable: isPortable(), info: publicInfo(cachedManifest()), whatsNew, changelog: changelog(), uiAnim: settings.get().uiAnim !== false, lang: settings.get().lang === 'en' ? 'en' : 'pl' };
  });
  ipcMain.handle('changelog:get', () => changelog());
  ipcMain.handle('info:refresh', async () => {
    let info;
    try { info = publicInfo(await fetchManifest(gameDir(), true)); } catch { info = publicInfo(cachedManifest()); }
    safePresence(); // świeży manifest = może nowe Application ID / zaproszenie
    applyWindowIcon(cachedManifest());
    return info;
  });
  ipcMain.handle('server:ping', async () => {
    const srv = serverFrom(cachedManifest());
    return { server: srv, ...(await pingServer(srv.host, srv.port)) };
  });
  // Lista graczy: najpierw Query (pełna lista), a gdy serwer go nie ma – zwykły status (do ~12 nicków).
  let queryDeadUntil = 0;
  ipcMain.handle('server:players', async () => {
    const srv = serverFrom(cachedManifest());
    if (Date.now() > queryDeadUntil) {
      try {
        const q = await queryFull(srv.host, srv.port);
        return { online: true, full: true, players: { online: q.online, max: q.max, names: q.names } };
      } catch {
        queryDeadUntil = Date.now() + 10 * 60 * 1000; // nie męczymy co chwilę – spróbujemy za 10 minut
      }
    }
    const r = await pingServer(srv.host, srv.port);
    return { online: !!r.online, full: false, players: r.players || { online: 0, max: 0, names: [] }, error: r.error || null };
  });

  ipcMain.handle('accounts:get', () => accounts.state());
  ipcMain.handle('accounts:addOffline', (_e, name) => accounts.addOffline(name));
  ipcMain.handle('accounts:addMicrosoft', () => accounts.addMicrosoft());
  ipcMain.handle('accounts:select', (_e, id) => { const r = accounts.select(id); setTimeout(() => prefetchSkin(), 500); return r; });
  ipcMain.handle('accounts:remove', (_e, id) => accounts.remove(id));
  ipcMain.handle('accounts:logout', () => accounts.logout());
  ipcMain.handle('accounts:loginServer', (_e, nick, password, remember) => accounts.loginServer(nick, password, remember));
  ipcMain.handle('accounts:registerServer', (_e, nick, email, password, remember) => accounts.registerServer(nick, email, password, remember));
  ipcMain.handle('accounts:forgot', (_e, who) => accounts.forgotPassword(who));

  // ---- skin i peleryna ----
  // Premium: oficjalne API Minecrafta. Non-premium: MineSkin + komenda SkinRestorera do schowka.
  const activeAcc = () => accounts.state().active;
  const offlineSkinFile = (acc) => path.join(app.getPath('userData'), 'skins', `${acc.id.replace(/[^a-z0-9_-]/gi, '_')}.json`);
  const readOfflineSkin = (acc) => { try { return JSON.parse(fs.readFileSync(offlineSkinFile(acc), 'utf8')); } catch { return {}; } };

  // Ostatnio wczytany wygląd konta premium – okno skina pokazuje go od razu, a świeży dociąga w tle.
  const skinCacheFile = (acc) => path.join(app.getPath('userData'), 'skins', `cache-${acc.id.replace(/[^a-z0-9_-]/gi, '_')}.json`);
  // Jedno pobieranie naraz – okno skina korzysta z tego, które już trwa (np. z logowania w tle po starcie).
  let skinFetch = null;
  const skinState = (opts = {}) => {
    if (opts.cached) return skinStateRaw(opts);
    if (!skinFetch) skinFetch = skinStateRaw(opts).finally(() => { skinFetch = null; });
    return skinFetch;
  };
  prefetchSkin = () => {
    const acc = activeAcc();
    if (!acc || acc.type !== 'microsoft') return;
    const t0 = Date.now();
    skinState().then(() => log(`Konto premium zalogowane w tle, skin gotowy (${((Date.now() - t0) / 1000).toFixed(1)} s).`))
      .catch(() => { /* okno skina pokaże błąd, jeśli coś jest nie tak */ });
  };
  const skinStateRaw = async ({ cached = false } = {}) => {
    const acc = activeAcc();
    if (!acc) throw new Error('Najpierw dodaj konto.');
    if (acc.type !== 'microsoft') {
      const o = readOfflineSkin(acc);
      return { name: acc.name, offline: true, variant: o.variant || 'classic', dataUrl: o.dataUrl || null, capes: [], command: o.command || null };
    }
    if (cached) {
      try { return { ...JSON.parse(fs.readFileSync(skinCacheFile(acc), 'utf8')), cached: true }; } catch { return null; }
    }
    let p;
    try {
      p = await skin.getProfile(await accounts.getMinecraftToken());
    } catch {
      accounts.forgetSession(); // token mógł wygasnąć po stronie Mojang – logujemy się raz jeszcze
      p = await skin.getProfile(await accounts.getMinecraftToken());
    }
    // skin i wszystkie peleryny pobieramy naraz, nie po kolei
    const [skinUrl, ...capeUrls] = await Promise.all([
      p.skin ? skin.toDataUrl(p.skin.url).catch(() => null) : null,
      ...p.capes.map((c) => skin.toDataUrl(c.url).catch(() => null)),
    ]);
    const state = {
      name: p.name,
      offline: false,
      variant: p.skin ? p.skin.variant : 'classic',
      dataUrl: skinUrl,
      capes: p.capes.map((c, i) => ({ id: c.id, name: c.name, active: c.active, dataUrl: capeUrls[i] })).filter((c) => c.dataUrl),
      command: null,
    };
    try { fs.mkdirSync(path.dirname(skinCacheFile(acc)), { recursive: true }); fs.writeFileSync(skinCacheFile(acc), JSON.stringify(state)); } catch { /* bez znaczenia */ }
    return state;
  };
  ipcMain.handle('skin:get', (_e, opts) => skinState(opts || {}));
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
  ipcMain.handle('game:cancel', () => {
    if (!running || gameStartedAt) return false; // gra już działa – tego nie przerywamy
    cancelRequested = true;
    progress('Anulowanie… (kończę bieżący krok)', 0);
    return true;
  });

  // ---------- Moje mody ----------
  const pmTarget = () => {
    const m = cachedManifest();
    if (!m) throw new Error('Najpierw uruchom launcher z internetem, żeby pobrać informacje o paczce.');
    const loader = (m.loader && m.loader.type) || 'neoforge';
    if (loader === 'vanilla') throw new Error('Serwer działa bez modów (vanilla) – własnych modów nie da się dodać.');
    return { mc: m.minecraft, loader };
  };
  const blockedList = () => (cachedManifest() || {}).blockedMods || [];
  const pm = () => new PlayerMods(gameDir(), blockedList());
  ipcMain.handle('mymods:list', () => {
    const m = cachedManifest();
    return { list: pm().list(), mc: m && m.minecraft, loader: m && m.loader && m.loader.type };
  });
  // projekty Modrinth z paczki serwera (+ modId z plików) – w wyszukiwarce pokazujemy je jako „W paczce”
  ipcMain.handle('mymods:packIds', async () => {
    const m = cachedManifest();
    if (!m) return { projects: [], modIds: [] };
    const dir = gameDir();
    let modIds = [];
    try { modIds = [...packModIds(dir, m)]; } catch { /* pliki jeszcze niepobrane */ }
    return { projects: await packProjects(dir, m).catch(() => []), modIds };
  });
  ipcMain.handle('mymods:search', (_e, q, opts) => { const t = pmTarget(); return PlayerMods.search(String(q || ''), t.mc, t.loader, opts || {}, blockedList()); });
  // wszystkie zainstalowane mody: z paczki serwera (bez usuwania) + mody gracza
  ipcMain.handle('mymods:installed', () => {
    const m = cachedManifest();
    if (!m) return { pack: [], addons: [] };
    const dir = gameDir();
    const pack = packModInfo(dir, m).filter((x) => fs.existsSync(path.join(dir, 'mods', x.file)))
      .map((x) => ({ ...x, icon: jarIcon(dir, x.file, x.sha1) }));
    const addonMods = enabledAddons(m, settings.get().addons || {})
      .flatMap((g) => g.files.filter((f) => /^mods\/[^/]+\.jar$/i.test(f.path))
        .map((f) => ({ file: f.path.slice(5), addon: g.name, icon: jarIcon(dir, f.path.slice(5), f.sha1) })));
    return { pack, addons: addonMods };
  });
  ipcMain.handle('mymods:needIris', () => {
    const m = cachedManifest();
    return !!m && !pm().hasIris(packModIds(gameDir(), m));
  });
  ipcMain.handle('mymods:addModrinth', async (_e, id, kind) => {
    if (running) throw new Error('Zamknij grę, zanim zmienisz mody.');
    const t = pmTarget();
    const k = ['mod', 'shader', 'resourcepack'].includes(kind) ? kind : 'mod';
    const p = pm();
    p.packIds = new Set(await packProjects(gameDir(), cachedManifest()).catch(() => []));
    return p.addModrinth(k === 'mod' && id === 'iris' ? IRIS : String(id), t.mc, t.loader, k);
  });
  ipcMain.handle('mymods:addFile', async (_e, filePath) => {
    if (running) throw new Error('Zamknij grę, zanim zmienisz mody.');
    const t = pmTarget();
    let p = filePath;
    if (!p) {
      const r = await dialog.showOpenDialog(win, { title: 'Wybierz mod (.jar)', filters: [{ name: 'Mody, shadery, paczki tekstur', extensions: ['jar', 'zip'] }], properties: ['openFile', 'multiSelections'] });
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

  ipcMain.handle('appearance:image', async (_e, img) => {
    try { return await imageDataUrl(img); } catch (e) { log(`Nie udało się wczytać obrazka (${e.message}).`); return null; }
  });
  ipcMain.handle('discord:counts', () => discordInviteCounts(cachedManifest()));
  ipcMain.handle('appearance:background', async (_e, bg) => {
    try { return await backgroundImage(bg); } catch (e) { log(`Nie udało się wczytać tła launchera (${e.message}).`); return null; }
  });
  ipcMain.handle('win:minimize', () => win && win.minimize());
  ipcMain.handle('win:toggleMax', () => { if (!win) return; if (win.isMaximized()) win.unmaximize(); else win.maximize(); });
  ipcMain.handle('win:close', () => win && win.close());
  ipcMain.handle('settings:get', () => ({
    settings: settings.get(),
    system: SettingsStore.systemInfo(),
    defaultGameDir: path.join(app.getPath('appData'), config.gameDirName),
    optional: publicInfo(cachedManifest()).optional,
  }));
  ipcMain.handle('settings:set', (_e, input) => {
    const { gameDir: _ignored, ...rest } = input || {}; // folder zmienia się osobno
    const before = settings.get().uiScale;
    const out = settings.set(rest);
    if ('discordRpc' in rest || 'discordRpcButton' in rest) safePresence();
    // rozmiar okna ruszamy tylko, gdy zmienił się „Rozmiar interfejsu” (nie przy dodatkach i innych opcjach)
    if ('uiScale' in rest && String(before) !== String(out.uiScale)) applyZoom();
    return out;
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
    useContentSize: true,
    frame: false, // własny pasek górny w launcherze zamiast windowsowego
    resizable: true,
    maximizable: true,
    title: config.appName,
    icon: path.join(__dirname, 'renderer', 'logo.png'),
    backgroundColor: '#110f15',
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true },
  });
  win.removeMenu(); // bez menu „File / Edit / View” pod Altem
  baseContentSize = [980, 600];
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  let firstLoad = true;
  win.webContents.on('did-finish-load', () => {
    applyZoom();
    if (firstLoad) {
      firstLoad = false;
      if (!win.isMaximized()) win.center(); // na środek tylko przy starcie
      setTimeout(() => prefetchSkin(), 2500); // logowanie Microsoft w tle – okno skina będzie od razu gotowe
      applyWindowIcon(cachedManifest()); // ikona z panelu (z dysku, jeśli już pobrana)
    }
    send('winstate', { maximized: win.isMaximized() });
  });
  for (const ev of ['maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen']) {
    win.on(ev, () => send('winstate', { maximized: win.isMaximized() || win.isFullScreen() }));
  }
  // Ctrl + / Ctrl - / Ctrl 0 – rozmiar interfejsu (zapamiętywany)
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown' || !(input.control || input.meta) || input.alt) return;
    const k = input.key;
    if (!['+', '=', '-', '_', '0'].includes(k)) return;
    e.preventDefault();
    const cur = currentZoom();
    let next;
    if (k === '0') next = 'auto';
    else if (k === '-' || k === '_') next = ZOOM_STEPS.slice().reverse().find((z) => z < cur - 0.001) || ZOOM_STEPS[0];
    else next = ZOOM_STEPS.find((z) => z > cur + 0.001) || ZOOM_STEPS[ZOOM_STEPS.length - 1];
    settings.set({ uiScale: next });
    applyZoom();
    send('zoom', { uiScale: settings.get().uiScale, factor: currentZoom() });
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  initUpdater();
  setTimeout(() => hello(null, false), 5000);
});

app.on('before-quit', () => { if (presence) presence.stop(); });
app.on('window-all-closed', () => app.quit());
