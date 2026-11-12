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
  if ('announcement' in info) {
    const a = info.announcement;
    const box = $('announcement');
    box.classList.toggle('hidden', !(a && a.text));
    box.classList.toggle('warn', !!(a && a.level === 'warn'));
    box.textContent = (a && a.text) || '';
  }
  if ('requiredLauncher' in info) {
    const box = $('launcher-outdated');
    box.classList.toggle('hidden', !info.requiredLauncher);
    box.textContent = info.requiredLauncher
      ? `Ten serwer wymaga launchera ${info.requiredLauncher} lub nowszego. Zaktualizuj launcher, żeby zagrać.`
      : '';
    if (info.requiredLauncher) L.getUpdate().then(showUpdate).catch(() => {});
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

async function openSkin() {
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
  if (!preview) {
    preview = new SkinPreview($('skin-viewer'));
    if (!preview.is3d) $('viewer-hint').textContent = 'Podgląd 2D (3D niedostępne)';
  }
  try {
    skinData = await L.getSkin();
    $('skin-name').textContent = skinData.name;
    setVariant(skinData.variant);
    renderCapes();
    refreshPreview();
    $('skin-hint').textContent = skinData.offline
      ? 'Konto non-premium: skin zobaczą wszyscy na serwerze MelinaSMP. Po kliknięciu „Zapisz zmiany” wkleisz w grze jedną komendę. Peleryny są dostępne tylko dla kont premium.'
      : 'Zmiany dotyczą całego Twojego konta Minecraft (tak jak w oficjalnym launcherze). Na serwerze zobaczysz je po ponownym wejściu.';
    $('btn-skin-reset').textContent = skinData.offline ? 'Przywróć domyślnego skina (komenda)' : 'Przywróć domyślnego skina';
    showCommand(skinData.offline ? skinData.command : null);
    $('skin-status').textContent = '';
  } catch (e) {
    $('skin-status').textContent = '';
    $('skin-error').textContent = cleanErr(e);
  }
}
$('btn-skin-copy').onclick = async () => {
  try { await L.copySkinCommand(); $('btn-skin-copy').textContent = '✔ Skopiowano'; setTimeout(() => { $('btn-skin-copy').textContent = '📋 Kopiuj komendę'; }, 1500); }
  catch (e) { $('skin-error').textContent = cleanErr(e); }
};

$('btn-skin').onclick = openSkin;
$('btn-skin-close').onclick = () => $('skin-dialog').classList.add('hidden');
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
  $('ram-min').max = max;
  if (Number($('ram-min').value) > max) $('ram-min').value = max;
  $('ram-max-val').textContent = `${max} GB`;
  $('ram-min-val').textContent = `${$('ram-min').value} GB`;
}

function fmtBytes(n) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1).replace('.', ',')} GB`;
  if (n >= 1e6) return `${Math.round(n / 1e6)} MB`;
  return `${Math.max(1, Math.round(n / 1e3))} KB`;
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
    const info = el('div', {}, el('div', { textContent: g.name + (g.size ? `  ·  ${fmtBytes(g.size)}` : '') }),
      el('div', { className: 'desc', textContent: g.description }));
    if (g.replacesData) {
      info.append(el('div', { className: 'desc warn-text', textContent:
        'Zastąpi Twoje obecne dane tego dodatku (kopia zostanie zachowana jako plik .kopia). Pobiera się w tle – możesz grać w trakcie.' }));
    }
    box.append(el('label', { className: 'addon check' }, cb, info));
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
  $('title').textContent = a.appName;
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
}
init();

// ---------- Moje mody ----------

const fmtDl = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1).replace('.', ',')} mln` : n >= 1e3 ? `${Math.round(n / 1e3)} tys.` : String(n));
let myMods = [];

function mmItem(icon, title, sub, actions, cls = '') {
  return el('div', { className: `mm-item ${cls}` },
    icon ? el('img', { src: icon, alt: '' }) : el('div', { className: 'mm-noicon' }),
    el('div', {}, title, el('div', { className: 'mm-sub', textContent: sub })),
    el('div', { className: 'mm-actions' }, ...actions));
}
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
  const on = myMods.filter((m) => m.enabled).length;
  $('mymods-count').textContent = myMods.length ? `(${on})` : '';
  $('btn-play-clean').classList.toggle('hidden', !on);
  const box = $('mymods-list');
  if (!myMods.length) { box.replaceChildren(el('p', { className: 'hint', textContent: 'Nie masz jeszcze własnych modów.' })); return; }
  box.replaceChildren(...myMods.map((m) => {
    const title = el('div', { className: 'mm-title', textContent: m.name });
    if (m.source === 'dysk') title.append(el('span', { className: 'mm-tag disk', textContent: 'z dysku' }));
    if (!m.enabled) title.append(el('span', { className: 'mm-tag', textContent: 'wyłączony' }));
    const sub = [m.version, (m.requiredBy || []).length ? `wymagany przez: ${m.requiredBy.map((r) => (myMods.find((x) => x.id === r) || {}).name || r).join(', ')}` : ''].filter(Boolean).join(' · ');
    return mmItem(m.icon, title, sub, [
      mmBtn(m.enabled ? 'Wyłącz' : 'Włącz', 'small-btn', async () => { await L.myModsToggle(m.id, !m.enabled); await refreshMyMods(); }),
      mmBtn('Usuń', 'small-btn', async () => { await L.myModsRemove(m.id); await refreshMyMods(); }),
    ], m.enabled ? '' : 'off');
  }));
}

async function openMyMods() {
  $('mymods-msg').textContent = '';
  $('mymods-results').replaceChildren();
  $('mymods-updates').replaceChildren();
  $('mymods-dialog').classList.remove('hidden');
  await refreshMyMods().catch((e) => { $('mymods-msg').textContent = cleanErr(e); });
  $('mymods-q').focus();
}

async function searchMyMods() {
  const q = $('mymods-q').value.trim();
  const box = $('mymods-results');
  $('mymods-msg').textContent = '';
  box.replaceChildren(el('p', { className: 'hint', textContent: 'Szukam…' }));
  try {
    const hits = await L.myModsSearch(q);
    const have = new Set(myMods.map((m) => m.projectId));
    box.replaceChildren(...(hits.length ? hits.map((h) => mmItem(h.icon,
      el('div', { className: 'mm-title', textContent: h.title }),
      `${h.description} · ${fmtDl(h.downloads)} pobrań`,
      [have.has(h.id) ? el('span', { className: 'mm-tag', textContent: 'dodany' }) : mmBtn('Dodaj', 'primary-sm', async () => {
        const added = await L.myModsAddModrinth(h.id);
        $('mymods-msg').textContent = added.length > 1 ? `Dodano: ${added.join(', ')}` : `Dodano: ${added[0] || h.title}`;
        await refreshMyMods();
        searchMyMods();
      })]))
      : [el('p', { className: 'hint', textContent: 'Nic nie znaleziono. Spróbuj innej nazwy (najlepiej po angielsku).' })]));
  } catch (e) { box.replaceChildren(); $('mymods-msg').textContent = cleanErr(e); }
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
$('btn-mymods-close').onclick = () => $('mymods-dialog').classList.add('hidden');
$('btn-mymods-search').onclick = searchMyMods;
$('mymods-q').addEventListener('keydown', (e) => { if (e.key === 'Enter') searchMyMods(); });
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
