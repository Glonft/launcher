const $ = (id) => document.getElementById(id);
const L = window.launcher;
const cleanErr = (e) => String((e && e.message) || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
const el = (tag, props = {}, ...children) => {
  const n = Object.assign(document.createElement(tag), props);
  for (const c of children) n.append(c);
  return n;
};
const headUrl = (name, size = 36) => `https://mc-heads.net/avatar/${encodeURIComponent(name)}/${size}`;

let appState = 'idle';
let accountsState = { active: null, list: [] };
let currentServer = null;

// ---------- log / postęp ----------
function addLog(msg) {
  const log = $('log');
  log.textContent += msg + '\n';
  if (log.textContent.length > 40000) log.textContent = log.textContent.slice(-30000);
  log.scrollTop = log.scrollHeight;
}
/** Log na ekranie Start – wysuwa się przed kafelki (Wydarzenia i Graj chowają się za nim). */
function setLog(show) {
  $('log-wrap').classList.toggle('hidden', !show);
  $('page-home').classList.toggle('log-open', show);
  $('btn-log').title = show ? 'Ukryj log' : 'Pokaż log';
  $('btn-log').classList.toggle('active', show);
  if (show) { const log = $('log'); log.scrollTop = log.scrollHeight; }
}
$('btn-log').onclick = (e) => { e.preventDefault(); setLog($('log-wrap').classList.contains('hidden')); };
$('btn-log-close').onclick = () => setLog(false);

// ---------- informacje z paczki (serwer, newsy) ----------
function showInfo(info) {
  if (!info) return;
  const srv = info.server;
  if (srv) {
    currentServer = srv;
    $('server-name').textContent = srv.name || 'Serwer';
  }
  if ('announcement' in info) {
    const a = info.announcement;
    const box = $('announcement');
    box.classList.toggle('hidden', !(a && a.text));
    box.classList.toggle('warn', !!(a && a.level === 'warn'));
    box.textContent = (a && a.text) || '';
  }
  if ('discord' in info) {
    discordLink = info.discord || null;
    $('btn-discord').href = discordLink || '#';
    applyDiscord();
  }
  if ('appearance' in info) applyAppearance(info.appearance);
  if (Array.isArray(info.serverChangelog)) { serverChangelog = info.serverChangelog; if (page === 'changelog') renderChangelog(); }
  if ('requiredLauncher' in info) {
    const box = $('launcher-outdated');
    box.classList.toggle('hidden', !info.requiredLauncher);
    box.textContent = info.requiredLauncher
      ? `Ten serwer wymaga launchera ${info.requiredLauncher} lub nowszego. Zaktualizuj launcher, żeby zagrać.`
      : '';
    if (info.requiredLauncher) L.getUpdate().then(showUpdate).catch(() => {});
  }
  if (info.server && info.server.name) { $('login-server').textContent = info.server.name; }
  if (!Array.isArray(info.news)) return;
  renderSceneNews(info.news);
  for (const id of ['news-list', 'news-full']) {
    const list = $(id);
    list.replaceChildren();
    if (!info.news.length) { list.append(el('p', { className: 'muted', textContent: 'Brak aktualności.' })); continue; }
    for (const n of info.news) {
      const item = el('div', { className: 'news-item' });
      if (n.date) item.append(el('span', { className: 'date', textContent: n.date }));
      if (id === 'news-full' && n.image) { const img = el('img', { className: 'news-img', alt: '' }); newsImage(n.image, img); item.append(img); }
      item.append(el('h4', { textContent: n.title || '' }), el('p', { textContent: n.body || '' }));
      item.dataset.key = `${n.date}|${n.title}`;
      list.append(item);
    }
  }
}

// bez przeciągania obrazków i tekstu z okna launchera (pliki .jar/.zip przeciąga się do niego, nie z niego)
document.addEventListener('dragstart', (e) => { if (!(e.target.closest && e.target.closest('input, textarea'))) e.preventDefault(); });
document.addEventListener('contextmenu', (e) => { if (!(e.target.closest && e.target.closest('input, textarea, #log'))) e.preventDefault(); });

// ---------- wygląd od serwera (kolory, tło, układ) ----------
let currentBg = null;
function applyAppearance(a) {
  if (a && a.appName) document.title = a.appName;
  const T = window.MelinaTheme;
  // kolory
  if (a && a.colors && T) T.apply(a.colors);
  else if (T) for (const k of Object.keys(T.vars({}))) document.documentElement.style.removeProperty(k);
  try { localStorage.setItem('melina.appearance', JSON.stringify({ colors: (a && a.colors) || null })); } catch { /* bez znaczenia */ }
  // układ ekranu Start: „Kafelki” albo „Scena”
  const l = (a && a.layout) || {};
  setHomeStyle(l.style === 'scene' ? 'scene' : 'tiles');
  const home = $('view-home');
  for (const c of ['news-left', 'news-below', 'news-hidden', 'mods-first', 'mods-hidden']) home.classList.remove(c);
  if (l.news && l.news !== 'right') home.classList.add(`news-${l.news}`);
  if (l.modsFirst) home.classList.add('mods-first');
  if (l.modsHidden) home.classList.add('mods-hidden');
  applyRail(l);
  // tło
  const bg = a && a.background;
  if (!bg) { currentBg = null; document.body.classList.remove('has-bg'); $('bg-layer').style.backgroundImage = ''; return; }
  $('bg-layer').style.filter = bg.blur ? `blur(${bg.blur}px)` : '';
  $('bg-dim').style.opacity = String((bg.dim || 0) / 100);
  if (currentBg === bg.sha1) return;
  currentBg = bg.sha1;
  L.backgroundImage(bg).then((url) => {
    if (currentBg !== bg.sha1) return;
    if (!url) { document.body.classList.remove('has-bg'); return; }
    $('bg-layer').style.backgroundImage = `url("${url}")`;
    document.body.classList.add('has-bg');
  }).catch(() => {});
}

// ---------- układ „Scena” ----------
const imageCache = new Map();
/** Obrazek z panelu (przez launcher – pobrany raz i sprawdzony) do <img>. */
function newsImage(img, target) {
  if (!img) return;
  if (!imageCache.has(img.sha1)) imageCache.set(img.sha1, L.image(img).catch(() => null));
  imageCache.get(img.sha1).then((url) => {
    if (!url) { target.remove(); return; }
    if (target.tagName === 'IMG') target.src = url; else target.style.backgroundImage = `url("${url}")`;
  });
}
/** Pasek boczny: kolejność górnych ikon i ukryte ikony (z panelu). Skin, Graj, Ustawienia i Wyloguj są zawsze. */
const RAIL_IDS = { players: 'btn-players', news: 'nav-news', addons: 'btn-addons', changelog: 'btn-changelog', mymods: 'btn-mymods' };
const RAIL_DEFAULT = ['players', 'news', 'addons', 'changelog', 'mymods'];
let discordLink = null;
let discordPlace = 'card'; // gdzie Discord: 'card' (kafelek na Start), 'rail' (ikona na pasku) albo 'both'
function applyRail(l) {
  const order = (Array.isArray(l.railOrder) ? l.railOrder : []).filter((k) => RAIL_IDS[k]);
  for (const k of RAIL_DEFAULT) if (!order.includes(k)) order.splice(RAIL_DEFAULT.indexOf(k), 0, k);
  const hidden = new Set(Array.isArray(l.railHidden) ? l.railHidden : []);
  const space = document.querySelector('.rail-space');
  for (const k of order) space.before($(RAIL_IDS[k]));
  for (const [k, id] of Object.entries(RAIL_IDS)) $(id).classList.toggle('rail-off', hidden.has(k));
  discordPlace = ['card', 'rail', 'both'].includes(l.discord) ? l.discord : 'card';
  applyDiscord();
}
/** Discord: ikona na pasku albo kafelek na ekranie Start (albo oba – jeśli tak ustawiono w panelu). */
let discordCountAsked = false;
function applyDiscord() {
  const on = !!discordLink;
  $('btn-discord').classList.toggle('hidden', !on || discordPlace === 'card');
  const card = on && discordPlace !== 'rail';
  $('scene-discord').classList.toggle('hidden', !card);
  if (!card) return;
  $('scene-discord').href = discordLink;
  if (discordCountAsked) return;
  discordCountAsked = true;
  L.discordCounts().then((c) => {
    $('scene-discord-count').textContent = c && c.members ? `Dołącz do ${c.members} osób na naszym Discordzie!` : 'Kliknij, żeby dołączyć!';
  }).catch(() => { $('scene-discord-count').textContent = 'Kliknij, żeby dołączyć!'; });
}

/** Strzałki aktualności tylko wtedy, gdy jest co przewijać (inaczej karty zajmują całą szerokość). */
function updateSceneArrows() {
  const wrap = $('scene-news-wrap');
  const t = $('scene-news-track');
  wrap.classList.remove('no-scroll');
  const scroll = t.scrollWidth > t.clientWidth + 2;
  wrap.classList.toggle('no-scroll', !scroll);
  if (!scroll) return;
  $('scene-prev').disabled = t.scrollLeft <= 2;
  $('scene-next').disabled = t.scrollLeft + t.clientWidth >= t.scrollWidth - 2;
}
new ResizeObserver(() => updateSceneArrows()).observe($('scene-news-wrap'));
$('scene-news-track').addEventListener('scroll', () => updateSceneArrows(), { passive: true });

function renderSceneNews(news) {
  const track = $('scene-news-track');
  track.replaceChildren(...news.slice(0, 10).map((n) => {
    const card = el('article', { className: `scene-news-card${n.image ? ' has-img' : ''}` },
      el('div', { className: 'scene-news-img' }),
      el('div', { className: 'scene-news-body' },
        n.date ? el('span', { className: 'date', textContent: n.date }) : '',
        el('h4', { textContent: n.title || '' }),
        el('p', { textContent: n.body || '' }),
        el('button', { className: 'scene-more', textContent: 'Czytaj więcej', onclick: () => openNewsItem(n) })));
    if (n.image) newsImage(n.image, card.querySelector('.scene-news-img'));
    return card;
  }));
  if (!news.length) track.append(el('p', { className: 'muted', textContent: 'Brak aktualności.' }));
  requestAnimationFrame(updateSceneArrows);
}
function openNewsItem(n) {
  go('news');
  const item = [...$('news-full').children].find((x) => x.dataset.key === `${n.date}|${n.title}`);
  if (item) { item.scrollIntoView({ block: 'start' }); item.classList.add('flash'); setTimeout(() => item.classList.remove('flash'), 1500); }
}
/** Układ ekranu Start: „Kafelki” albo „Scena” (przycisk Graj jest zawsze na dolnym pasku). */
function setHomeStyle(style) {
  homeStyle = style;
  $('view-home').classList.toggle('hidden', style === 'scene');
  $('view-scene').classList.toggle('hidden', style !== 'scene');
}

// ---------- przyciski okna (prawy górny róg) ----------
$('btn-lang').onclick = async () => {
  const next = I18N.get() === 'pl' ? 'en' : 'pl';
  I18N.set(next);
  try { await L.saveSettings({ lang: next }); } catch { /* zostanie do zamknięcia */ }
};
$('tb-min').onclick = () => L.winMinimize();
$('tb-max').onclick = () => L.winToggleMax();
$('tb-close').onclick = () => L.winClose();
L.on('winstate', (st) => {
  const max = !!(st && st.maximized);
  document.body.classList.toggle('maximized', max);
  $('tb-max').title = max ? 'Przywróć' : 'Maksymalizuj';
  $('tb-max-icon').innerHTML = max
    ? '<path d="M5 2v3H2M9 2v3h3M12 9H9v3M2 9h3v3"/>'
    : '<path d="M2 5V2h3M9 2h3v3M12 9v3H9M5 12H2V9"/>';
});

// ---------- status serwera ----------
const plGraczy = (n) => (n === 1 ? 'gracz' : (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)) ? 'gracze' : 'graczy');
async function refreshStatus() {
  const st = $('pb-status');
  const ping = $('pb-ping');
  try {
    const r = await L.pingServer();
    if (r.server) showInfo({ server: r.server, news: null });
    $('players-badge').textContent = r.online && r.players.online ? String(r.players.online) : '';
    st.classList.toggle('on', !!r.online);
    st.classList.toggle('off', !r.online);
    st.title = r.online ? `Online${r.version ? ' – ' + r.version : ''}` : (r.error || 'Offline');
    $('status-text').textContent = r.online ? 'Online' : 'Offline';
    $('players-count').textContent = r.online ? String(r.players.online) : '–';
    $('ping-ms').textContent = r.online ? `${r.latency} ms` : '–';
    // ikona zasięgu: im mniejszy ping, tym więcej kresek
    const bars = !r.online ? 0 : r.latency < 60 ? 4 : r.latency < 120 ? 3 : r.latency < 220 ? 2 : 1;
    ping.dataset.bars = String(bars);
  } catch {
    st.classList.remove('on'); st.classList.add('off');
    $('status-text').textContent = 'Offline';
    $('players-count').textContent = '–';
    $('ping-ms').textContent = '–';
    ping.dataset.bars = '0';
    $('players-badge').textContent = '';
  }
}
/** Przydzielona pamięć na dolnym pasku (z ustawień). */
async function refreshRam() {
  try {
    const { settings: s } = await L.getSettings();
    $('pb-ram').textContent = `${String(Number(s.maxRamGB)).replace('.', ',')} GB`;
  } catch { /* zostaje „–” */ }
}
$('btn-bar-repair').onclick = () => $('btn-repair').click();

