const $ = (id) => document.getElementById(id);
const L = window.launcher;
const cleanErr = (e) => String((e && e.message) || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
const el = (tag, props = {}, ...children) => {
  const n = Object.assign(document.createElement(tag), props);
  for (const c of children) n.append(c);
  return n;
};
const headUrl = (name) => `https://mc-heads.net/avatar/${encodeURIComponent(name)}/36`;

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
    $('server-addr').textContent = srv.port === 25565 ? srv.host : `${srv.host}:${srv.port}`;
  }
  if (!Array.isArray(info.news)) return;
  const list = $('news-list');
  list.replaceChildren();
  if (!info.news || !info.news.length) {
    list.append(el('p', { className: 'muted', textContent: 'Brak aktualności.' }));
    return;
  }
  for (const n of info.news) {
    const h = el('h4');
    if (n.date) h.append(el('span', { className: 'date', textContent: n.date }));
    h.append(n.title || '');
    list.append(el('div', { className: 'news-item' }, h, el('p', { textContent: n.body || '' })));
  }
}

// ---------- status serwera ----------
async function refreshStatus() {
  $('btn-ping').disabled = true;
  try {
    const r = await L.pingServer();
    if (r.server) showInfo({ server: r.server, news: null });
    const dot = $('status-dot');
    const list = $('players-list');
    list.replaceChildren();
    if (r.online) {
      dot.className = 'dot on';
      dot.title = `Online${r.version ? ' – ' + r.version : ''}`;
      $('players-count').textContent = `${r.players.online}/${r.players.max}`;
      $('ping-ms').textContent = `${r.latency} ms`;
      for (const name of r.players.names) {
        const img = el('img', { src: headUrl(name), alt: '' });
        img.onerror = () => img.remove();
        list.append(el('span', { className: 'chip' }, img, name));
      }
      const hidden = r.players.online - r.players.names.length;
      if (hidden > 0) list.append(el('span', { className: 'chip muted', textContent: `+${hidden} więcej` }));
      if (r.players.online === 0) list.append(el('span', { className: 'muted small', textContent: 'Nikogo nie ma – bądź pierwszy!' }));
    } else {
      dot.className = 'dot off';
      dot.title = r.error || 'Offline';
      $('players-count').textContent = '–';
      $('ping-ms').textContent = '–';
      list.append(el('span', { className: 'muted small', textContent: `Serwer offline${r.error ? ` (${r.error})` : ''}` }));
    }
  } catch (e) {
    $('status-dot').className = 'dot off';
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
  $('btn-skin').classList.toggle('hidden', a.type !== 'microsoft');
  $('acc-type').textContent = a.type === 'microsoft' ? 'Konto Microsoft (premium)' : 'Konto non-premium';
  const av = $('avatar');
  av.textContent = '';
  av.style.backgroundImage = `url("${headUrl(a.name)}")`;

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
$('btn-add-cancel').onclick = () => $('add-account').classList.add('hidden');
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

// ---------- skin ----------
let pickedSkin = null;

/** Rysuje postać od przodu z pliku skina (64×64 lub stary 64×32). */
function drawSkin(canvas, dataUrl, slim) {
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!dataUrl) return;
  const img = new Image();
  img.onload = () => {
    const legacy = img.height === 32;
    const aw = slim ? 3 : 4;
    const part = (sx, sy, w, h, dx, dy, mirror = false) => {
      if (!mirror) return ctx.drawImage(img, sx, sy, w, h, dx, dy, w, h);
      ctx.save();
      ctx.scale(-1, 1);
      ctx.drawImage(img, sx, sy, w, h, -dx - w, dy, w, h);
      ctx.restore();
    };
    ctx.clearRect(0, 0, 16, 32);
    // warstwa podstawowa
    part(8, 8, 8, 8, 4, 0);                       // głowa
    part(20, 20, 8, 12, 4, 8);                    // tułów
    part(44, 20, aw, 12, 4 - aw, 8);              // prawa ręka
    if (legacy) part(44, 20, aw, 12, 12, 8, true); else part(36, 52, aw, 12, 12, 8); // lewa ręka
    part(4, 20, 4, 12, 4, 20);                    // prawa noga
    if (legacy) part(4, 20, 4, 12, 8, 20, true); else part(20, 52, 4, 12, 8, 20);    // lewa noga
    // druga warstwa (czapka, kurtka, rękawy, spodnie)
    part(40, 8, 8, 8, 4, 0);
    if (!legacy) {
      part(20, 36, 8, 12, 4, 8);
      part(44, 36, aw, 12, 4 - aw, 8);
      part(52, 52, aw, 12, 12, 8);
      part(4, 36, 4, 12, 4, 20);
      part(4, 52, 4, 12, 8, 20);
    }
  };
  img.src = dataUrl;
}

const variant = () => document.querySelector('input[name=variant]:checked').value;
function setVariant(v) { document.querySelector(`input[name=variant][value=${v}]`).checked = true; }

async function openSkin() {
  pickedSkin = null;
  $('skin-error').textContent = '';
  $('skin-status').textContent = 'Wczytywanie obecnego skina…';
  $('btn-skin-set').disabled = true;
  $('skin-new-caption').textContent = 'Nowy (wybierz plik)';
  drawSkin($('skin-new'), null);
  drawSkin($('skin-current'), null);
  $('skin-name').textContent = accountsState.active ? accountsState.active.name : '';
  $('skin-dialog').classList.remove('hidden');
  try {
    const s = await L.getSkin();
    $('skin-name').textContent = s.name;
    setVariant(s.variant);
    drawSkin($('skin-current'), s.dataUrl, s.variant === 'slim');
    $('skin-status').textContent = '';
  } catch (e) {
    $('skin-status').textContent = '';
    $('skin-error').textContent = cleanErr(e);
  }
}

$('btn-skin').onclick = openSkin;
$('btn-skin-close').onclick = () => $('skin-dialog').classList.add('hidden');
$('btn-skin-pick').onclick = async () => {
  $('skin-error').textContent = '';
  try {
    const f = await L.pickSkin();
    if (!f) return;
    pickedSkin = f;
    drawSkin($('skin-new'), f.dataUrl, variant() === 'slim');
    $('skin-new-caption').textContent = `Nowy (${f.width}×${f.height})`;
    $('btn-skin-set').disabled = false;
  } catch (e) { $('skin-error').textContent = cleanErr(e); }
};
for (const r of document.querySelectorAll('input[name=variant]')) {
  r.onchange = () => { if (pickedSkin) drawSkin($('skin-new'), pickedSkin.dataUrl, variant() === 'slim'); };
}
$('btn-skin-set').onclick = async () => {
  $('skin-error').textContent = '';
  $('btn-skin-set').disabled = true;
  $('skin-status').textContent = 'Wysyłanie skina…';
  try {
    const s = await L.setSkin(pickedSkin.path, variant());
    drawSkin($('skin-current'), s.dataUrl, s.variant === 'slim');
    $('skin-status').textContent = '✔ Skin zmieniony! Wejdź ponownie na serwer, żeby go zobaczyć.';
    pickedSkin = null;
    drawSkin($('skin-new'), null);
    $('skin-new-caption').textContent = 'Nowy (wybierz plik)';
    renderAccounts(await L.getAccounts()); // odświeża główkę
  } catch (e) {
    $('skin-status').textContent = '';
    $('skin-error').textContent = cleanErr(e);
    $('btn-skin-set').disabled = false;
  }
};
$('btn-skin-reset').onclick = async () => {
  if (!confirm('Przywrócić domyślnego skina (Steve/Alex)?')) return;
  $('skin-error').textContent = '';
  try {
    const s = await L.resetSkin();
    drawSkin($('skin-current'), s.dataUrl, s.variant === 'slim');
    $('skin-status').textContent = '✔ Przywrócono domyślnego skina.';
  } catch (e) { $('skin-error').textContent = cleanErr(e); }
};

// ---------- granie ----------
function updatePlayButton() {
  const b = $('btn-play');
  const labels = { idle: 'GRAJ', preparing: 'PRZYGOTOWANIE…', running: 'GRA URUCHOMIONA', busy: 'PROSZĘ CZEKAĆ…' };
  b.textContent = labels[appState] || 'GRAJ';
  b.disabled = appState !== 'idle' || !accountsState.active;
  $('btn-repair').disabled = appState !== 'idle';
}
$('btn-play').onclick = () => { appState = 'preparing'; updatePlayButton(); L.play(); };

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
  const btn = $('btn-update-install');
  btn.classList.add('hidden');
  $('btn-update-show').classList.add('hidden');
  bar.classList.remove('hidden');
  switch (u.state) {
    case 'downloading': txt.textContent = `Pobieranie aktualizacji ${u.version || ''}… ${u.percent || 0}%`; break;
    case 'ready': txt.textContent = `Nowa wersja ${u.version} gotowa`; btn.classList.remove('hidden'); break;
    case 'manual': txt.textContent = `Wersja ${u.version} pobrana do folderu Pobrane`; $('btn-update-show').classList.remove('hidden'); break;
    default: bar.classList.add('hidden');
  }
  const info = {
    checking: 'Sprawdzanie aktualizacji…', latest: 'Masz najnowszą wersję launchera.',
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
$('btn-update-install').onclick = async () => {
  try { await L.installUpdate(); } catch (e) { addLog('BŁĄD: ' + cleanErr(e)); }
};
$('btn-check-update').onclick = () => L.checkUpdate();
$('btn-update-show').onclick = () => L.showUpdateFile();

// ---------- ustawienia ----------
let pendingDir = null;

function updateRamLabels() {
  const max = Number($('ram-max').value);
  $('ram-min').max = max;
  if (Number($('ram-min').value) > max) $('ram-min').value = max;
  $('ram-max-val').textContent = `${max} GB`;
  $('ram-min-val').textContent = `${$('ram-min').value} GB`;
}

function renderAddons(optional, choices) {
  const box = $('addons-list');
  box.replaceChildren();
  if (!optional.length) {
    box.append(el('p', { className: 'hint', textContent: 'Paczka nie ma jeszcze dodatków do wyboru.' }));
    return;
  }
  for (const g of optional) {
    const cb = el('input', { type: 'checkbox', checked: g.id in choices ? !!choices[g.id] : g.default });
    cb.dataset.addon = g.id;
    box.append(el('label', { className: 'addon check' }, cb,
      el('div', {}, el('div', { textContent: g.name }), el('div', { className: 'desc', textContent: g.description }))));
  }
}

async function openSettings() {
  const { settings: s, system, optional } = await L.getSettings();
  $('ram-max').max = system.maxAllowedRamGB;
  $('ram-max').value = s.maxRamGB;
  $('ram-min').value = s.minRamGB;
  $('ram-hint').textContent = `Twój komputer ma ${system.totalRamGB} GB RAM. Dla tej paczki zalecane 6–8 GB.`;
  updateRamLabels();
  $('win-w').value = s.width;
  $('win-h').value = s.height;
  $('fullscreen').checked = s.fullscreen;
  $('win-w').disabled = $('win-h').disabled = s.fullscreen;
  $('after-launch').value = s.afterLaunch;
  $('game-dir').value = s.gameDir;
  $('jvm-args').value = s.jvmArgs;
  renderAddons(optional, s.addons || {});
  renderAccounts(await L.getAccounts());
  $('settings-error').textContent = '';
  hideDirChange();
  $('settings').classList.remove('hidden');
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
$('btn-settings-cancel').onclick = () => $('settings').classList.add('hidden');
$('ram-max').oninput = updateRamLabels;
$('ram-min').oninput = updateRamLabels;
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
  const addons = {};
  for (const cb of document.querySelectorAll('[data-addon]')) addons[cb.dataset.addon] = cb.checked;
  try {
    await L.saveSettings({
      maxRamGB: Number($('ram-max').value),
      minRamGB: Number($('ram-min').value),
      width: Number($('win-w').value),
      height: Number($('win-h').value),
      fullscreen: $('fullscreen').checked,
      afterLaunch: $('after-launch').value,
      jvmArgs: $('jvm-args').value,
      addons,
    });
    $('settings').classList.add('hidden');
    addLog('Zapisano ustawienia.');
  } catch (e) {
    $('settings-error').textContent = cleanErr(e);
  }
};

// ---------- start ----------
async function init() {
  const a = await L.getApp();
  document.title = a.appName;
  $('title').textContent = a.appName;
  $('version-info').dataset.version = a.version;
  if (a.portable) $('version-info').dataset.portable = '1';
  renderVersionInfo();
  showInfo(a.info);
  renderAccounts(await L.getAccounts());
  showUpdate(await L.getUpdate());
  showInfo(await L.refreshInfo()); // świeże newsy/adres z sieci
  refreshStatus();
  setInterval(refreshStatus, 60 * 1000);
}
init();
