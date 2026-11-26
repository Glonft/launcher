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
$('btn-log').onclick = (e) => {
  e.preventDefault();
  $('log').classList.toggle('hidden');
  $('btn-log').textContent = $('log').classList.contains('hidden') ? 'Pokaż log' : 'Ukryj log';
};

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
    const d = $('btn-discord');
    d.classList.toggle('hidden', !info.discord);
    d.href = info.discord || '#';
  }
  if ('appearance' in info) applyAppearance(info.appearance);
  if ('requiredLauncher' in info) {
    const box = $('launcher-outdated');
    box.classList.toggle('hidden', !info.requiredLauncher);
    box.textContent = info.requiredLauncher
      ? `Ten serwer wymaga launchera ${info.requiredLauncher} lub nowszego. Zaktualizuj launcher, żeby zagrać.`
      : '';
    if (info.requiredLauncher) L.getUpdate().then(showUpdate).catch(() => {});
  }
  if (info.server && info.server.name) { $('scene-server').textContent = info.server.name; }
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
  const T = window.MelinaTheme;
  // kolory
  if (a && a.colors && T) T.apply(a.colors);
  else if (T) for (const k of Object.keys(T.vars({}))) document.documentElement.style.removeProperty(k);
  try { localStorage.setItem('melina.appearance', JSON.stringify({ colors: (a && a.colors) || null })); } catch { /* bez znaczenia */ }
  // układ ekranu Start: „Kafelki” albo „Scena”
  const l = (a && a.layout) || {};
  setHomeStyle(l.style === 'scene' ? 'scene' : 'tiles', a);
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
/** Pasek boczny: kolejność górnych ikon i ukryte ikony (z panelu). Start i Ustawienia są zawsze. */
const RAIL_IDS = { mymods: 'btn-mymods', addons: 'btn-addons', news: 'nav-news', players: 'btn-players', discord: 'btn-discord' };
function applyRail(l) {
  const order = Array.isArray(l.railOrder) && l.railOrder.length ? l.railOrder : ['mymods', 'addons', 'news', 'players'];
  const hidden = new Set(Array.isArray(l.railHidden) ? l.railHidden : []);
  const space = document.querySelector('.rail-space');
  for (const k of order) if (RAIL_IDS[k] && k !== 'discord') space.before($(RAIL_IDS[k]));
  for (const [k, id] of Object.entries(RAIL_IDS)) $(id).classList.toggle('rail-off', hidden.has(k));
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
  showView('news');
  const item = [...$('news-full').children].find((x) => x.dataset.key === `${n.date}|${n.title}`);
  if (item) { item.scrollIntoView({ block: 'start' }); item.classList.add('flash'); setTimeout(() => item.classList.remove('flash'), 1500); }
}
/** Przenosi przycisk Graj i pasek postępu do kafelka „Scena” albo z powrotem na kartę serwera. */
function setHomeStyle(style, a) {
  const playRow = document.querySelector('.play-row');
  const prog = document.querySelector('.progress');
  if (style === 'scene') {
    $('scene-play-slot').append(playRow, prog);
    const inv = $('btn-discord').getAttribute('href');
    const showDc = !!(a.layout && a.layout.discordCard !== false) && inv && inv !== '#';
    $('scene-discord').classList.toggle('hidden', !showDc);
    if (showDc) {
      $('scene-discord').href = inv;
      L.discordCounts().then((c) => {
        $('scene-discord-count').textContent = c && c.members ? `Dołącz do ${c.members} osób na naszym Discordzie!` : 'Kliknij, żeby dołączyć!';
      }).catch(() => {});
    }
  } else {
    const hero = document.querySelector('.hero');
    hero.append(playRow, prog);
  }
  homeStyle = style;
  if (!$('view-news').classList.contains('hidden')) return; // ktoś czyta aktualności – nie przełączamy widoku
  showView('home');
}