// ---------- konta ----------
function renderAccounts(state) {
  accountsState = state;
  const a = state.active;
  updatePlayButton();
  if (!a) { openAddAccount(true); return; }
  closeAddAccount();
  $('rail-head').style.backgroundImage = `url("${headUrl(a.name)}")`;

  // lista w ustawieniach
  const box = $('accounts-list');
  box.replaceChildren();
  for (const acc of state.list) {
    const rm = el('button', { className: 'rm', textContent: 'Usuń', title: 'Usuń konto z launchera' });
    rm.onclick = async () => renderAccounts(await L.removeAccount(acc.id));
    const use = acc.id === a.id ? el('span', { className: 'acc-active', textContent: 'aktywne' })
      : el('button', { className: 'ghost-sm', textContent: 'Użyj', onclick: async () => renderAccounts(await L.selectAccount(acc.id)) });
    box.append(el('div', { className: 'acc-row' },
      el('span', { textContent: `${acc.name} – ${acc.type === 'microsoft' ? 'Microsoft' : 'non-premium'}` }), use, rm));
  }
}

/** Okno logowania: wymagane, gdy nikt nie jest zalogowany (po „Wyloguj” albo przy pierwszym uruchomieniu). */
function openAddAccount(required = false) {
  const ov = $('add-account');
  if (!ov.classList.contains('hidden') && ov.classList.contains('required') === required) return;
  for (const id of ['login-error', 'forgot-error', 'reg-error']) $(id).textContent = '';
  $('login-pass').value = '';
  ov.classList.toggle('required', required);
  ov.classList.remove('hidden');
  loginView('login', true);
}
/** Przełączanie widoków okna logowania (z krótkim przejściem). */
function loginView(v, instant = false) {
  const ids = { login: 'lv-login', forgot: 'lv-forgot', register: 'lv-register' };
  for (const [k, id] of Object.entries(ids)) {
    const f = $(id);
    const on = k === v;
    f.classList.toggle('hidden', !on);
    if (on && !instant) { f.classList.remove('lv-in'); void f.offsetWidth; f.classList.add('lv-in'); }
  }
  const focus = { login: $('nick').value ? 'login-pass' : 'nick', forgot: 'forgot-who', register: 'reg-nick' }[v];
  setTimeout(() => $(focus).focus(), 30);
}
$('go-forgot').onclick = (e) => { e.preventDefault(); $('forgot-who').value = $('nick').value; $('forgot-ok').classList.add('hidden'); $('forgot-error').textContent = ''; loginView('forgot'); };
$('go-register').onclick = (e) => { e.preventDefault(); $('reg-error').textContent = ''; loginView('register'); };
for (const id of ['go-login', 'forgot-back', 'forgot-back2', 'register-back']) $(id).onclick = (e) => { e.preventDefault(); $('login-error').textContent = ''; loginView('login'); };
// oko w polach hasła
for (const b of document.querySelectorAll('.pw .eye')) {
  b.onclick = () => {
    const inp = b.previousElementSibling;
    const show = inp.type === 'password';
    inp.type = show ? 'text' : 'password';
    b.classList.toggle('on', show);
    b.title = show ? 'Ukryj hasło' : 'Pokaż hasło';
    b.setAttribute('aria-label', b.title);
    inp.focus();
  };
}
/** Przycisk w trakcie zapytania: zablokowany i z kręciołkiem. */
async function busy(btn, fn) {
  if (btn.disabled) return;
  btn.disabled = true;
  btn.classList.add('loading');
  try { await fn(); } finally { btn.disabled = false; btn.classList.remove('loading'); }
}
$('lv-login').onsubmit = (e) => {
  e.preventDefault();
  const err = $('login-error');
  err.textContent = '';
  const nick = $('nick').value.trim();
  const pass = $('login-pass').value;
  if (!nick || !pass) { err.textContent = 'Uzupełnij wszystkie pola'; return; }
  busy($('btn-login'), async () => {
    try { renderAccounts(await L.loginServer(nick, pass, true)); $('login-pass').value = ''; } catch (x) { err.textContent = cleanErr(x); }
  });
};
$('lv-forgot').onsubmit = (e) => {
  e.preventDefault();
  const err = $('forgot-error');
  err.textContent = '';
  $('forgot-ok').classList.add('hidden');
  const who = $('forgot-who').value.trim();
  if (!who) { err.textContent = 'Uzupełnij wszystkie pola'; return; }
  busy($('btn-forgot'), async () => {
    try {
      const r = await L.forgotPassword(who);
      $('forgot-ok').textContent = (r && r.message) || 'Jeśli konto istnieje, wysłaliśmy link na podany adres';
      $('forgot-ok').classList.remove('hidden');
    } catch (x) { err.textContent = cleanErr(x); }
  });
};
$('lv-register').onsubmit = (e) => {
  e.preventDefault();
  const err = $('reg-error');
  err.textContent = '';
  const nick = $('reg-nick').value.trim();
  const email = $('reg-email').value.trim();
  const p1 = $('reg-pass').value;
  const p2 = $('reg-pass2').value;
  if (!nick || !email || !p1 || !p2) { err.textContent = 'Uzupełnij wszystkie pola'; return; }
  if (!/^[A-Za-z0-9_]{3,16}$/.test(nick)) { err.textContent = 'Nick: 3–16 znaków, tylko litery, cyfry i _'; return; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { err.textContent = 'Niepoprawny adres e-mail'; return; }
  if (p1.length < 8) { err.textContent = 'Hasło musi mieć co najmniej 8 znaków'; return; }
  if (p1 !== p2) { err.textContent = 'Hasła nie są takie same'; return; }
  busy($('btn-register'), async () => {
    try {
      renderAccounts(await L.registerServer(nick, email, p1, true));
      for (const id of ['reg-pass', 'reg-pass2']) $(id).value = '';
    } catch (x) { err.textContent = cleanErr(x); }
  });
};
$('btn-add-account').onclick = () => openAddAccount(false);
const closeAddAccount = () => { $('add-account').classList.add('hidden'); $('add-account').classList.remove('required'); };
$('btn-logout').onclick = async () => {
  if (appState !== 'idle') return;
  renderAccounts(await L.logout());
};
L.on('accounts', (st) => renderAccounts(st));
$('btn-ms').onclick = () => busy($('btn-ms'), async () => {
  $('login-error').textContent = '';
  try { renderAccounts(await L.addMicrosoft()); } catch (e) { $('login-error').textContent = 'Logowanie nieudane: ' + cleanErr(e); }
});

// ---------- skin i peleryna ----------
function showCommand(cmd, justSaved) {
  const box = $('skin-cmd');
  if (!cmd) { box.classList.add('hidden'); return; }
  box.classList.remove('hidden');
  $('skin-cmd-text').textContent = cmd;
  const info = $('skin-cmd-info');
  info.replaceChildren();
  info.append(justSaved ? '✔ Skin gotowy, komenda jest już w schowku. W grze na serwerze:' : 'Ostatnia komenda skina. Żeby ustawić go na serwerze:');
  info.append(el('ol', {}, el('li', { textContent: 'naciśnij T (czat)' }), el('li', { textContent: 'Ctrl+V' }), el('li', { textContent: 'Enter' })));
}

let skinData = null;   // stan z serwera
let pickedSkin = null; // nowy plik (jeszcze niezapisany)
let pickedCape;        // undefined = bez zmian, null = bez peleryny, id = peleryna
let preview = null;

const variant = () => document.querySelector('input[name=variant]:checked').value;
function setVariant(v) { document.querySelector(`input[name=variant][value=${v}]`).checked = true; }
const currentCapeId = () => { const c = skinData && skinData.capes.find((x) => x.active); return c ? c.id : null; };
const effectiveCapeId = () => (pickedCape === undefined ? currentCapeId() : pickedCape);

function hasChanges() {
  if (!skinData) return false;
  return !!pickedSkin || variant() !== skinData.variant || effectiveCapeId() !== currentCapeId();
}

function refreshPreview() {
  if (!preview || !skinData) return;
  const capeId = effectiveCapeId();
  const cape = capeId && skinData.capes.find((c) => c.id === capeId);
  preview.show(pickedSkin ? pickedSkin.dataUrl : skinData.dataUrl, variant() === 'slim', cape ? cape.dataUrl : null);
  $('btn-skin-save').disabled = !hasChanges();
  for (const t of document.querySelectorAll('.cape')) t.classList.toggle('selected', (t.dataset.id || null) === (capeId || null));
}

function renderCapes() {
  const box = $('capes');
  box.replaceChildren();
  $('capes-section').classList.toggle('hidden', !!skinData.offline);
  if (skinData.offline) return;
  if (!skinData.capes.length) {
    box.append(el('p', { className: 'hint', textContent: 'To konto nie ma żadnej oficjalnej peleryny.' }));
    return;
  }
  const tile = (id, label, dataUrl) => {
    const t = el('div', { className: 'cape', title: label });
    if (id) t.dataset.id = id;
    if ((id || null) === currentCapeId()) t.classList.add('current');
    if (dataUrl) { const c = el('canvas', { width: 10, height: 16 }); drawCapeThumb(c, dataUrl); t.append(c); }
    else t.append(el('div', { className: 'none', textContent: '✕' }));
    t.append(label);
    t.onclick = () => { pickedCape = id || null; refreshPreview(); };
    return t;
  };
  box.append(tile(null, 'Bez peleryny'));
  for (const c of skinData.capes) box.append(tile(c.id, c.name, c.dataUrl));
}

function applySkinData(data) {
  skinData = data;
  $('skin-name').textContent = data.name;
  preview.setName && preview.setName(data.name);
  setVariant(data.variant);
  renderCapes();
  refreshPreview();
  $('skin-hint').textContent = data.offline
    ? 'Konto non-premium: skin zobaczą wszyscy na serwerze MelinaSMP. Po kliknięciu „Zapisz zmiany” wkleisz w grze jedną komendę. Peleryny są dostępne tylko dla kont premium.'
    : 'Zmiany dotyczą całego Twojego konta Minecraft (tak jak w oficjalnym launcherze). Na serwerze zobaczysz je po ponownym wejściu.';
  $('btn-skin-reset').textContent = data.offline ? 'Przywróć domyślnego skina (komenda)' : 'Przywróć domyślnego skina';
  showCommand(data.offline ? data.command : null);
}
function ensurePreview() {
  if (preview) return;
  preview = new SkinPreview($('skin-viewer'));
  if (!preview.is3d) $('viewer-hint').textContent = 'Podgląd 2D (3D niedostępne)';
}
let skinSeq = 0;
async function openSkin() {
  if (skinData && (pickedSkin !== null || pickedCape !== undefined)) return; // wrócono na stronę z niezapisanymi zmianami
  const seq = ++skinSeq;
  pickedSkin = null;
  pickedCape = undefined;
  skinData = null;
  $('skin-error').textContent = '';
  $('skin-file').textContent = '';
  $('skin-status').textContent = 'Wczytywanie…';
  $('btn-skin-save').disabled = true;
  $('capes').replaceChildren();
  $('skin-name').textContent = accountsState.active ? accountsState.active.name : '';
  ensurePreview();
  try {
    // 1) od razu ostatnio znany wygląd (konta premium), 2) świeży z serwerów Mojang w tle
    const cached = await L.getSkin({ cached: true }).catch(() => null);
    if (seq !== skinSeq) return;
    if (cached) {
      applySkinData(cached);
      if (!cached.cached) { $('skin-status').textContent = ''; return; } // konto non-premium – to już jest aktualne
      $('skin-status').textContent = 'Sprawdzam, czy coś się zmieniło…';
    }
    const fresh = await L.getSkin();
    if (seq !== skinSeq || page !== 'skin') return;
    // nie nadpisujemy, jeśli w międzyczasie wybrałeś inny skin albo pelerynę
    if (!cached || (pickedSkin === null && pickedCape === undefined)) applySkinData(fresh);
    $('skin-status').textContent = '';
  } catch (e) {
    $('skin-status').textContent = '';
    if (!skinData) $('skin-error').textContent = cleanErr(e);
  }
}
$('btn-skin-copy').onclick = async () => {
  try { await L.copySkinCommand(); $('btn-skin-copy').textContent = '✔ Skopiowano'; setTimeout(() => { $('btn-skin-copy').textContent = '📋 Kopiuj komendę'; }, 1500); }
  catch (e) { $('skin-error').textContent = cleanErr(e); }
};

$('btn-skin-pick').onclick = async () => {
  $('skin-error').textContent = '';
  try {
    const f = await L.pickSkin();
    if (!f) return;
    pickedSkin = f;
    $('skin-file').textContent = `nowy plik (${f.width}×${f.height}) – niezapisany`;
    refreshPreview();
  } catch (e) { $('skin-error').textContent = cleanErr(e); }
};
for (const r of document.querySelectorAll('input[name=variant]')) r.onchange = refreshPreview;

$('btn-skin-save').onclick = async () => {
  $('skin-error').textContent = '';
  $('btn-skin-save').disabled = true;
  // zapamiętaj, co zmienić, zanim odświeżymy stan z serwera
  const capeChanged = pickedCape !== undefined && pickedCape !== currentCapeId();
  const wantCape = pickedCape;
  try {
    if (pickedSkin || variant() !== skinData.variant) {
      $('skin-status').textContent = skinData.offline ? 'Przygotowywanie skina (MineSkin)… to może potrwać kilkanaście sekund' : 'Zapisywanie skina…';
      // zmiana samego modelu wymaga ponownego wysłania obecnego skina
      skinData = pickedSkin ? await L.setSkin(pickedSkin.path, variant()) : await L.setSkin(null, variant());
    }
    if (capeChanged) {
      $('skin-status').textContent = 'Zapisywanie peleryny…';
      skinData = await L.setCape(wantCape);
    }
    pickedSkin = null;
    pickedCape = undefined;
    $('skin-file').textContent = '';
    setVariant(skinData.variant);
    renderCapes();
    refreshPreview();
    if (skinData.offline) {
      $('skin-status').textContent = '';
      showCommand(skinData.command, true);
    } else {
      $('skin-status').textContent = '✔ Zapisano! Wejdź ponownie na serwer, żeby zobaczyć zmiany w grze.';
      showCommand(null);
    }
  } catch (e) {
    $('skin-status').textContent = '';
    $('skin-error').textContent = cleanErr(e);
    $('btn-skin-save').disabled = !hasChanges();
  }
};
$('btn-skin-reset').onclick = async (e) => {
  e.preventDefault();
  if (!confirm('Przywrócić domyślnego skina (Steve/Alex)?')) return;
  $('skin-error').textContent = '';
  try {
    const r = await L.resetSkin();
    skinData = r;
    pickedSkin = null;
    $('skin-file').textContent = '';
    setVariant(skinData.variant);
    refreshPreview();
    if (skinData.offline) { $('skin-status').textContent = ''; showCommand(r.command, true); }
    else $('skin-status').textContent = '✔ Przywrócono domyślnego skina.';
  } catch (err) { $('skin-error').textContent = cleanErr(err); }
};

// ---------- granie ----------
function updatePlayButton() {
  const b = $('btn-play');
  const labels = { idle: 'Uruchom grę', preparing: 'Anuluj', running: 'Gra uruchomiona', busy: 'Proszę czekać…' };
  $('play-label').textContent = labels[appState] || 'Uruchom grę';
  b.classList.toggle('cancel', appState === 'preparing');
  b.disabled = !(appState === 'preparing' || (appState === 'idle' && accountsState.active));
  $('btn-repair').disabled = appState !== 'idle';
  $('btn-bar-repair').disabled = appState !== 'idle';
}
$('btn-play').onclick = () => {
  if (appState === 'preparing') { L.cancelPlay(); $('btn-play').disabled = true; return; } // „Anuluj”
  appState = 'preparing'; updatePlayButton(); L.play();
};

L.on('log', addLog);
L.on('info', showInfo);
L.on('progress', ({ label, value }) => {
  $('progress-label').textContent = label;
  $('bar-fill').style.width = `${Math.round((value || 0) * 100)}%`;
});
L.on('state', (s) => {
  appState = s;
  updatePlayButton();
  $('page-home').classList.toggle('busy', s !== 'idle');
  if (s === 'idle') { $('progress-label').textContent = 'Gotowy'; $('bar-fill').style.width = '0'; refreshStatus(); }
});
L.on('error', (msg) => {
  addLog('BŁĄD: ' + msg);
  $('progress-label').textContent = 'Błąd: ' + msg;
  setLog(true);
});

// ---------- aktualizacje launchera ----------
function showUpdate(u) {
  const bar = $('update-bar');
  const txt = $('update-text');
  const show = (id, on) => $(id).classList.toggle('hidden', !on);
  ['btn-update-start', 'btn-update-later', 'btn-update-install', 'btn-update-show'].forEach((id) => show(id, false));
  bar.classList.remove('hidden');
  bar.classList.toggle('forced', !!u.forced);
  switch (u.state) {
    case 'available':
      if (u.skipped && !u.forced) { bar.classList.add('hidden'); break; }
      txt.textContent = u.forced ? `Wymagana aktualizacja do wersji ${u.version}` : `Dostępna nowa wersja ${u.version}`;
      show('btn-update-start', true);
      show('btn-update-later', !u.forced);
      break;
    case 'downloading': txt.textContent = `Pobieranie aktualizacji ${u.version || ''}… ${u.percent || 0}%`; break;
    case 'ready': txt.textContent = `Wersja ${u.version} gotowa`; show('btn-update-install', true); break;
    case 'manual': txt.textContent = `Wersja ${u.version} pobrana do folderu Pobrane`; show('btn-update-show', true); break;
    default: bar.classList.add('hidden');
  }
  const info = {
    checking: 'Sprawdzanie aktualizacji…', latest: 'Masz najnowszą wersję launchera.',
    available: u.skipped && !u.forced ? `Dostępna wersja ${u.version} (odłożona – kliknij „Sprawdź aktualizacje”, żeby ją pokazać)` : `Dostępna wersja ${u.version}`,
    downloading: `Pobieranie wersji ${u.version || ''}…`, ready: `Wersja ${u.version} pobrana – kliknij „Uruchom ponownie i zaktualizuj” na górze.`,
    manual: `Wersja ${u.version} pobrana do folderu Pobrane – ten folder nie pozwala na automatyczną podmianę, uruchom nowy plik ręcznie.`,
    error: `Błąd aktualizacji: ${u.error || ''}`, dev: 'Tryb deweloperski – aktualizacje wyłączone.',
  }[u.state];
  if (info) $('version-info').dataset.update = info;
  renderVersionInfo();
}
function renderVersionInfo() {
  const v = $('version-info');
  v.textContent = `Launcher v${v.dataset.version || '?'}${v.dataset.portable ? ' (portable)' : ''}${v.dataset.update ? ' · ' + v.dataset.update : ''}`;
}
L.on('update', showUpdate);
L.on('seed', (st) => {
  const box = $('seed-status');
  box.classList.toggle('hidden', !st);
  if (st) box.textContent = `W tle: ${st.name} – ${st.total ? Math.floor((st.done / st.total) * 100) : 0}% (${fmtBytes(st.done)}${st.total ? ` z ${fmtBytes(st.total)}` : ''})`;
  $('addons-seed').classList.toggle('hidden', !st);
  $('addons-dot').classList.toggle('hidden', !st);
  if (st) $('addons-seed').textContent = `Pobieranie w tle: ${st.name} – ${st.total ? Math.floor((st.done / st.total) * 100) : 0}% (${fmtBytes(st.done)}${st.total ? ` z ${fmtBytes(st.total)}` : ''}). Możesz w tym czasie grać.`;
});
$('btn-update-start').onclick = async () => {
  try { await L.startUpdate(); } catch (e) { addLog('BŁĄD: ' + cleanErr(e)); }
};
$('btn-update-later').onclick = async () => {
  try { await L.laterUpdate(); } catch (e) { addLog('BŁĄD: ' + cleanErr(e)); }
};
$('btn-update-install').onclick = async () => {
  try { await L.installUpdate(); } catch (e) { addLog('BŁĄD: ' + cleanErr(e)); }
};
$('btn-check-update').onclick = () => L.checkUpdate();
$('btn-update-show').onclick = () => L.showUpdateFile();

// ---------- ustawienia ----------
let pendingDir = null;

function updateRamLabels() {
  const max = Number($('ram-max').value);
  $('ram-max-val').textContent = `${max} GB`;
}

function fmtBytes(n) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1).replace('.', ',')} GB`;
  if (n >= 1e6) return `${Math.round(n / 1e6)} MB`;
  return `${Math.max(1, Math.round(n / 1e3))} KB`;
}

// ---------- dodatki (osobne okno z paska bocznego) ----------
function renderAddons(optional, choices) {
  const box = $('addons-list');
  box.replaceChildren();
  if (!optional.length) {
    box.append(el('p', { className: 'hint', textContent: 'Paczka nie ma jeszcze dodatków do wyboru.' }));
    return;
  }
  for (const g of optional) {
    const on = g.id in choices ? !!choices[g.id] : g.default;
    const sw = el('input', { type: 'checkbox', className: 'switch', checked: on });
    const info = el('div', { className: 'addon-info' },
      el('div', { className: 'addon-name' }, g.name, g.size ? el('span', { className: 'mm-tag', textContent: fmtBytes(g.size) }) : ''),
      el('div', { className: 'desc', textContent: g.description || '' }));
    if (g.replacesData) {
      info.append(el('div', { className: 'desc warn-text', textContent:
        'Zastąpi Twoje obecne dane tego dodatku (kopia zostanie zachowana jako plik .kopia). Pobiera się w tle – możesz grać w trakcie.' }));
    }
    sw.onchange = async () => {
      $('addons-error').textContent = '';
      sw.disabled = true;
      try {
        const { settings: cur } = await L.getSettings();
        await L.saveSettings({ addons: { ...(cur.addons || {}), [g.id]: sw.checked } });
        installedCache = null;
      } catch (e) { sw.checked = !sw.checked; $('addons-error').textContent = cleanErr(e); }
      finally { sw.disabled = false; }
    };
    box.append(el('label', { className: `addon-card${on ? ' on' : ''}` }, info, sw));
    sw.addEventListener('change', () => sw.closest('.addon-card').classList.toggle('on', sw.checked));
  }
}
async function openAddons() {
  $('addons-error').textContent = '';
  const { settings: s, optional } = await L.getSettings();
  renderAddons(optional, s.addons || {});
}

// ---------- gracze online ----------
let playersTimer = null;
let lastPlayers = null;
function playerCard(name) {
  const img = el('img', { src: headUrl(name, 96), alt: '' });
  img.onload = () => img.classList.add('loaded');
  img.onerror = () => { img.replaceWith(el('div', { className: 'player-noface' })); };
  if (img.complete && img.naturalWidth) img.classList.add('loaded');
  return el('div', { className: 'player-card' }, img, el('span', { textContent: name }));
}
async function loadPlayers() {
  const box = $('players-full');
  try {
    const r = await L.getPlayers();
    if (lastPlayers && JSON.stringify(lastPlayers) === JSON.stringify(r)) return; // nic się nie zmieniło – nic nie przerysowujemy
    lastPlayers = r;
    if (!r.online) {
      box.replaceChildren(el('p', { className: 'hint', textContent: `Serwer jest offline${r.error ? ` (${r.error})` : ''}.` }));
      $('players-note').textContent = '';
      return;
    }
    const p = r.players;
    $('players-badge').textContent = p.online ? String(p.online) : '';
    if (!p.online) {
      box.replaceChildren(el('p', { className: 'hint', textContent: 'Nikogo nie ma – bądź pierwszy!' }));
    } else {
      const names = [...p.names].sort((a, b) => a.localeCompare(b, 'pl', { sensitivity: 'base' }));
      box.replaceChildren(...names.map(playerCard));
      const hidden = p.online - p.names.length;
      if (hidden > 0) box.append(el('div', { className: 'player-card more', textContent: `i ${hidden} ${hidden === 1 ? 'inny' : 'innych'}` }));
    }
    $('players-note').textContent = '';
  } catch (e) {
    box.replaceChildren(el('p', { className: 'error', textContent: cleanErr(e) }));
  }
}
async function openPlayers() {
  // od razu ostatnia znana lista (bez migających zarysów), świeża podmienia się po cichu
  if (!lastPlayers) {
    $('players-full').replaceChildren(el('p', { className: 'hint', textContent: 'Wczytuję listę graczy…' }));
  }
  await loadPlayers();
  clearInterval(playersTimer);
  playersTimer = setInterval(loadPlayers, 30 * 1000);
}
function closePlayers() {
  clearInterval(playersTimer);
}

async function openSettings() {
  if (settingsSnapshot && JSON.stringify(collectSettings()) !== settingsSnapshot) return; // niezapisane zmiany zostają
  const { settings: s, system } = await L.getSettings();
  $('ram-max').max = system.maxAllowedRamGB;
  $('ram-max').value = s.maxRamGB;
  $('ram-hint').textContent = `Twój komputer ma ${system.totalRamGB} GB RAM.`;
  updateRamLabels();
  $('win-w').value = s.width;
  $('win-h').value = s.height;
  setDisplayMode(!!s.fullscreen);
  $('ui-anim').checked = s.uiAnim !== false;
  $('after-launch').value = s.afterLaunch;
  $('ui-scale').value = s.uiScale === 'auto' || s.uiScale == null ? 'auto' : String(s.uiScale);
  if (!$('ui-scale').value) $('ui-scale').value = 'auto';
  $('game-dir').value = s.gameDir;
  $('jvm-args').value = s.jvmArgs;
  $('discord-rpc').checked = s.discordRpc !== false;
  $('discord-rpc-button').checked = !!s.discordRpcButton;
  $('discord-rpc-button').disabled = !$('discord-rpc').checked;
  renderAccounts(await L.getAccounts());
  $('settings-error').textContent = '';
  hideDirChange();
  settingsSnapshot = JSON.stringify(collectSettings());
}

let settingsSnapshot = null;
function collectSettings() {
  return {
    maxRamGB: Number($('ram-max').value),
    width: Number($('win-w').value),
    height: Number($('win-h').value),
    fullscreen: $('fullscreen').checked,
    afterLaunch: $('after-launch').value,
    jvmArgs: $('jvm-args').value,
    uiScale: $('ui-scale').value === 'auto' ? 'auto' : Number($('ui-scale').value),
    discordRpc: $('discord-rpc').checked,
    discordRpcButton: $('discord-rpc-button').checked,
    uiAnim: $('ui-anim').checked,
  };
}
/** Tryb wyświetlania gry: dwa przyciski Okno / Pełny ekran. */
function setDisplayMode(full) {
  $('fullscreen').checked = full;
  for (const b of $('display-mode').children) b.classList.toggle('active', (b.dataset.mode === 'fullscreen') === full);
  $('win-size').classList.toggle('hidden', full);
}
for (const b of $('display-mode').children) b.onclick = () => setDisplayMode(b.dataset.mode === 'fullscreen');

function hideDirChange() {
  pendingDir = null;
  $('dir-change').classList.add('hidden');
}
function showDirChange(dir) {
  if (!dir || dir === $('game-dir').value) return;
  pendingDir = dir;
  $('new-dir').textContent = dir;
  $('dir-change').classList.remove('hidden');
}

$('discord-rpc').onchange = () => { $('discord-rpc-button').disabled = !$('discord-rpc').checked; };

$('ram-max').oninput = updateRamLabels;
$('btn-folder').onclick = (e) => { e.preventDefault(); L.openFolder(); };

$('btn-pick').onclick = async () => showDirChange(await L.pickFolder());
$('btn-dir-default').onclick = async (e) => {
  e.preventDefault();
  const { defaultGameDir } = await L.getSettings();
  showDirChange(defaultGameDir);
};
$('btn-dir-cancel').onclick = hideDirChange;
$('btn-dir-apply').onclick = async () => {
  $('settings-error').textContent = '';
  $('btn-dir-apply').disabled = true;
  try {
    const s = await L.changeGameDir(pendingDir, $('move-files').checked);
    $('game-dir').value = s.gameDir;
    addLog(`Folder gry: ${s.gameDir}`);
    hideDirChange();
  } catch (e) {
    $('settings-error').textContent = cleanErr(e);
  } finally {
    $('btn-dir-apply').disabled = false;
  }
};

$('btn-repair').onclick = async () => {
  go('home');
  setLog(true);
  try { await L.repair(); } catch { /* błąd już w logu */ }
};

$('btn-settings-save').onclick = async () => {
  $('settings-error').textContent = '';
  try {
    const c = collectSettings();
    await L.saveSettings(c);
    settingsSnapshot = JSON.stringify(c);
    animOn = c.uiAnim !== false;
    addLog('Zapisano ustawienia.');
    refreshRam();
    const b = $('btn-settings-save');
    b.textContent = '✔ Zapisano';
    setTimeout(() => { b.textContent = 'Zapisz'; }, 1500);
  } catch (e) {
    $('settings-error').textContent = cleanErr(e);
  }
};

// ---------- co nowego / lista zmian ----------
function showChanges(title, entries) {
  if (!entries || !entries.length) return;
  $('changes-title').textContent = title;
  const box = $('changes-list');
  box.replaceChildren();
  for (const e of entries) {
    const h = el('h4', { className: 'change-ver', textContent: `Wersja ${e.version}` });
    if (e.date) h.append(el('span', { className: 'date', textContent: e.date }));
    box.append(h, el('ul', {}, ...e.items.map((i) => el('li', { textContent: i }))));
  }
  $('changes').classList.remove('hidden');
}
$('btn-changes-close').onclick = () => $('changes').classList.add('hidden');
$('btn-changelog-full').onclick = (e) => { e.preventDefault(); clTab = 'launcher'; go('changelog'); };

// ---------- start ----------
async function init() {
  const a = await L.getApp();
  document.title = a.appName;
  launcherChangelog = a.changelog || null;
  I18N.set(a.lang);
  animOn = a.uiAnim !== false;
  $('version-info').dataset.version = a.version;
  if (a.portable) $('version-info').dataset.portable = '1';
  renderVersionInfo();
  showInfo(a.info);
  if (a.whatsNew && a.whatsNew.length) showChanges(`Co nowego w wersji ${a.version}`, a.whatsNew);
  renderAccounts(await L.getAccounts());
  showUpdate(await L.getUpdate());
  showInfo(await L.refreshInfo()); // świeże newsy/adres z sieci
  refreshStatus();
  setInterval(refreshStatus, 30 * 1000);
  refreshRam();
  // podgląd 3D skina przygotowujemy w wolnej chwili, żeby pierwsze otwarcie okna było szybkie
  const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 1500));
  idle(() => { try { ensurePreview(); } catch { /* spróbujemy przy otwarciu okna */ } });
}
init();

// ---------- Moje mody ----------

const fmtDl = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1).replace('.', ',')} mln` : n >= 1e3 ? `${Math.round(n / 1e3)} tys.` : String(n));
let myMods = [];

