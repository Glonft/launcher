const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { download } = require('./download');

/**
 * Samoaktualizacja wersji portable (electron-updater jej nie obsługuje).
 * electron-builder uruchamia portable z folderu tymczasowego i podaje ścieżkę
 * oryginalnego pliku w PORTABLE_EXECUTABLE_FILE.
 */
const ASSET = 'MelinaSMP-Launcher-Portable.exe';

function isPortable() {
  return process.platform === 'win32' && !!process.env.PORTABLE_EXECUTABLE_FILE;
}

/** "0.10.2" > "0.9.9" */
function newer(a, b) {
  const pa = String(a).replace(/^v/, '').split('.').map(Number);
  const pb = String(b).replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return x > y;
  }
  return false;
}

function canWrite(dir) {
  try {
    const probe = path.join(dir, `.melinasmp-write-test-${process.pid}`);
    fs.writeFileSync(probe, '');
    fs.rmSync(probe);
    return true;
  } catch { return false; }
}

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(file).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });
}

class PortableUpdater {
  /** @param {{owner:string, repo:string, currentVersion:string, onState:(s:object)=>void, downloadsDir:string}} o */
  constructor(o) {
    this.o = o;
    this.exe = process.env.PORTABLE_EXECUTABLE_FILE;
    this.ready = null; // { version, file, inPlace }
  }

  /** Sprawdza, czy jest nowa wersja (bez pobierania). */
  async check() {
    const { owner, repo, currentVersion, onState } = this.o;
    onState({ state: 'checking' });
    try {
      const res = await fetch(`${this.o.apiBase || 'https://api.github.com'}/repos/${owner}/${repo}/releases/latest`, {
        headers: { 'User-Agent': 'melinasmp-launcher', Accept: 'application/vnd.github+json' },
      });
      if (!res.ok) throw new Error(`GitHub HTTP ${res.status}`);
      const rel = await res.json();
      const version = String(rel.tag_name || '').replace(/^v/, '');
      if (!newer(version, currentVersion)) return onState({ state: 'latest' });
      this.available = version;
      return onState({ state: 'available', version });
    } catch (e) {
      return onState({ state: 'error', error: e.message || String(e) });
    }
  }

  /** Pobiera najnowszą wersję (po kliknięciu „Zaktualizuj”). */
  async download() {
    const { owner, repo, currentVersion, onState } = this.o;
    try {
      const res = await fetch(`${this.o.apiBase || 'https://api.github.com'}/repos/${owner}/${repo}/releases/latest`, {
        headers: { 'User-Agent': 'melinasmp-launcher', Accept: 'application/vnd.github+json' },
      });
      if (!res.ok) throw new Error(`GitHub HTTP ${res.status}`);
      const rel = await res.json();
      const version = String(rel.tag_name || '').replace(/^v/, '');
      if (!newer(version, currentVersion)) return onState({ state: 'latest' });

      const asset = (rel.assets || []).find((a) => a.name === ASSET);
      if (!asset) throw new Error('W wydaniu brak pliku wersji portable.');
      const sha256 = /^sha256:([0-9a-f]{64})$/i.exec(asset.digest || '');

      // Pobieramy obok obecnego pliku; jeśli folder jest tylko do odczytu – do Pobranych.
      const dir = path.dirname(this.exe);
      const inPlace = canWrite(dir);
      const target = inPlace
        ? path.join(dir, `${path.basename(this.exe, '.exe')}.new.exe`)
        : path.join(this.o.downloadsDir, `MelinaSMP-Launcher-Portable-${version}.exe`);

      onState({ state: 'downloading', version, percent: 0 });
      await download(asset.browser_download_url, target, null, (d, t) =>
        onState({ state: 'downloading', version, percent: t ? Math.round((d / t) * 100) : 0 })
      );
      if (sha256 && (await sha256File(target)) !== sha256[1].toLowerCase()) {
        fs.rmSync(target, { force: true });
        throw new Error('Pobrana aktualizacja ma zły hash – spróbuję później.');
      }

      this.ready = { version, file: target, inPlace };
      onState(inPlace
        ? { state: 'ready', version }
        : { state: 'manual', version, file: target });
    } catch (e) {
      onState({ state: 'error', error: e.message || String(e) });
    }
  }

  /**
   * Zamyka launcher; pomocniczy skrypt czeka na jego zamknięcie,
   * podmienia plik i uruchamia nową wersję.
   */
  install(quit) {
    if (!this.ready || !this.ready.inPlace) return false;
    const { file } = this.ready;
    const exe = this.exe;
    const script = path.join(os.tmpdir(), `melinasmp-update-${Date.now()}.cmd`);
    const q = (s) => `"${s}"`;
    fs.writeFileSync(script, [
      '@echo off',
      'chcp 65001 >nul',
      'set /a tries=0',
      ':wait',
      `tasklist /FI "PID eq ${process.pid}" | find "${process.pid}" >nul`,
      'if not errorlevel 1 (timeout /t 1 /nobreak >nul & goto wait)',
      ':move',
      `move /y ${q(file)} ${q(exe)} >nul`,
      'if errorlevel 1 (',
      '  set /a tries+=1',
      '  if %tries% lss 15 (timeout /t 1 /nobreak >nul & goto move)',
      ')',
      `start "" ${q(exe)}`,
      '(goto) 2>nul & del "%~f0"',
      '',
    ].join('\r\n'), 'utf8');

    spawn('cmd.exe', ['/c', script], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    quit();
    return true;
  }
}

module.exports = { PortableUpdater, isPortable, newer, ASSET };