// ---------- pasek górny okna ----------
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
async function refreshStatus() {
  $('btn-ping').disabled = true;
  try {
    const r = await L.pingServer();
    if (r.server) showInfo({ server: r.server, news: null });
    const dot = $('status-dot');
    $('players-badge').textContent = r.online && r.players.online ? String(r.players.online) : '';
    if (r.online) {
      dot.className = 'dot on';
      $('status-text').textContent = 'Online';
      dot.title = `Online${r.version ? ' – ' + r.version : ''}`;
      $('players-count').textContent = `${r.players.online}/${r.players.max}`;
      $('ping-ms').textContent = `${r.latency} ms`;
      $('scene-dot').className = 'dot on';
      $('scene-online-text').textContent = `${r.players.online}/${r.players.max}`;
    } else {
      dot.className = 'dot off';
      dot.title = r.error || 'Offline';
      $('status-text').textContent = 'Offline';
      $('players-count').textContent = '–';
      $('ping-ms').textContent = '–';
      $('scene-dot').className = 'dot off';
      $('scene-online-text').textContent = 'Offline';
    }
  } catch (e) {
    $('status-dot').className = 'dot off';
    $('status-text').textContent = 'Offline';
    $('players-badge').textContent = '';
  } finally {
    $('btn-ping').disabled = false;
  }
}
$('btn-ping').onclick = refreshStatus;

// ---------- konta ----------
function renderAccounts(state) {
  accountsState = state;
  const a = state.active;
  $('account-none').classList.toggle('hidden', !!a);
  $('account-current').classList.toggle('hidden', !a);
  updatePlayButton();
  if (!a) return;

  $('player').textContent = a.name;
  $('acc-type').textContent = a.type === 'microsoft' ? 'Konto Microsoft (premium)' : 'Konto non-premium';
  const av = $('avatar');
  av.textContent = '';
  av.style.backgroundImage = `url("${headUrl(a.name)}")`;
  $('rail-head').style.backgroundImage = `url("${headUrl(a.name)}")`;
  $('scene-nick').textContent = a.name;
  $('scene-head').style.backgroundImage = `url("${headUrl(a.name)}")`;

  const sel = $('account-select');
  sel.replaceChildren();
  for (const acc of state.list) {
    sel.append(el('option', { value: acc.id, textContent: acc.name + (acc.type === 'microsoft' ? ' ★' : ''), selected: acc.id === a.id }));
  }
  sel.append(el('option', { value: '__add', textContent: '+ Dodaj konto…' }));

  // lista w ustawieniach
  const box = $('accounts-list');
  box.replaceChildren();
  for (const acc of state.list) {
    const rm = el('button', { className: 'rm', textContent: 'Usuń', title: 'Usuń konto z launchera' });
    rm.onclick = async () => renderAccounts(await L.removeAccount(acc.id));
    box.append(el('div', { className: 'acc-row' },
      el('span', { textContent: `${acc.name} – ${acc.type === 'microsoft' ? 'Microsoft' : 'non-premium'}${acc.id === a.id ? ' (aktywne)' : ''}` }), rm));
  }
}

$('account-select').onchange = async (e) => {
  const v = e.target.value;
  if (v === '__add') { e.target.value = accountsState.active.id; openAddAccount(); return; }
  renderAccounts(await L.selectAccount(v));
};

function openAddAccount() {
  $('login-error').textContent = '';
  $('nick').value = '';
  $('add-account').classList.remove('hidden');
}
$('btn-add-account-first').onclick = openAddAccount;
$('btn-add-account').onclick = openAddAccount;
const closeAddAccount = () => $('add-account').classList.add('hidden');
$('btn-ms').onclick = async () => {
  $('login-error').textContent = '';
  try {
    renderAccounts(await L.addMicrosoft());
    $('add-account').classList.add('hidden');
  } catch (e) { $('login-error').textContent = 'Logowanie nieudane: ' + cleanErr(e); }
};
const addOffline = async () => {
  $('login-error').textContent = '';
  try {
    renderAccounts(await L.addOffline($('nick').value));
    $('add-account').classList.add('hidden');
  } catch (e) { $('login-error').textContent = cleanErr(e); }
};
$('btn-offline').onclick = addOffline;
$('nick').onkeydown = (e) => { if (e.key === 'Enter') addOffline(); };

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
  $('skin-dialog').classList.remove('hidden');
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
    if (seq !== skinSeq || $('skin-dialog').classList.contains('hidden')) return;
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