function mmItem(icon, title, sub, actions, cls = '', href = null) {
  const pic = icon ? el('img', { src: icon, alt: '', loading: 'lazy' }) : el('div', { className: 'mm-noicon' });
  if (icon) pic.onerror = () => pic.replaceWith(el('div', { className: 'mm-noicon' }));
  return el('div', { className: `mm-item ${cls}` },
    href ? el('a', { href, target: '_blank', title: 'Otwórz stronę na Modrinth' }, pic) : pic,
    el('div', { className: 'mm-text' }, title, el('div', { className: 'mm-sub', textContent: sub, title: sub })),
    el('div', { className: 'mm-actions' }, ...actions));
}
/** Szare „zarysy” kafelków na czas ładowania – lista nie zmienia wysokości. */
const mmSkeleton = (n = 6) => Array.from({ length: n }, () => el('div', { className: 'mm-item skel' },
  el('div', { className: 'mm-noicon' }), el('div', { className: 'mm-text' }, el('div', { className: 'skel-line w60' }), el('div', { className: 'skel-line w90' })), el('div', {})));
function mmBtn(text, cls, fn) {
  const b = el('button', { className: cls, textContent: text });
  b.onclick = async () => {
    b.disabled = true;
    const old = b.textContent;
    b.textContent = '…';
    try { await fn(); } catch (e) { $('mymods-msg').textContent = cleanErr(e); }
    finally { b.disabled = false; b.textContent = old; }
  };
  return b;
}

