// Przy budowaniu: jeśli w panelu ustawiono ikonę launchera, podmieniamy build/icon.png,
// żeby plik .exe, skrót i instalator miały tę samą ikonę co okno.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config.json'), 'utf8'));

(async () => {
  const res = await fetch(config.manifestUrl, { headers: { 'Cache-Control': 'no-cache' } });
  if (!res.ok) throw new Error(`manifest: HTTP ${res.status}`);
  const m = await res.json();
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
