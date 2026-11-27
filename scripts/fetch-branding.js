// Przy budowaniu: nazwa i ikona launchera z panelu (Wygląd launchera).
// Ikona → build/icon.png (plik .exe, skrót, instalator), nazwa → productName i nazwy plików w package.json.
// Dane graczy zostają w starym folderze (main.js przypina userData), a appId się nie zmienia,
// więc instalator podmienia starą wersję zamiast instalować drugą obok.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config.json'), 'utf8'));

function applyName(raw) {
  const name = typeof raw === 'string' ? raw.replace(/[^\p{L}\p{N} ._'!-]/gu, '').trim().slice(0, 40) : '';
  if (!name) { console.log('Panel nie ma własnej nazwy – zostaje „MelinaSMP Launcher”.'); return; }
  const file = path.join(__dirname, '..', 'package.json');
  const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
  const slug = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ł/g, 'l').replace(/Ł/g, 'L').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'Launcher';
  pkg.productName = name;
  pkg.build.productName = name;
  for (const k of ['nsis', 'win', 'portable', 'linux', 'appImage']) {
    const t = pkg.build[k];
    if (t && t.artifactName) t.artifactName = t.artifactName.replace(/^MelinaSMP-Launcher/, slug);
  }
  fs.writeFileSync(file, JSON.stringify(pkg, null, 2));
  console.log(`Nazwa z panelu: „${name}” (pliki: ${slug}-…)`);
}

(async () => {
  const res = await fetch(config.manifestUrl, { headers: { 'Cache-Control': 'no-cache' } });
  if (!res.ok) throw new Error(`manifest: HTTP ${res.status}`);
  const m = await res.json();
  applyName(m.appearance && m.appearance.appName);
  const icon = m.appearance && m.appearance.icon;
  if (!icon || !/^https:\/\//.test(icon.url || '') || !/^[0-9a-f]{40}$/i.test(icon.sha1 || '')) {
    console.log('Panel nie ma własnej ikony – zostaje domyślna.');
    return;
  }
  const r = await fetch(icon.url);
  if (!r.ok) throw new Error(`ikona: HTTP ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (crypto.createHash('sha1').update(buf).digest('hex') !== icon.sha1.toLowerCase()) throw new Error('ikona nie zgadza się z sumą kontrolną');
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('ikona nie jest plikiem PNG');
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  if (w !== h || w < 256) throw new Error(`ikona musi być kwadratem co najmniej 256×256 (jest ${w}×${h})`);
  fs.writeFileSync(path.join(__dirname, '..', 'build', 'icon.png'), buf);
  console.log(`Ikona z panelu: ${w}×${h} → build/icon.png`);
})().catch((e) => { console.error(e.message); process.exit(1); });