async function refreshMyMods() {
  const d = await L.myMods();
  myMods = d.list;
  const on = myMods.filter((m) => m.enabled && !m.blocked).length;
  $('mymods-count').textContent = on ? String(on) : '';
  renderHomeMods();
  const box = $('mymods-list');
  if (mm.kind === 'installed') return renderInstalled(box);
  const mine = myMods.filter((m) => (m.kind || 'mod') === mm.kind);
  $('mymods-list-title').textContent = `${MM_TEXT[mm.kind].list} (${mine.length})`;
  $('btn-mymods-updates').classList.toggle('hidden', !mine.length);
  if (!mine.length) { box.replaceChildren(el('p', { className: 'hint mm-empty', textContent: MM_TEXT[mm.kind].empty })); return; }
  const LIMIT = 4;
  const shown = mm.showAll || mine.length <= LIMIT ? mine : mine.slice(0, LIMIT);
  const items = shown.map(playerModItem);
  if (shown.length < mine.length) {
    const more = el('button', { className: 'link-btn mm-showall', textContent: `Pokaż wszystkie (${mine.length})` });
    more.onclick = () => { mm.showAll = true; refreshMyMods(); };
    items.push(more);
  }
  box.replaceChildren(...items);
}

function playerModItem(m) {
    const title = el('div', { className: 'mm-title' }, m.projectId ? mrLink(m.projectId, m.name) : m.name);
    if (m.source === 'dysk') title.append(el('span', { className: 'mm-tag disk', textContent: 'z dysku' }));
    if (m.needsServer) title.append(el('span', { className: 'mm-tag disk', textContent: 'wymaga serwera' }));
    if (m.blocked) title.append(el('span', { className: 'mm-tag blocked', textContent: `zablokowany przez administrację${m.blocked !== 'zablokowany' ? `: ${m.blocked}` : ''}` }));
    else if (!m.enabled) title.append(el('span', { className: 'mm-tag', textContent: 'wyłączony' }));
    const sub = [m.version, (m.requiredBy || []).length ? `wymagany przez: ${m.requiredBy.map((r) => (myMods.find((x) => x.id === r) || {}).name || r).join(', ')}` : ''].filter(Boolean).join(' · ');
    return mmItem(m.icon, title, sub, [
      m.blocked ? null : mmBtn(m.enabled ? 'Wyłącz' : 'Włącz', 'small-btn', async () => { await L.myModsToggle(m.id, !m.enabled); await refreshMyMods(); }),
      mmBtn('Odinstaluj', 'small-btn danger', async () => {
        await L.myModsRemove(m.id);
        $('mymods-msg').textContent = `Odinstalowano: ${m.name || m.file}`;
        await refreshMyMods();
        refreshResultActions(); // przycisk przy wyniku wraca od razu do „Zainstaluj”
        installedCache = null;
      }),
    ].filter(Boolean), m.enabled && !m.blocked ? '' : 'off', m.projectId ? `https://modrinth.com/project/${encodeURIComponent(m.projectId)}` : null);
}