$('btn-skin').onclick = openSkin;
const closeSkin = () => $('skin-dialog').classList.add('hidden');
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
  const labels = { idle: 'Graj', preparing: 'Anuluj', running: 'Gra uruchomiona', busy: 'Proszę czekać…' };
  $('play-label').textContent = labels[appState] || 'Graj';
  b.classList.toggle('cancel', appState === 'preparing');
  b.disabled = !(appState === 'preparing' || (appState === 'idle' && accountsState.active));
  $('btn-repair').disabled = appState !== 'idle';
  $('btn-more-repair').disabled = appState !== 'idle';
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
  if (s === 'idle') { $('progress-label').textContent = 'Gotowy'; $('bar-fill').style.width = '0'; refreshStatus(); }
});
L.on('error', (msg) => {
  addLog('BŁĄD: ' + msg);
  $('progress-label').textContent = 'Błąd: ' + msg;
  $('log').classList.remove('hidden');
  $('btn-log').textContent = 'Ukryj log';
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
  $('addons-dialog').classList.remove('hidden');
}
const closeAddons = () => $('addons-dialog').classList.add('hidden');
$('btn-addons').onclick = openAddons;

// ---------- gracze online ----------
let playersTimer = null;
let lastPlayers = null;
function playerCard(name) {
  const img = el('img', { src: headUrl(name, 64), alt: '' });
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
      $('players-total').textContent = '';
      box.replaceChildren(el('p', { className: 'hint', textContent: `Serwer jest offline${r.error ? ` (${r.error})` : ''}.` }));
      $('players-note').textContent = '';
      return;
    }
    const p = r.players;
    $('players-total').textContent = `${p.online}/${p.max}`;
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
    $('players-total').textContent = '';
  }
  $('players-dialog').classList.remove('hidden');
  $('btn-players').classList.add('active');
  await loadPlayers();
  clearInterval(playersTimer);
  playersTimer = setInterval(loadPlayers, 30 * 1000);
}
function closePlayers() {
  clearInterval(playersTimer);
  $('players-dialog').classList.add('hidden');
  $('btn-players').classList.remove('active');
}
$('btn-players').onclick = openPlayers;

async function openSettings() {
  const { settings: s, system } = await L.getSettings();
  $('ram-max').max = system.maxAllowedRamGB;
  $('ram-max').value = s.maxRamGB;
  $('ram-hint').textContent = `Twój komputer ma ${system.totalRamGB} GB RAM.`;
  updateRamLabels();
  $('win-w').value = s.width;
  $('win-h').value = s.height;
  $('fullscreen').checked = s.fullscreen;
  $('win-w').disabled = $('win-h').disabled = s.fullscreen;
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
  $('settings').classList.remove('hidden');
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
  };
}
/** Zamknięcie ustawień kliknięciem obok / Esc / ✕ – pyta o niezapisane zmiany. */
function closeSettingsSafely() {
  if (settingsSnapshot && JSON.stringify(collectSettings()) !== settingsSnapshot) {
    if (confirm('Masz niezapisane zmiany w ustawieniach. Zapisać je?\n\nOK – zapisz, Anuluj – odrzuć zmiany.')) { $('btn-settings-save').click(); return; }
  }
  $('settings').classList.add('hidden');
}

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

$('btn-settings').onclick = openSettings;
$('discord-rpc').onchange = () => { $('discord-rpc-button').disabled = !$('discord-rpc').checked; };

$('ram-max').oninput = updateRamLabels;
$('fullscreen').onchange = () => { $('win-w').disabled = $('win-h').disabled = $('fullscreen').checked; };
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
  $('settings').classList.add('hidden');
  $('log').classList.remove('hidden');
  $('btn-log').textContent = 'Ukryj log';
  try { await L.repair(); } catch { /* błąd już w logu */ }
};

