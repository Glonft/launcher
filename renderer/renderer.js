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
  $('btn-play').disabled = s === 'running';
  $('btn-play').textContent = s === 'running' ? 'GRA URUCHOMIONA' : 'GRAJ';
  if (s === 'idle') { $('progress-label').textContent = 'Gotowy'; $('bar-fill').style.width = '0'; }
});
L.on('error', (msg) => { addLog('BŁĄD: ' + msg); $('progress-label').textContent = 'Błąd: ' + msg; });

init();