async function openMyMods() {
  $('mymods-msg').textContent = '';
  $('mymods-updates').replaceChildren();
  await refreshMyMods().catch((e) => { $('mymods-msg').textContent = cleanErr(e); });
  loadPackIds().then(() => refreshResultActions());
  setMmKind(mm.kind);
  $('mymods-q').focus();
}

let installedCache = null;
let installedLoading = null;
/** Lista zainstalowanych: od razu z pamięci, a świeża dociąga się w tle. */
async function renderInstalled(box, refresh = false) {
  const q = ($('mymods-installed-q').value || '').toLowerCase();
  if (!installedCache || refresh) {
    if (!installedCache) box.replaceChildren(...mmSkeleton(8));
    installedLoading = installedLoading || L.myModsInstalled().finally(() => { installedLoading = null; });
    const fresh = await installedLoading;
    if (mm.kind !== 'installed') { installedCache = fresh; return; }
    installedCache = fresh;
  }
  const mine = myMods.filter((m) => (m.kind || 'mod') === 'mod');
  const match = (name) => !q || String(name || '').toLowerCase().includes(q);
  const lock = (text) => el('span', { className: 'mm-tag lock', textContent: text });
  const packItems = installedCache.pack.filter((p) => match(p.name) || match(p.file)).map((p) => {
    const t = el('div', { className: 'mm-title', textContent: `🔒 ${p.name || p.file.replace(/\.jar$/i, '')}` });
    t.append(lock('z paczki serwera'));
    return mmItem(p.icon || null, t, [p.version, p.file].filter(Boolean).join(' · '), []);
  });
  const addonItems = installedCache.addons.filter((a) => match(a.file)).map((a) => {
    const t = el('div', { className: 'mm-title', textContent: `🔒 ${a.file.replace(/\.jar$/i, '')}` });
    t.append(lock(`dodatek: ${a.addon}`));
    return mmItem(a.icon || null, t, 'Włączasz i wyłączasz w oknie Dodatki (pasek boczny)', []);
  });
  const myItems = mine.filter((m) => match(m.name)).map(playerModItem);
  $('mymods-list-title').textContent = `Zainstalowane mody (${installedCache.pack.length + installedCache.addons.length + mine.length})`;
  $('btn-mymods-updates').classList.toggle('hidden', !mine.length);
  const sec = (txt) => el('div', { className: 'mm-section', textContent: txt });
  if (!installedCache.pack.length && !mine.length) { box.replaceChildren(el('p', { className: 'hint', textContent: MM_TEXT.installed.empty })); return; }
  box.replaceChildren(
    ...(myItems.length ? [sec(`Twoje mody (${myItems.length})`), ...myItems] : []),
    ...(addonItems.length ? [sec(`Z dodatków (${addonItems.length})`), ...addonItems] : []),
    sec(`Z paczki serwera (${packItems.length})`), ...packItems,
  );
}

