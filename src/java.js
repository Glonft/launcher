const fs = require('fs');
const path = require('path');
const extractZip = require('extract-zip');
const tar = require('tar');
const { download } = require('./download');

const isWin = process.platform === 'win32';

function findJavaBin(dir) {
  if (!fs.existsSync(dir)) return null;
  for (const e of fs.readdirSync(dir)) {
    for (const sub of ['bin', path.join('Contents', 'Home', 'bin')]) {
      const bin = path.join(dir, e, sub);
      if (fs.existsSync(path.join(bin, isWin ? 'java.exe' : 'java'))) return bin;
    }
  }
  return null;
}

/** Zapewnia Javę 21 (wymaganą przez MC 1.21.1) – pobiera Temurin JRE, jeśli brak. */
async function ensureJava(baseDir, log, progress) {
  const jreDir = path.join(baseDir, 'runtime', 'java21');
  let bin = findJavaBin(jreDir);

  if (!bin) {
    const osName = { win32: 'windows', linux: 'linux', darwin: 'mac' }[process.platform];
    const arch = { x64: 'x64', arm64: 'aarch64' }[process.arch];
    const ext = isWin ? 'zip' : 'tar.gz';
    const url = `https://api.adoptium.net/v3/binary/latest/21/ga/${osName}/${arch}/jre/hotspot/normal/eclipse`;
    const archive = path.join(baseDir, 'runtime', `java21.${ext}`);

    log('Pobieranie Javy 21...');
    await download(url, archive, null, (d, t) => progress('Pobieranie Javy', t ? d / t : 0));
    fs.mkdirSync(jreDir, { recursive: true });
    if (ext === 'zip') await extractZip(archive, { dir: jreDir });
    else await tar.x({ file: archive, cwd: jreDir });
    fs.rmSync(archive, { force: true });

    bin = findJavaBin(jreDir);
    if (!bin) throw new Error('Nie udało się rozpakować Javy.');
  }

  return {
    java: path.join(bin, isWin ? 'java.exe' : 'java'),
    javaw: path.join(bin, isWin ? 'javaw.exe' : 'java'),
  };
}

module.exports = { ensureJava };
