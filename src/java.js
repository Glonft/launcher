const fs = require('fs');
const path = require('path');
const extractZip = require('extract-zip');
const tar = require('tar');
const { download } = require('./download');

const isWin = process.platform === 'win32';

/** Szuka kompletnej Javy (bin/java + lib/jvm.cfg) w podfolderach `dir`. */
function findJavaBin(dir) {
  if (!fs.existsSync(dir)) return null;
  for (const e of fs.readdirSync(dir)) {
    for (const home of [path.join(dir, e), path.join(dir, e, 'Contents', 'Home')]) {
      const bin = path.join(home, 'bin');
      const ok =
        fs.existsSync(path.join(bin, isWin ? 'java.exe' : 'java')) &&
        fs.existsSync(path.join(home, 'lib', 'jvm.cfg'));
      if (ok) return bin;
    }
  }
  return null;
}

/** Zapewnia Javę w wersji `major` (np. 21 dla MC 1.21.x) – pobiera Temurin JRE, jeśli brak. */
async function ensureJava(baseDir, log, progress, major = 21) {
  major = Number(major) || 21;
  const jreDir = path.join(baseDir, 'runtime', `java${major}`);
  let bin = findJavaBin(jreDir);

  if (!bin) {
    // usuń ewentualnie uszkodzoną/niepełną instalację
    fs.rmSync(jreDir, { recursive: true, force: true });

    const osName = { win32: 'windows', linux: 'linux', darwin: 'mac' }[process.platform];
    const arch = { x64: 'x64', arm64: 'aarch64' }[process.arch];
    const ext = isWin ? 'zip' : 'tar.gz';
    const url = `https://api.adoptium.net/v3/binary/latest/${major}/ga/${osName}/${arch}/jre/hotspot/normal/eclipse`;
    const archive = path.join(baseDir, 'runtime', `java${major}.${ext}`);

    log(`Pobieranie Javy ${major}...`);
    await download(url, archive, null, (d, t) => progress('Pobieranie Javy', t ? d / t : 0));
    try {
      fs.mkdirSync(jreDir, { recursive: true });
      log('Rozpakowywanie Javy...');
      if (ext === 'zip') await extractZip(archive, { dir: jreDir });
      else await tar.x({ file: archive, cwd: jreDir });
    } catch (e) {
      fs.rmSync(jreDir, { recursive: true, force: true });
      throw new Error(`Nie udało się rozpakować Javy: ${e.message}`);
    } finally {
      fs.rmSync(archive, { force: true });
    }

    bin = findJavaBin(jreDir);
    if (!bin) {
      fs.rmSync(jreDir, { recursive: true, force: true });
      throw new Error('Java po rozpakowaniu jest niekompletna – spróbuj ponownie.');
    }
    log(`Java ${major} gotowa.`);
  }

  return {
    java: path.join(bin, isWin ? 'java.exe' : 'java'),
    javaw: path.join(bin, isWin ? 'javaw.exe' : 'java'),
  };
}

module.exports = { ensureJava };