const MM_CATS = {
  mod: [
    ['', 'Wszystkie'], ['optimization', 'Wydajność'], ['utility', 'Przydatne'], ['decoration', 'Dekoracje'],
    ['equipment', 'Wyposażenie'], ['technology', 'Technologia'], ['magic', 'Magia'], ['adventure', 'Przygoda'],
    ['worldgen', 'Świat'], ['mobs', 'Moby'], ['food', 'Jedzenie'], ['storage', 'Przechowywanie'],
  ],
  shader: [
    ['', 'Wszystkie'], ['vanilla-like', 'Jak w grze'], ['semi-realistic', 'Półrealistyczne'], ['realistic', 'Realistyczne'],
    ['fantasy', 'Fantasy'], ['cartoon', 'Kreskówkowe'], ['potato', 'Bardzo słaby PC'], ['low', 'Słaby PC'],
    ['medium', 'Średni PC'], ['high', 'Mocny PC'],
  ],
  resourcepack: [
    ['', 'Wszystkie'], ['16x', '16x'], ['32x', '32x'], ['64x', '64x+'], ['vanilla-like', 'Jak w grze'], ['simplistic', 'Proste'],
    ['realistic', 'Realistyczne'], ['themed', 'Tematyczne'], ['gui', 'Interfejs'], ['audio', 'Dźwięki'], ['fonts', 'Czcionki'],
  ],
};
const MM_TEXT = {
  mod: { hint: 'Mody tylko dla Ciebie, np. minimapa, zoom albo lepsze dźwięki. Mody oznaczone „wymaga serwera” muszą być też na serwerze – bez tego możesz nie wejść do gry.', list: 'Twoje mody', q: 'Szukaj w Modrinth, np. minimap, zoom, sound…', empty: 'Nie masz jeszcze własnych modów.' },
  shader: { hint: 'Shadery zmieniają oświetlenie, cienie i wodę. Potrzebują moda Iris – launcher zaproponuje go przy pierwszym shaderze. Włączasz je w grze: Opcje → Ustawienia grafiki → Paczki shaderów.', list: 'Twoje shadery', q: 'Szukaj shaderów, np. Complementary, BSL…', empty: 'Nie masz jeszcze shaderów.' },
  installed: { hint: 'Wszystkie mody, które masz w grze. Mody z kłódką dodała administracja serwera – są potrzebne do gry i nie da się ich usunąć. Swoje mody możesz wyłączać i usuwać.', list: 'Zainstalowane mody', q: '', empty: 'Brak informacji o modach – uruchom grę przynajmniej raz.' },
  resourcepack: { hint: 'Paczki tekstur zmieniają wygląd bloków, przedmiotów i interfejsu. Włączasz je w grze: Opcje → Paczki zasobów.', list: 'Twoje paczki tekstur', q: 'Szukaj paczek tekstur, np. Faithful, Fresh Animations…', empty: 'Nie masz jeszcze paczek tekstur.' },
};
const mm = { kind: 'mod', cat: '', offset: 0, total: 0, seq: 0, showAll: false, state: {} };
/** Stan każdej zakładki: kategoria, wpisane wyszukiwanie i ostatnie wyniki – po powrocie wszystko jest od razu. */
const mmState = (kind) => (mm.state[kind] = mm.state[kind] || { cat: '', q: '', hits: null, total: 0, offset: 0, at: 0, key: '' });

