const fs = require('fs');
const os = require('os');
const path = require('path');

const GB = 1024 ** 3;

/** Ustawienia gracza zapisywane w userData/settings.json. */
class SettingsStore {
  constructor(file, defaults) {
    this.file = file;
    this.defaults = defaults;
  }

  static systemInfo() {
    const totalGB = Math.floor((os.totalmem() / GB) * 2) / 2; // w krokach 0,5 GB
    return { totalRamGB: totalGB, maxAllowedRamGB: Math.max(2, totalGB - 1.5) };
  }

  get() {
    let saved = {};
    try { saved = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { /* brak pliku */ }
    return { ...this.defaults, ...saved };
  }

  /** Waliduje i zapisuje; zwraca zapisane ustawienia albo rzuca błąd z opisem. */
  set(input) {
    const cur = this.get();
    const s = { ...cur, ...input };
    const { maxAllowedRamGB } = SettingsStore.systemInfo();

    s.maxRamGB = Number(s.maxRamGB);
    s.minRamGB = Number(s.minRamGB);
    if (!(s.maxRamGB >= 2)) throw new Error('Maksymalny RAM musi wynosić co najmniej 2 GB.');
    if (s.maxRamGB > maxAllowedRamGB) throw new Error(`Maksymalny RAM może wynosić najwyżej ${maxAllowedRamGB} GB (zostaw trochę dla systemu).`);
    if (!(s.minRamGB >= 1)) s.minRamGB = 1;
    if (s.minRamGB > s.maxRamGB) s.minRamGB = s.maxRamGB;

    s.width = Math.round(Number(s.width)) || 1280;
    s.height = Math.round(Number(s.height)) || 720;
    if (s.width < 640 || s.height < 480) throw new Error('Minimalna rozdzielczość okna to 640×480.');
    s.fullscreen = !!s.fullscreen;

    if (!['minimize', 'keep', 'close'].includes(s.afterLaunch)) s.afterLaunch = 'minimize';
    s.jvmArgs = String(s.jvmArgs || '').trim();

    const addons = {};
    for (const [k, v] of Object.entries(s.addons || {})) {
      if (/^[a-z0-9_-]{1,40}$/i.test(k)) addons[k] = !!v;
    }
    s.addons = addons;

    s.gameDir = path.resolve(String(s.gameDir || this.defaults.gameDir));

    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(s, null, 2));
    return s;
  }
}

/** Czy folder jest pusty (albo nie istnieje). */
function isEmptyDir(dir) {
  try { return fs.readdirSync(dir).length === 0; } catch { return true; }
}

/** Czy `child` leży wewnątrz `parent` (lub jest nim). */
function isInside(child, parent) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

module.exports = { SettingsStore, isEmptyDir, isInside };
