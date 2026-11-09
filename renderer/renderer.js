const $ = (id) => document.getElementById(id);
const L = window.launcher;

function show(account) {
  $('login').classList.toggle('hidden', !!account);
  $('ready').classList.toggle('hidden', !account);
  if (account) {
    $('player').textContent = account.name;
    $('acc-type').textContent = account.type === 'microsoft' ? 'Konto Microsoft (premium)' : 'Konto non-premium';
  }
}

function addLog(msg) {
  const el = $('log');
  el.textContent += msg + '\n';
  if (el.textContent.length > 20000) el.textContent = el.textContent.slice(-15000);
  el.scrollTop = el.scrollHeight;
}

async function init() {
  const cfg = await L.getConfig();
  document.title = cfg.appName;
  $('title').textContent = cfg.appName;
  $('server').textContent = cfg.server.host;
  $('version').textContent = `v${cfg.version}`;
  show(await L.getAccount());
}

$('btn-ms').onclick = async () => {
  $('login-error').textContent = '';
  try { show(await L.loginMicrosoft()); }
  catch (e) { $('login-error').textContent = 'Logowanie nieudane: ' + (e.message || e); }
};

$('btn-offline').onclick = async () => {
  $('login-error').textContent = '';
  try { show(await L.loginOffline($('nick').value.trim())); }
  catch (e) { $('login-error').textContent = String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''); }
};

$('btn-logout').onclick = async (e) => { e.preventDefault(); await L.logout(); show(null); };
$('btn-folder').onclick = (e) => { e.preventDefault(); L.openFolder(); };

$('btn-play').onclick = () => {
  $('btn-play').disabled = true;
  $('btn-play').textContent = 'URUCHAMIANIE...';
  L.play();
};

L.on('log', addLog);
L.on('progress', ({ label, value }) => {
  $('progress-label').textContent = label;
  $('bar-fill').style.width = `${Math.round((value || 0) * 100)}%`;
});
L.on('state', (s) => {
  $('btn-play').disabled = s === 'running' || s === 'busy';
  $('btn-play').textContent = s === 'running' ? 'GRA URUCHOMIONA' : s === 'busy' ? 'PRZENOSZENIE...' : 'GRAJ';
  if (s === 'idle') { $('progress-label').textContent = 'Gotowy'; $('bar-fill').style.width = '0'; }
});
L.on('error', (msg) => { addLog('BŁĄD: ' + msg); $('progress-label').textContent = 'Błąd: ' + msg; });

// ---------- Ustawienia ----------
const cleanErr = (e) => String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
let pendingDir = null;

function updateRamLabels() {
  const max = Number($('ram-max').value);
  $('ram-min').max = max;
  if (Number($('ram-min').value) > max) $('ram-min').value = max;
  $('ram-max-val').textContent = `${max} GB`;
  $('ram-min-val').textContent = `${$('ram-min').value} GB`;
}

async function openSettings() {
  const { settings: s, system } = await L.getSettings();
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

$('btn-settings-save').onclick = async () => {
  $('settings-error').textContent = '';
  try {
    await L.saveSettings({
      maxRamGB: Number($('ram-max').value),
      minRamGB: Number($('ram-min').value),
      width: Number($('win-w').value),
      height: Number($('win-h').value),
      fullscreen: $('fullscreen').checked,
      afterLaunch: $('after-launch').value,
      jvmArgs: $('jvm-args').value,
    });
    $('settings').classList.add('hidden');
    addLog('Zapisano ustawienia.');
  } catch (e) {
    $('settings-error').textContent = cleanErr(e);
  }
};

init();