function renderCats() {
  $('mymods-cats').replaceChildren(...MM_CATS[mm.kind].map(([id, label]) => {
    const b = el('button', { className: `mm-cat${mm.cat === id ? ' active' : ''}`, textContent: label });
    b.onclick = () => { mm.cat = id; mmState(mm.kind).cat = id; renderCats(); searchMyMods(); };
    return b;
  }));
}

const mrLink = (id, text) => el('a', { href: `https://modrinth.com/project/${encodeURIComponent(id)}`, target: '_blank', className: 'mm-link', textContent: text, title: 'Otwórz stronę na Modrinth' });

// projekty z paczki serwera – w wynikach jako „W paczce 🔒” (bez możliwości dodania)
let packIds = { projects: new Set(), modIds: new Set() };
async function loadPackIds() {
  try {
    const r = await L.myModsPackIds();
    packIds = { projects: new Set(r.projects || []), modIds: new Set((r.modIds || []).map((x) => String(x).toLowerCase())) };
  } catch { /* bez tego tylko nie oznaczymy modów z paczki */ }
}
const inPack = (h) => packIds.projects.has(h.id) || (h.kind === 'mod' && h.slug && packIds.modIds.has(String(h.slug).toLowerCase().replace(/-/g, '_')))
  || (h.kind === 'mod' && h.slug && packIds.modIds.has(String(h.slug).toLowerCase()));

/** Przycisk przy wyniku: Zainstaluj / Odinstaluj / W paczce 🔒. */
function resultAction(h) {
  if (inPack(h)) return el('span', { className: 'mm-tag lock', title: 'Ten mod jest już w paczce serwera', textContent: 'W paczce 🔒' });
  const mine = myMods.find((m) => m.projectId === h.id);
  if (mine) {
    return mmBtn('Odinstaluj', 'ghost-sm danger', async () => {
      if (mine.requiredBy && mine.requiredBy.length && !confirm(`${mine.name || h.title} jest potrzebny dla: ${mine.requiredBy.join(', ')}. Odinstalować mimo to?`)) return;
      await L.myModsRemove(mine.id);
      $('mymods-msg').textContent = `Odinstalowano: ${mine.name || h.title}`;
      await refreshMyMods();
      refreshResultActions();
    });
  }
  return mmBtn('Zainstaluj', 'primary-sm', async () => {
    if (h.kind === 'shader' && await L.myModsNeedIris()) {
      if (!confirm('Shadery działają tylko z modem Iris. Zainstalować też Iris?')) return;
      await L.myModsAddModrinth('iris', 'mod');
    }
    if ((h.needsServer || h.serverOnly) && !confirm(h.serverOnly
      ? `${h.title} działa tylko na serwerze – u Ciebie nic nie zmieni. Zainstalować mimo to?`
      : `${h.title} musi być też na serwerze. Bez tego możesz nie wejść na serwer (wtedy użyj „Uruchom bez moich modów”). Zainstalować mimo to?`)) return;
    const added = await L.myModsAddModrinth(h.id, h.kind);
    $('mymods-msg').textContent = added.length > 1 ? `Zainstalowano: ${added.join(', ')}` : `Zainstalowano: ${added[0] || h.title}`;
    await refreshMyMods();
    refreshResultActions();
  });
}
/** Odświeża przyciski przy wynikach (np. po (od)instalowaniu) – bez ponownego wyszukiwania. */
function refreshResultActions() {
  const st = mmState(mm.kind);
  const byId = new Map((st.hits || []).map((h) => [h.id, h]));
  for (const item of $('mymods-results').querySelectorAll('.mm-item')) {
    const h = byId.get(item.dataset.id);
    if (h) item.querySelector('.mm-actions').replaceChildren(resultAction(h));
  }
}

function modResult(h) {
  const t = el('div', { className: 'mm-title' }, mrLink(h.id, h.title), el('span', { className: 'mm-tag', textContent: `⬇ ${fmtDl(h.downloads)}` }));
  if (h.needsServer || h.serverOnly) t.append(el('span', { className: 'mm-tag disk', textContent: h.serverOnly ? 'tylko serwer' : 'wymaga serwera' }));
  return mmItem(h.icon, t, h.description || '', [resultAction(h)], inPack(h) ? 'in-pack' : '', `https://modrinth.com/project/${encodeURIComponent(h.id)}`);
}

function renderResults(hits, append = false) {
  const box = $('mymods-results');
  const items = hits.map((h) => { const it = modResult(h); it.dataset.id = h.id; return it; });
  if (!append) {
    if (!items.length) { box.replaceChildren(el('p', { className: 'hint mm-empty', textContent: 'Nic nie znaleziono. Spróbuj innej nazwy (najlepiej po angielsku) albo innej kategorii.' })); return; }
    box.replaceChildren(...items);
  } else box.append(...items);
}
function resultsTitle(q) {
  const cat = (MM_CATS[mm.kind] || []).find(([id]) => id === mm.cat);
  const where = { mod: 'mody', shader: 'shadery', resourcepack: 'paczki tekstur' }[mm.kind] || '';
  $('mymods-results-title').textContent = q ? `Wyniki dla „${q}”` : `Popularne ${where} w Modrinth${cat && cat[0] ? ` · ${cat[1]}` : ''}`;
}

/** Szukanie / przeglądanie; more = dociągnij kolejną stronę. Wyniki zapamiętujemy dla każdej zakładki. */
async function searchMyMods(more = false, { quiet = false } = {}) {
  const q = $('mymods-q').value.trim();
  const box = $('mymods-results');
  const st = mmState(mm.kind);
  const seq = ++mm.seq;
  $('mymods-msg').textContent = '';
  st.q = q;
  resultsTitle(q);
  const sort = q && $('mymods-sort').dataset.touched !== '1' ? 'relevance' : $('mymods-sort').value;
  const key = `${q}|${mm.cat}|${sort}`;
  if (!more) {
    mm.offset = 0;
    if (!quiet) box.replaceChildren(...mmSkeleton(6));
  }
  $('btn-mymods-more').classList.add('hidden');
  try {
    const r = await L.myModsSearch(q, { kind: mm.kind, category: mm.cat, sort, offset: more ? mm.offset : 0 });
    if (seq !== mm.seq) return; // w międzyczasie kliknięto coś innego
    mm.total = r.total;
    if (more) { st.hits = [...(st.hits || []), ...r.hits]; mm.offset += r.hits.length; } else { st.hits = r.hits; mm.offset = r.hits.length; }
    Object.assign(st, { total: r.total, offset: mm.offset, at: Date.now(), key });
    renderResults(r.hits, more);
    $('btn-mymods-more').classList.toggle('hidden', mm.offset >= mm.total || !r.hits.length);
  } catch (e) { if (!more && !quiet) box.replaceChildren(); $('mymods-msg').textContent = cleanErr(e); }
}

async function addMyModFiles(paths) {
  $('mymods-msg').textContent = 'Dodaję…';
  try {
    const results = paths ? (await Promise.all(paths.map((p) => L.myModsAddFile(p)))).flat() : await L.myModsAddFile(null);
    if (!results.length) { $('mymods-msg').textContent = ''; return; }
    const ok = results.filter((r) => r.ok).map((r) => r.ok);
    const bad = results.filter((r) => r.error).map((r) => r.error);
    $('mymods-msg').textContent = [ok.length ? `Dodano: ${ok.join(', ')}. Uwaga: mody spoza Modrinth nie są sprawdzane – jeśli gra się wysypie, wyłącz je.` : '', ...bad].filter(Boolean).join(' ');
    await refreshMyMods();
  } catch (e) { $('mymods-msg').textContent = cleanErr(e); }
}

