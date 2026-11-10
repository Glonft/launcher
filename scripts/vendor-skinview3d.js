// Kopiuje gotowy plik biblioteki skinview3d (podgląd 3D skina) do renderer/vendor/.
// Uruchamiane automatycznie po `npm install` (postinstall). Przy budowaniu na GitHubie
// brak pliku przerywa budowanie, żeby nie wydać launchera bez podglądu 3D.
const fs = require('fs');
const path = require('path');

const pkgDir = path.join(__dirname, '..', 'node_modules', 'skinview3d');
const out = path.join(__dirname, '..', 'renderer', 'vendor', 'skinview3d.js');
const strict = !!process.env.CI;

function walk(dir) {
  let res = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory() && e.name !== 'node_modules') res = res.concat(walk(p));
    else if (e.isFile()) res.push(p);
  }
  return res;
}

if (!fs.existsSync(pkgDir)) {
  const msg = 'skinview3d nie jest zainstalowany – launcher użyje podglądu 2D.';
  if (strict) { console.error('BŁĄD: ' + msg); process.exit(1); }
  console.warn(msg);
  process.exit(0);
}

const preferred = ['bundles/skinview3d.bundle.js', 'bundles/skinview3d.min.js'];
let found = preferred.map((p) => path.join(pkgDir, p)).find((p) => fs.existsSync(p));
if (!found) found = walk(pkgDir).find((p) => /skinview3d[^/\\]*bundle[^/\\]*\.js$/.test(p));
if (!found) {
  console.error('BŁĄD: nie znaleziono pliku bundle w paczce skinview3d.');
  process.exit(strict ? 1 : 0);
}

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.copyFileSync(found, out);
const version = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8')).version;
console.log(`skinview3d ${version}: ${path.relative(pkgDir, found)} → renderer/vendor/skinview3d.js`);
