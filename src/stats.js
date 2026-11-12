// Krótka informacja dla adminów: nick, wersja launchera, system i włączone dodatki.
// Bez IP i bez niczego z komputera gracza. Gdy serwer statystyk nie odpowiada – po cichu nic.
const os = require('os');

let lastSent = 0;

function kind() {
  if (process.env.PORTABLE_EXECUTABLE_FILE) return 'portable';
  if (process.env.APPIMAGE) return 'appimage';
  return 'installer';
}

function system() {
  return { win32: 'windows', linux: 'linux', darwin: 'mac' }[os.platform()] || 'inny';
}

/**
 * @param {string} url  adres z config.json (statsUrl)
 * @param {object} d    { account: {name,type}|null, version, addons: [id] }
 */
async function sendHello(url, d, { force = false } = {}) {
  if (!url || !d.account || !d.account.name) return;
  if (!force && Date.now() - lastSent < 10 * 60 * 1000) return; // nie częściej niż co 10 min
  lastSent = Date.now();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 5000);
  try {
    await fetch(url, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'melinasmp-launcher' },
      body: JSON.stringify({
        nick: d.account.name,
        account: d.account.type === 'microsoft' ? 'premium' : 'non-premium',
        version: d.version,
        kind: kind(),
        os: system(),
        addons: d.addons || [],
      }),
    });
  } catch { /* brak połączenia z serwerem statystyk – bez znaczenia dla gracza */ }
  finally { clearTimeout(t); }
}

module.exports = { sendHello };
