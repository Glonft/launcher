// Discord Rich Presence bez dodatkowych bibliotek – rozmowa z aplikacją Discord przez lokalny kanał IPC.
// Ramka: [opcode uint32 LE][długość uint32 LE][JSON]. Opkody: 0 handshake, 1 ramka, 2 zamknięcie, 3 ping, 4 pong.
const net = require('net');
const path = require('path');
const crypto = require('crypto');

const OP = { HANDSHAKE: 0, FRAME: 1, CLOSE: 2, PING: 3, PONG: 4 };

/** Możliwe ścieżki kanału Discorda (Windows: named pipe, Linux/macOS: gniazdo – też Flatpak i Snap). */
function ipcPaths() {
  if (process.platform === 'win32') return Array.from({ length: 10 }, (_, i) => `\\\\?\\pipe\\discord-ipc-${i}`);
  const base = process.env.XDG_RUNTIME_DIR || process.env.TMPDIR || process.env.TMP || process.env.TEMP || '/tmp';
  const dirs = [base, path.join(base, 'app/com.discordapp.Discord'), path.join(base, 'snap.discord'), '/tmp'];
  return [...new Set(dirs)].flatMap((d) => Array.from({ length: 10 }, (_, i) => path.join(d, `discord-ipc-${i}`)));
}

function encode(op, data) {
  const json = Buffer.from(JSON.stringify(data), 'utf8');
  const head = Buffer.alloc(8);
  head.writeUInt32LE(op, 0);
  head.writeUInt32LE(json.length, 4);
  return Buffer.concat([head, json]);
}

function tryConnect(p, timeout = 1500) {
  return new Promise((resolve) => {
    const sock = net.createConnection(p);
    const t = setTimeout(() => { sock.destroy(); resolve(null); }, timeout);
    sock.once('connect', () => { clearTimeout(t); resolve(sock); });
    sock.once('error', () => { clearTimeout(t); sock.destroy(); resolve(null); });
  });
}

/**
 * Status na Discordzie. Sam się łączy, a gdy Discord jest wyłączony – po cichu próbuje co 30 s.
 * setActivity(null) czyści status.
 */
class DiscordPresence {
  constructor({ log = () => {}, retryMs = 30000, paths = ipcPaths } = {}) {
    Object.assign(this, { log, retryMs, paths });
    this.clientId = null;
    this.sock = null;
    this.ready = false;
    this.activity = null;
    this.buf = Buffer.alloc(0);
    this.timer = null;
    this.stopped = true;
  }

  /** Włącza status dla aplikacji Discord o danym Application ID. */
  start(clientId) {
    if (!/^\d{15,22}$/.test(String(clientId || ''))) { this.stop(); return; }
    if (!this.stopped && this.clientId === String(clientId)) return;
    this.stop();
    this.clientId = String(clientId);
    this.stopped = false;
    this.connect();
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    this.timer = null;
    if (this.sock) {
      try { if (this.ready) this.sock.write(encode(OP.CLOSE, {})); } catch { /* bez znaczenia */ }
      this.sock.destroy();
    }
    this.sock = null;
    this.ready = false;
  }

  setActivity(activity) {
    this.activity = activity || null;
    this.send();
  }

  retry() {
    if (this.stopped) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.connect(), this.retryMs);
    if (this.timer.unref) this.timer.unref();
  }

  async connect() {
    if (this.stopped || this.sock) return;
    let sock = null;
    for (const p of this.paths()) {
      sock = await tryConnect(p);
      if (sock) break;
      if (this.stopped) return;
    }
    if (this.stopped) { if (sock) sock.destroy(); return; }
    if (!sock) { this.retry(); return; } // Discord nie działa – spróbujemy później
    this.sock = sock;
    this.buf = Buffer.alloc(0);
    sock.on('data', (d) => this.onData(d));
    const lost = () => {
      if (this.sock !== sock) return;
      this.sock = null;
      this.ready = false;
      this.retry();
    };
    sock.on('close', lost);
    sock.on('error', lost);
    sock.write(encode(OP.HANDSHAKE, { v: 1, client_id: this.clientId }));
  }

  onData(d) {
    this.buf = Buffer.concat([this.buf, d]);
    while (this.buf.length >= 8) {
      const op = this.buf.readUInt32LE(0);
      const len = this.buf.readUInt32LE(4);
      if (this.buf.length < 8 + len) return;
      let msg = null;
      try { msg = JSON.parse(this.buf.toString('utf8', 8, 8 + len)); } catch { /* uszkodzona ramka */ }
      this.buf = this.buf.subarray(8 + len);
      if (op === OP.PING) { try { this.sock.write(encode(OP.PONG, msg || {})); } catch { /* trudno */ } continue; }
      if (op === OP.CLOSE) {
        this.log(`Discord zamknął połączenie statusu (${(msg && msg.message) || 'bez powodu'}).`);
        if (this.sock) this.sock.destroy();
        continue;
      }
      if (msg && msg.evt === 'READY') { this.ready = true; this.send(); }
      else if (msg && msg.evt === 'ERROR') this.log(`Discord odrzucił status: ${(msg.data && msg.data.message) || 'nieznany błąd'}`);
    }
  }

  send() {
    if (!this.ready || !this.sock) return;
    const frame = { cmd: 'SET_ACTIVITY', args: { pid: process.pid, activity: this.activity }, nonce: crypto.randomUUID() };
    try { this.sock.write(encode(OP.FRAME, frame)); } catch { /* połączenie padło – wróci samo */ }
  }
}

module.exports = { DiscordPresence, encode, OP };
