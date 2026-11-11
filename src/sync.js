const fs = require('fs');
const path = require('path');
const { download, sha1File } = require('./download');
const seed = require('./seed');

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

/** Które dodatki opcjonalne są włączone (ustawienie gracza albo domyślne z paczki). */
function enabledAddons(manifest, choices = {}) {
  return (manifest.optional || []).filter((g) => (g.id in choices ? !!choices[g.id] : !!g.default));
}

/**
 * Doprowadza folder gry do stanu z manifestu:
 *  - pobiera brakujące / zmienione pliki (porównanie SHA-1),
 *  - usuwa z "managedDirs" (domyślnie mods/) wszystko, czego nie ma w manifeście,
 *  - dodatki opcjonalne: włączone pobiera, wyłączone usuwa,
 *  - duże pliki „seed” wgrywa, jeśli są już pobrane; zwraca listę tych do pobrania w tle.
 */
async function syncModpack(manifest, gameDir, log, progress, addonChoices = {}) {
  const enabled = enabledAddons(manifest, addonChoices);
  const enabledIds = new Set(enabled.map((g) => g.id));
  // pliki „seed” (np. teren Distant Horizons) obsługuje osobno seed.js
  const files = [...manifest.files, ...enabled.flatMap((g) => g.files.filter((f) => !f.seed))];

  const wanted = new Set();
  const toDownload = [];

  for (const f of files) {
    const dest = safeJoin(gameDir, f.path);
    wanted.add(dest);
    if (fs.existsSync(dest)) {
      if (f.overwrite === false) continue; // np. options.txt – zostawiamy zmiany gracza
      if ((await sha1File(dest)) === f.sha1.toLowerCase()) continue;
    }
    toDownload.push({ ...f, dest });
  }

  // wyłączone dodatki – usuń ich pliki (także spoza managedDirs, np. shaderpacks/)
  for (const g of manifest.optional || []) {
    if (enabledIds.has(g.id)) continue;
    for (const f of g.files) {
      if (f.seed) continue; // dane gracza (np. teren DH) zostają po wyłączeniu dodatku
      const dest = safeJoin(gameDir, f.path);
      if (!wanted.has(dest) && fs.existsSync(dest)) {
        fs.rmSync(dest);
        log(`Wyłączony dodatek „${g.name}”: usunięto ${f.path}`);
      }
    }
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

  seed.cleanupDisabled(manifest, enabledIds, gameDir, safeJoin, log);
  return seed.applyReady(seed.seedFiles(enabled, gameDir, safeJoin), gameDir, log);
}

module.exports = { syncModpack, enabledAddons };