function setMmKind(kind) {
  if (mm.kind !== kind) mm.showAll = false;
  mm.kind = kind;
  const st = mmState(kind);
  mm.cat = st.cat;
  for (const b of $('mymods-tabs').querySelectorAll('button')) b.classList.toggle('active', b.dataset.kind === kind);
  $('mymods-hint').textContent = MM_TEXT[kind].hint;
  $('mymods-hint').classList.remove('open');
  $('mymods-hint-more').textContent = 'więcej';
  const installed = kind === 'installed';
  $('mymods-dialog').classList.toggle('mm-installed', installed);
  for (const e of document.querySelectorAll('.mm-browse')) e.classList.toggle('hidden', installed);
  for (const e of document.querySelectorAll('.mm-installed-only')) e.classList.toggle('hidden', !installed);
  $('mymods-updates').replaceChildren();
  $('mm-scroll').scrollTop = 0;
  if (installed) {
    $('mymods-installed-q').value = '';
    const had = !!installedCache;
    refreshMyMods().then(() => had && renderInstalled($('mymods-list'), true)).catch((e) => { $('mymods-msg').textContent = cleanErr(e); });
    return;
  }
  $('mymods-q').placeholder = MM_TEXT[kind].q;
  $('mymods-q').value = st.q;
  renderCats();
  refreshMyMods().catch(() => {});
  if (st.hits) {
    // od razu pokazujemy zapamiętane wyniki; po 3 minutach odświeżamy je po cichu w tle
    mm.offset = st.offset;
    mm.total = st.total;
    resultsTitle(st.q);
    renderResults(st.hits);
    $('btn-mymods-more').classList.toggle('hidden', mm.offset >= mm.total);
    if (Date.now() - st.at > 3 * 60 * 1000) searchMyMods(false, { quiet: true });
  } else searchMyMods();
}
$('mymods-hint-more').onclick = () => {
  const open = $('mymods-hint').classList.toggle('open');
  $('mymods-hint-more').textContent = open ? 'mniej' : 'więcej';
};
$('mymods-installed-q').addEventListener('input', () => renderInstalled($('mymods-list')));
for (const b of $('mymods-tabs').querySelectorAll('button')) b.onclick = () => setMmKind(b.dataset.kind);
$('btn-mymods-search').onclick = () => searchMyMods();
$('mymods-q').addEventListener('keydown', (e) => { if (e.key === 'Enter') searchMyMods(); });
$('mymods-sort').addEventListener('change', () => { $('mymods-sort').dataset.touched = '1'; searchMyMods(); });
$('btn-mymods-more').onclick = () => searchMyMods(true);
$('btn-mymods-file').onclick = (e) => { e.preventDefault(); addMyModFiles(null); };
const drop = $('mymods-drop');
drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', (e) => {
  e.preventDefault();
  drop.classList.remove('over');
  const paths = [...e.dataTransfer.files].map((f) => L.pathForFile(f)).filter(Boolean);
  if (paths.length) addMyModFiles(paths);
});
$('btn-mymods-updates').onclick = async () => {
  const box = $('mymods-updates');
  box.replaceChildren(el('p', { className: 'hint', textContent: 'Sprawdzam…' }));
  try {
    const ups = await L.myModsUpdates();
    if (!ups.length) { box.replaceChildren(el('p', { className: 'hint', textContent: 'Wszystko aktualne (sprawdzane przez Modrinth).' })); return; }
    box.replaceChildren(...ups.map((u) => mmItem(null, el('div', { className: 'mm-title', textContent: u.name }), `${u.from} → ${u.to}`,
      [mmBtn('Aktualizuj', 'primary-sm', async () => { await L.myModsUpdate(u); await refreshMyMods(); $('btn-mymods-updates').click(); })])));
  } catch (e) { box.replaceChildren(); $('mymods-msg').textContent = cleanErr(e); }
};
refreshMyMods().catch(() => {});

// ---------- zamykanie okien: klik obok, Esc, ✕ ----------

const OVERLAY_CLOSE = {
  'add-account': () => { if (!$('add-account').classList.contains('required')) closeAddAccount(); },
  changes: () => $('btn-changes-close').click(),
};
for (const [id, close] of Object.entries(OVERLAY_CLOSE)) {
  const ov = $(id);
  if (!ov) continue;
  let downOnOverlay = false;
  // tylko gdy kliknięcie zaczęło i skończyło się poza oknem (żeby zaznaczanie tekstu nie zamykało)
  ov.addEventListener('mousedown', (e) => { downOnOverlay = e.target === ov; });
  ov.addEventListener('click', (e) => { if (e.target === ov && downOnOverlay) close(); });
  const panel = ov.querySelector('.panel');
  if (panel) {
    const x = el('button', { className: 'panel-x', textContent: '✕', title: 'Zamknij (Esc)' });
    x.onclick = close;
    panel.prepend(x);
  }
}
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const open = Object.keys(OVERLAY_CLOSE).map((id) => $(id)).filter((o) => o && !o.classList.contains('hidden'));
  const top = open[open.length - 1];
  if (top) { e.preventDefault(); OVERLAY_CLOSE[top.id](); }
});

// ---------- nowy układ: pasek, widoki, menu ⋯, „Moje mody” na ekranie Start ----------

let homeStyle = 'tiles';

// ---------- strony (zamiast okien): pasek boczny przełącza zawartość obok ----------
const PAGES = {
  skin: { el: 'skin-dialog', enter: () => openSkin() },
  home: { el: 'page-home' },
  players: { el: 'players-dialog', enter: () => openPlayers(), leave: () => closePlayers() },
  news: { el: 'page-news' },
  addons: { el: 'addons-dialog', enter: () => openAddons() },
  changelog: { el: 'page-changelog', enter: () => renderChangelog() },
  mymods: { el: 'mymods-dialog', enter: () => openMyMods() },
  settings: { el: 'settings', enter: () => openSettings() },
};
let page = 'home';
let animOn = true;
let pageBusy = false;
let pageQueued = null;
const ANIM_MS = 300;
/** Kolejność stron = kolejność widocznych przycisków na pasku (od góry). */
function pageIndex(p) {
  const btns = [...document.querySelectorAll('.rail [data-page]')].filter((b) => !b.classList.contains('rail-off') && !b.classList.contains('hidden'));
  const i = btns.findIndex((b) => b.dataset.page === p);
  return i < 0 ? btns.length : i;
}
function markRail() {
  for (const b of document.querySelectorAll('.rail [data-page]')) b.classList.toggle('active', b.dataset.page === page);
}
function go(p) {
  if (!PAGES[p] || p === page) return;
  if (pageBusy) { pageQueued = p; return; }
  const from = $(PAGES[page].el);
  const to = $(PAGES[p].el);
  const down = pageIndex(p) > pageIndex(page); // przycisk niżej → nowa strona wjeżdża z dołu
  try { PAGES[page].leave && PAGES[page].leave(); } catch { /* nic */ }
  page = p;
  markRail();
  to.classList.remove('hidden');
  try { const r = PAGES[p].enter && PAGES[p].enter(); if (r && r.catch) r.catch(() => {}); } catch { /* nic */ }
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!animOn || reduce) { from.classList.add('hidden'); return; }
  pageBusy = true;
  const box = $('pages');
  box.classList.add('animating');
  from.classList.add(down ? 'pg-out-up' : 'pg-out-down');
  to.classList.add(down ? 'pg-in-up' : 'pg-in-down');
  setTimeout(() => {
    from.classList.add('hidden');
    from.classList.remove('pg-out-up', 'pg-out-down');
    to.classList.remove('pg-in-up', 'pg-in-down');
    box.classList.remove('animating');
    pageBusy = false;
    if (pageQueued) { const q = pageQueued; pageQueued = null; go(q); }
  }, ANIM_MS);
}
for (const b of document.querySelectorAll('.rail [data-page]')) b.addEventListener('click', () => go(b.dataset.page));
markRail();
$('news-all').onclick = (e) => { e.preventDefault(); go('news'); };
$('scene-news-all').onclick = (e) => { e.preventDefault(); go('news'); };

// ---------- Changelog: Launcher / Server ----------
let launcherChangelog = null;
let serverChangelog = [];
let clTab = 'launcher';
function renderChangelog() {
  $('cl-launcher').classList.toggle('active', clTab === 'launcher');
  $('cl-server').classList.toggle('active', clTab === 'server');
  const list = $('cl-list');
  const entries = clTab === 'launcher'
    ? (launcherChangelog || []).map((e) => ({ title: `Wersja ${e.version}`, date: e.date, items: e.items }))
    : serverChangelog.map((e) => ({ title: e.title, date: e.date, items: e.items, text: e.text }));
  if (!entries.length) {
    list.replaceChildren(el('p', { className: 'hint cl-empty', textContent: clTab === 'server' ? 'Administracja nie dodała jeszcze żadnych zmian serwera.' : 'Brak wpisów.' }));
    return;
  }
  list.replaceChildren(...entries.map((e) => el('article', { className: 'cl-card' },
    el('div', { className: 'cl-card-head' }, el('h4', { textContent: e.title || '' }), e.date ? el('span', { className: 'cl-date', textContent: e.date }) : ''),
    e.items && e.items.length ? el('ul', {}, ...e.items.map((t) => el('li', { textContent: t }))) : '',
    e.text ? el('p', { textContent: e.text }) : '')));
  list.scrollTop = 0;
}
$('cl-launcher').onclick = () => { if (clTab !== 'launcher') { clTab = 'launcher'; renderChangelog(); } };
$('cl-server').onclick = () => { if (clTab !== 'server') { clTab = 'server'; renderChangelog(); } };
$('scene-prev').onclick = () => { const t = $('scene-news-track'); t.scrollBy({ left: -t.clientWidth * 0.8, behavior: 'smooth' }); };
$('scene-next').onclick = () => { const t = $('scene-news-track'); t.scrollBy({ left: t.clientWidth * 0.8, behavior: 'smooth' }); };
$('home-mods-open').onclick = (e) => { e.preventDefault(); go('mymods'); };

function renderHomeMods() {
  const box = $('home-mods');
  const on = myMods.filter((m) => m.enabled && !m.blocked);
  if (!on.length) {
    box.replaceChildren(el('span', { className: 'home-empty', textContent: 'Nie masz jeszcze własnych modów – dodaj minimapę, zoom albo shadery.' }));
    return;
  }
  const items = on.slice(0, 3).map((m) => el('div', { className: 'home-mod', title: m.name },
    m.icon ? el('img', { src: m.icon, alt: '' }) : el('div', { className: 'noicon' }),
    el('span', { textContent: m.name })));
  box.replaceChildren(...items);
  $('home-mods-open').textContent = on.length > 3 ? `Wszystkie (${on.length})` : 'Przeglądaj';
}


