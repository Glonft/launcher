// Minecraft Query (protokół GameSpy4 po UDP) – zwraca pełną listę graczy.
// Działa tylko, gdy serwer ma w server.properties: enable-query=true (query.port).
const dgram = require('dgram');

const MAGIC = [0xfe, 0xfd];

/** Jedno zapytanie UDP z czekaniem na odpowiedź. */
function exchange(sock, host, port, buf, timeout) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { cleanup(); reject(new Error('Query nie odpowiada')); }, timeout);
    const onMsg = (msg) => { cleanup(); resolve(msg); };
    const onErr = (e) => { cleanup(); reject(e); };
    function cleanup() { clearTimeout(t); sock.off('message', onMsg); sock.off('error', onErr); }
    sock.on('message', onMsg);
    sock.on('error', onErr);
    sock.send(buf, port, host, (e) => { if (e) onErr(e); });
  });
}

/** Czyta napis zakończony bajtem 0 od pozycji p. Zwraca [tekst, nowa pozycja]. */
function cstr(buf, p) {
  const end = buf.indexOf(0, p);
  if (end < 0) return [buf.toString('utf8', p), buf.length];
  return [buf.toString('utf8', p, end), end + 1];
}

/**
 * Pełny status serwera przez Query.
 * Zwraca { online, max, names[], version } albo rzuca błąd, gdy Query jest wyłączone / zablokowane.
 */
async function queryFull(host, port, timeout = 1500) {
  const sock = dgram.createSocket('udp4');
  sock.unref();
  try {
    const session = Math.floor(Math.random() * 0x7fffffff) & 0x0f0f0f0f;
    const sid = Buffer.alloc(4);
    sid.writeInt32BE(session);

    // 1) uzgodnienie – serwer odsyła liczbę-wyzwanie jako tekst
    const hs = await exchange(sock, host, port, Buffer.from([...MAGIC, 0x09, ...sid]), timeout);
    if (hs[0] !== 0x09) throw new Error('Zła odpowiedź Query');
    const [tokenText] = cstr(hs, 5);
    const token = Buffer.alloc(4);
    token.writeInt32BE(Number.parseInt(tokenText, 10) | 0);

    // 2) pełny status
    const res = await exchange(sock, host, port, Buffer.concat([Buffer.from([...MAGIC, 0x00]), sid, token, Buffer.alloc(4)]), timeout);
    if (res[0] !== 0x00) throw new Error('Zła odpowiedź Query');
    let p = 5 + 11; // typ + sesja + "splitnum\0\x80\0"
    const kv = {};
    for (;;) {
      let k; let v;
      [k, p] = cstr(res, p);
      if (!k) break;
      [v, p] = cstr(res, p);
      kv[k] = v;
    }
    p += 10; // "\x01player_\0\0"
    const names = [];
    while (p < res.length) {
      let n;
      [n, p] = cstr(res, p);
      if (!n) break;
      names.push(n);
    }
    return {
      online: Number(kv.numplayers) || names.length,
      max: Number(kv.maxplayers) || 0,
      version: kv.version || null,
      names,
    };
  } finally {
    try { sock.close(); } catch { /* już zamknięte */ }
  }
}

module.exports = { queryFull };
