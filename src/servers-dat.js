// servers.dat (lista serwerów w Minecrafcie, nieskompresowany NBT).
// Launcher dopisuje / poprawia wpis serwera, żeby miał właściwą nazwę (np. „MelinaSMP”).
// Ważne m.in. dla Distant Horizons, który nazywa folder z terenem według nazwy serwera.
const fs = require('fs');
const path = require('path');

// ---- minimalny NBT (tylko to, czego potrzeba w servers.dat, ale czyta każdy poprawny plik) ----
const T = { END: 0, BYTE: 1, SHORT: 2, INT: 3, LONG: 4, FLOAT: 5, DOUBLE: 6, BYTE_ARRAY: 7, STRING: 8, LIST: 9, COMPOUND: 10, INT_ARRAY: 11, LONG_ARRAY: 12 };

function reader(buf) {
  let o = 0;
  const r = {
    u8: () => buf.readUInt8(o++),
    i8: () => buf.readInt8(o++),
    i16: () => { const v = buf.readInt16BE(o); o += 2; return v; },
    i32: () => { const v = buf.readInt32BE(o); o += 4; return v; },
    i64: () => { const v = buf.readBigInt64BE(o); o += 8; return v; },
    f32: () => { const v = buf.readFloatBE(o); o += 4; return v; },
    f64: () => { const v = buf.readDoubleBE(o); o += 8; return v; },
    str: () => { const n = buf.readUInt16BE(o); o += 2; const s = buf.toString('utf8', o, o + n); o += n; return s; },
  };
  function payload(type) {
    switch (type) {
      case T.BYTE: return r.i8();
      case T.SHORT: return r.i16();
      case T.INT: return r.i32();
      case T.LONG: return r.i64();
      case T.FLOAT: return r.f32();
      case T.DOUBLE: return r.f64();
      case T.BYTE_ARRAY: { const n = r.i32(); const a = []; for (let i = 0; i < n; i++) a.push(r.i8()); return a; }
      case T.STRING: return r.str();
      case T.LIST: { const et = r.u8(); const n = r.i32(); const items = []; for (let i = 0; i < n; i++) items.push(payload(et)); return { type: et, items }; }
      case T.COMPOUND: {
        const out = [];
        for (;;) { const t = r.u8(); if (t === T.END) break; const name = r.str(); out.push({ type: t, name, value: payload(t) }); }
        return out;
      }
      case T.INT_ARRAY: { const n = r.i32(); const a = []; for (let i = 0; i < n; i++) a.push(r.i32()); return a; }
      case T.LONG_ARRAY: { const n = r.i32(); const a = []; for (let i = 0; i < n; i++) a.push(r.i64()); return a; }
      default: throw new Error(`Nieznany typ NBT ${type}`);
    }
  }
  const rootType = r.u8();
  if (rootType !== T.COMPOUND) throw new Error('Zły plik NBT');
  r.str();
  return payload(T.COMPOUND);
}

function writer() {
  const parts = [];
  const w = {
    u8: (v) => { const b = Buffer.alloc(1); b.writeUInt8(v); parts.push(b); },
    i8: (v) => { const b = Buffer.alloc(1); b.writeInt8(v); parts.push(b); },
    i16: (v) => { const b = Buffer.alloc(2); b.writeInt16BE(v); parts.push(b); },
    i32: (v) => { const b = Buffer.alloc(4); b.writeInt32BE(v); parts.push(b); },
    i64: (v) => { const b = Buffer.alloc(8); b.writeBigInt64BE(BigInt(v)); parts.push(b); },
    f32: (v) => { const b = Buffer.alloc(4); b.writeFloatBE(v); parts.push(b); },
    f64: (v) => { const b = Buffer.alloc(8); b.writeDoubleBE(v); parts.push(b); },
    str: (s) => { const d = Buffer.from(s, 'utf8'); w.i16(d.length); parts.push(d); },
  };
  function payload(type, v) {
    switch (type) {
      case T.BYTE: return w.i8(v);
      case T.SHORT: return w.i16(v);
      case T.INT: return w.i32(v);
      case T.LONG: return w.i64(v);
      case T.FLOAT: return w.f32(v);
      case T.DOUBLE: return w.f64(v);
      case T.BYTE_ARRAY: w.i32(v.length); return v.forEach(w.i8);
      case T.STRING: return w.str(v);
      case T.LIST: w.u8(v.type); w.i32(v.items.length); return v.items.forEach((x) => payload(v.type, x));
      case T.COMPOUND: for (const t of v) { w.u8(t.type); w.str(t.name); payload(t.type, t.value); } return w.u8(T.END);
      case T.INT_ARRAY: w.i32(v.length); return v.forEach(w.i32);
      case T.LONG_ARRAY: w.i32(v.length); return v.forEach(w.i64);
      default: throw new Error(`Nieznany typ NBT ${type}`);
    }
  }
  return { root(compound) { w.u8(T.COMPOUND); w.str(''); payload(T.COMPOUND, compound); return Buffer.concat(parts); } };
}

const get = (compound, name) => compound.find((t) => t.name === name);
const sameAddr = (a, host, port) => {
  const want = port === 25565 ? [host, `${host}:25565`] : [`${host}:${port}`];
  return want.map((x) => x.toLowerCase()).includes(String(a).trim().toLowerCase());
};

/**
 * Dba o to, żeby serwer był na liście serwerów pod właściwą nazwą.
 * Zwraca true, jeśli plik został zmieniony.
 */
function ensureServerEntry(gameDir, server) {
  if (!server || !server.host) return false;
  const file = path.join(gameDir, 'servers.dat');
  const name = server.name || 'Serwer';
  const port = Number(server.port) || 25565;
  const ip = `${server.host}:${port}`; // dokładnie tak, jak łączy launcher (quickPlay), żeby Minecraft rozpoznał wpis

  let root = [];
  if (fs.existsSync(file)) {
    try { root = reader(fs.readFileSync(file)); }
    catch { return false; } // nieznany format – nie ruszamy listy gracza
  }
  let list = get(root, 'servers');
  if (!list || list.type !== T.LIST) {
    list = { type: T.LIST, name: 'servers', value: { type: T.COMPOUND, items: [] } };
    root = root.filter((t) => t.name !== 'servers').concat(list);
  }
  if (list.value.type !== T.COMPOUND) list.value = { type: T.COMPOUND, items: [] };

  const entry = list.value.items.find((c) => { const t = get(c, 'ip'); return t && sameAddr(t.value, server.host, port); });
  if (entry) {
    const n = get(entry, 'name');
    if (n && n.value === name) return false;
    if (n) n.value = name; else entry.unshift({ type: T.STRING, name: 'name', value: name });
  } else {
    list.value.items.unshift([
      { type: T.STRING, name: 'name', value: name },
      { type: T.STRING, name: 'ip', value: ip },
    ]);
  }
  fs.mkdirSync(gameDir, { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, writer().root(root));
  fs.renameSync(tmp, file);
  return true;
}

module.exports = { ensureServerEntry, _nbt: { reader, writer, T } };
