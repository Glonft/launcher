const net = require('net');

// Minecraft Server List Ping (protokół „status” z listy serwerów w grze).

function varint(n) {
  const out = [];
  n >>>= 0;
  do {
    let b = n & 0x7f;
    n >>>= 7;
    if (n) b |= 0x80;
    out.push(b);
  } while (n);
  return Buffer.from(out);
}

function mcString(s) {
  const b = Buffer.from(s, 'utf8');
  return Buffer.concat([varint(b.length), b]);
}

function packet(id, payload) {
  const body = Buffer.concat([varint(id), payload]);
  return Buffer.concat([varint(body.length), body]);
}

function readVarInt(buf, off) {
  let value = 0;
  let shift = 0;
  let b;
  do {
    if (off >= buf.length) return null;
    b = buf[off++];
    value |= (b & 0x7f) << shift;
    shift += 7;
    if (shift > 35) throw new Error('Zbyt długi VarInt');
  } while (b & 0x80);
  return { value, off };
}

/** Wyciąga zwykły tekst z opisu serwera (komponent czatu lub string), bez kodów §. */
function plainText(c) {
  if (c == null) return '';
  if (typeof c === 'string') return c.replace(/§./g, '');
  let s = c.text || c.translate || '';
  if (Array.isArray(c.extra)) s += c.extra.map(plainText).join('');
  return s.replace(/§./g, '');
}

/**
 * Pinguje serwer. Zwraca { online, players: {online, max, names[]}, version, motd, latency }.
 * Nigdy nie rzuca – przy błędzie zwraca { online: false, error }.
 */
function pingServer(host, port, timeoutMs = 5000) {
  return new Promise((resolve) => {
    let buf = Buffer.alloc(0);
    let started = 0;
    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      sock.destroy();
      resolve(result);
    };
    const timer = setTimeout(() => finish({ online: false, error: 'Przekroczono czas oczekiwania' }), timeoutMs);
    const sock = net.connect({ host, port });

    sock.on('connect', () => {
      const p = Buffer.alloc(2);
      p.writeUInt16BE(port);
      // handshake: protokół 767 (1.21.1), adres, port, next state = 1 (status)
      sock.write(packet(0x00, Buffer.concat([varint(767), mcString(host), p, varint(1)])));
      started = Date.now();
      sock.write(packet(0x00, Buffer.alloc(0)));
    });

    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      try {
        const len = readVarInt(buf, 0);
        if (!len || buf.length < len.off + len.value) return; // czekamy na resztę
        const id = readVarInt(buf, len.off);
        const strLen = readVarInt(buf, id.off);
        const json = JSON.parse(buf.subarray(strLen.off, strLen.off + strLen.value).toString('utf8'));
        const players = json.players || {};
        finish({
          online: true,
          latency: Date.now() - started,
          version: (json.version && json.version.name) || '',
          motd: plainText(json.description).trim(),
          players: {
            online: players.online || 0,
            max: players.max || 0,
            names: (players.sample || []).map((p) => p.name).filter((n) => n && !n.startsWith('§')),
          },
        });
      } catch (e) {
        finish({ online: false, error: `Niepoprawna odpowiedź serwera: ${e.message}` });
      }
    });

    sock.on('error', (e) => finish({ online: false, error: e.code === 'ECONNREFUSED' ? 'Serwer nie odpowiada' : e.message }));
  });
}

module.exports = { pingServer, plainText };
