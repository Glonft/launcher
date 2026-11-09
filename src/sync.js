const fs = require('fs');
const path = require('path');
const { download, sha1File } = require('./download');

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

function safeJoin(base, rel) {
  const abs = path.resolve(base, rel);
  if (!abs.startsWith(path.resolve(base) + path.sep)) {
    throw new Error(`Niedozwolona ścieżka w manifeście: ${rel}`);
  }
  return abs;
}

/**
 * Doprowadza folder gry do stanu z manifestu:
 *  - pobiera brakujące / zmienione pliki (porównanie SHA-1),
 *  - usuwa z "managedDirs" (domyślnie mods/) wszystko, czego nie ma w manifeście.
 */
async function syncModpack(manifest, gameDir, log, progress) {
  const wanted = new Set();
  const toDownload = [];

  for (const f of manifest.files) {
    const dest = safeJoin(gameDir, f.path);
    wanted.add(dest);
    if (fs.existsSync(dest)) {
      if (f.overwrite === false) continue; // np. options.txt – zostawiamy zmiany gracza
      if ((await sha1File(dest)) === f.sha1.toLowerCase()) continue;
    }
    toDownload.push({ ...f, dest });
  }

  for (const dir of manifest.managedDirs || ['mods']) {
    const abs = safeJoin(gameDir, dir);
    if (!fs.existsSync(abs)) continue;
    for (const file of walk(abs)) {
      if (!wanted.has(path.resolve(file))) {
        fs.rmSync(file);
        log(`Usunięto: ${path.relative(gameDir, file)}`);
      }
    }
  }

  let i = 0;
  for (const f of toDownload) {
    i++;
    log(`Pobieranie (${i}/${toDownload.length}): ${f.path}`);
    await download(f.url, f.dest, f.sha1, (d, t) =>
      progress(`Pobieranie ${path.basename(f.path)}`, (i - 1 + (t ? d / t : 0)) / toDownload.length)
    );
  }
  log(toDownload.length ? `Zaktualizowano ${toDownload.length} plików.` : 'Paczka jest aktualna.');
}

module.exports = { syncModpack };
