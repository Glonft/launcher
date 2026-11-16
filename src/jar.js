// Odczyt informacji z pliku .jar moda (zip) bez dodatkowych bibliotek.
const zlib = require('zlib');

/** Spis plików w archiwum zip: Map(nazwa → { method, csize, offset }). */
function entries(buf) {
  if (buf.length < 22 || buf.readUInt32LE(0) !== 0x04034b50) throw new Error('To nie jest plik .jar (zip).');
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Uszkodzony plik .jar.');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map();
  for (let i = 0; i < count && p + 46 <= buf.length; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28);
    const elen = buf.readUInt16LE(p + 30);
    const clen = buf.readUInt16LE(p + 32);
    const offset = buf.readUInt32LE(p + 42);
    out.set(buf.toString('utf8', p + 46, p + 46 + nlen), { method, csize, offset });
    p += 46 + nlen + elen + clen;
  }
  return out;
}

/** Zawartość pliku z archiwum jako Buffer (albo null). */
function readBuf(buf, list, name) {
  const e = list.get(name);
  if (!e) return null;
  const lh = e.offset;
  if (lh + 30 > buf.length || buf.readUInt32LE(lh) !== 0x04034b50) return null;
  const start = lh + 30 + buf.readUInt16LE(lh + 26) + buf.readUInt16LE(lh + 28);
  const data = buf.subarray(start, start + e.csize);
  if (e.method === 0) return data;
  if (e.method === 8) return zlib.inflateRawSync(data);
  return null;
}

function read(buf, list, name) {
  const b = readBuf(buf, list, name);
  return b ? b.toString('utf8') : null;
}

/** Ikona moda (PNG jako Buffer) wskazana w mods.toml (logoFile) lub fabric.mod.json (icon). */
function modIcon(buf) {
  const list = entries(buf);
  let file = null;
  const toml = read(buf, list, 'META-INF/neoforge.mods.toml') || read(buf, list, 'META-INF/mods.toml');
  if (toml) {
    const block = (toml.split(/^\s*\[\[mods\]\]\s*$/m)[1] || '').split(/^\s*\[/m)[0];
    const re = /^\s*logoFile\s*=\s*(?:"([^"]*)"|'([^']*)')/m;
    const m = block.match(re) || toml.match(re);
    if (m) file = m[1] ?? m[2];
  } else {
    const j = read(buf, list, 'fabric.mod.json') || read(buf, list, 'quilt.mod.json');
    if (j) {
      try {
        const o = JSON.parse(j);
        let ic = o.icon || ((o.quilt_loader || {}).metadata || {}).icon;
        if (ic && typeof ic === 'object') {
          const k = Object.keys(ic).sort((a, b) => Math.abs(a - 64) - Math.abs(b - 64))[0];
          ic = ic[k];
        }
        if (typeof ic === 'string') file = ic;
      } catch { /* brak ikony */ }
    }
  }
  if (!file) return null;
  file = file.replace(/^\/+/, '');
  const png = readBuf(buf, list, file) || readBuf(buf, list, `assets/${file}`);
  return png && png.length > 8 && png.readUInt32BE(0) === 0x89504e47 ? png : null;
}

/** Proste wyciągnięcie wartości z pierwszego bloku [[mods]] w mods.toml. */
function tomlMod(text) {
  const block = (text.split(/^\s*\[\[mods\]\]\s*$/m)[1] || '').split(/^\s*\[/m)[0];
  const val = (key) => {
    const m = block.match(new RegExp(`^\\s*${key}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'm'));
    return m ? (m[1] ?? m[2]) : null;
  };
  return { id: val('modId'), name: val('displayName'), version: val('version') };
}

/**
 * Informacje o modzie: { loader: 'neoforge'|'forge'|'fabric'|'quilt'|null, id, name, version }.
 */
function modInfo(buf) {
  const list = entries(buf);
  let loader = null;
  let info = {};
  const neo = read(buf, list, 'META-INF/neoforge.mods.toml');
  const forge = !neo && read(buf, list, 'META-INF/mods.toml');
  if (neo || forge) {
    loader = neo ? 'neoforge' : 'forge';
    info = tomlMod(neo || forge);
    if (!info.version || info.version.includes('${')) {
      const mf = read(buf, list, 'META-INF/MANIFEST.MF') || '';
      const m = mf.match(/^Implementation-Version:\s*(.+)$/m);
      info.version = m ? m[1].trim() : null;
    }
  } else {
    const fabric = read(buf, list, 'fabric.mod.json');
    const quilt = !fabric && read(buf, list, 'quilt.mod.json');
    if (fabric || quilt) {
      loader = fabric ? 'fabric' : 'quilt';
      try {
        const j = JSON.parse(fabric || quilt);
        const q = j.quilt_loader || {};
        info = { id: j.id || q.id, name: j.name || (q.metadata || {}).name, version: j.version || q.version };
      } catch { info = {}; }
    }
  }
  return { loader, id: info.id || null, name: info.name || info.id || null, version: info.version || null };
}

module.exports = { modInfo, modIcon, entries };