$('btn-settings-save').onclick = async () => {
  $('settings-error').textContent = '';
  try {
    await L.saveSettings(collectSettings());
    settingsSnapshot = null;
    $('settings').classList.add('hidden');
    addLog('Zapisano ustawienia.');
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
$('btn-changelog').onclick = async (e) => {
  e.preventDefault();
  showChanges('Lista zmian', await L.getChangelog());
};

// ---------- start ----------
async function init() {
  const a = await L.getApp();
  document.title = a.appName;
  $('tb-title').textContent = /launcher/i.test(a.appName) ? a.appName : `${a.appName} Launcher`;
  $('version-info').dataset.version = a.version;
  if (a.portable) $('version-info').dataset.portable = '1';
  renderVersionInfo();
  showInfo(a.info);
  if (a.whatsNew && a.whatsNew.length) showChanges(`Co nowego w wersji ${a.version}`, a.whatsNew);
  renderAccounts(await L.getAccounts());
  showUpdate(await L.getUpdate());
  showInfo(await L.refreshInfo()); // świeże newsy/adres z sieci
  refreshStatus();
  setInterval(refreshStatus, 60 * 1000);
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
  $('btn-play-clean').classList.toggle('hidden', !myMods.some((m) => m.enabled && !m.blocked && (m.kind || 'mod') === 'mod'));
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
  $('mymods-dialog').classList.remove('hidden');
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

$('btn-mymods').onclick = openMyMods;
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
const closeMyMods = () => $('mymods-dialog').classList.add('hidden');
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
$('btn-play-clean').onclick = (e) => {
  e.preventDefault();
  if ($('btn-play').disabled) return;
  appState = 'preparing'; updatePlayButton(); L.play({ withoutMine: true });
};
refreshMyMods().catch(() => {});

// ---------- zamykanie okien: klik obok, Esc, ✕ ----------

const OVERLAY_CLOSE = {
  'add-account': () => closeAddAccount(),
  'mymods-dialog': () => closeMyMods(),
  'addons-dialog': () => closeAddons(),
  'players-dialog': () => closePlayers(),
  'skin-dialog': () => closeSkin(),
  changes: () => $('btn-changes-close').click(),
  settings: () => closeSettingsSafely(),
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
function showView(view) {
  $('view-home').classList.toggle('hidden', view !== 'home' || homeStyle === 'scene');
  $('view-scene').classList.toggle('hidden', view !== 'home' || homeStyle !== 'scene');
  $('view-news').classList.toggle('hidden', view !== 'news');
  $('nav-home').classList.toggle('active', view === 'home');
  $('nav-news').classList.toggle('active', view === 'news');
  $('title').textContent = view === 'news' ? 'Aktualności' : '';
  $('title').classList.toggle('hidden', view !== 'news');
}
$('nav-home').onclick = () => showView('home');
$('nav-news').onclick = () => showView('news');
$('news-all').onclick = (e) => { e.preventDefault(); showView('news'); };
$('scene-news-all').onclick = (e) => { e.preventDefault(); showView('news'); };
$('scene-prev').onclick = () => { const t = $('scene-news-track'); t.scrollBy({ left: -t.clientWidth * 0.8, behavior: 'smooth' }); };
$('scene-next').onclick = () => { const t = $('scene-news-track'); t.scrollBy({ left: t.clientWidth * 0.8, behavior: 'smooth' }); };
$('home-mods-open').onclick = (e) => { e.preventDefault(); openMyMods(); };

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

const moreMenu = $('more-menu');
$('btn-more').onclick = (e) => { e.stopPropagation(); moreMenu.classList.toggle('hidden'); };
document.addEventListener('click', (e) => { if (!moreMenu.contains(e.target)) moreMenu.classList.add('hidden'); });
moreMenu.addEventListener('click', (e) => { if (e.target.closest('button')) setTimeout(() => moreMenu.classList.add('hidden'), 0); });
$('btn-more-repair').onclick = () => $('btn-repair').click();
$('btn-more-folder').onclick = () => L.openFolder();
