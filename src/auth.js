const fs = require('fs');
const path = require('path');
const { safeStorage } = require('electron');
const { Auth } = require('msmc');
const { Authenticator } = require('minecraft-launcher-core');

/**
 * Wiele kont zapisanych w accounts.json:
 * { active: "<id>", list: [
 *   { id: "offline:nick", type: "offline", name },
 *   { id: "ms:<uuid>", type: "microsoft", name, uuid, refresh, encrypted } ] }
 * Token odświeżania Microsoft jest szyfrowany przez safeStorage (DPAPI na Windows).
 */
class AccountStore {
  constructor(file, clientId) {
    this.file = file;
    this.clientId = clientId;
    this._migrate();
  }

  // Wersje <0.4 trzymały jedno konto w account.json
  _migrate() {
    const old = path.join(path.dirname(this.file), 'account.json');
    if (fs.existsSync(this.file) || !fs.existsSync(old)) return;
    try {
      const a = JSON.parse(fs.readFileSync(old, 'utf8'));
      const id = a.type === 'microsoft' ? `ms:${a.uuid}` : `offline:${String(a.name).toLowerCase()}`;
      this._write({ active: id, list: [{ id, ...a }] });
      fs.rmSync(old, { force: true });
    } catch { /* uszkodzony stary plik – ignorujemy */ }
  }

  _read() {
    try {
      const d = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return { active: d.active || null, list: Array.isArray(d.list) ? d.list : [] };
    } catch { return { active: null, list: [] }; }
  }

  _write(d) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(d));
  }

  _auth() {
    return this.clientId
      ? new Auth({ client_id: this.clientId, redirect: 'https://login.microsoftonline.com/common/oauth2/nativeclient', prompt: 'select_account' })
      : new Auth('select_account');
  }

  _enc(s) {
    return safeStorage.isEncryptionAvailable()
      ? { refresh: safeStorage.encryptString(s).toString('base64'), encrypted: true }
      : { refresh: s, encrypted: false };
  }

  _dec(a) {
    return a.encrypted ? safeStorage.decryptString(Buffer.from(a.refresh, 'base64')) : a.refresh;
  }

  _upsert(acc) {
    const d = this._read();
    d.list = d.list.filter((a) => a.id !== acc.id).concat(acc);
    d.active = acc.id;
    this._write(d);
  }

  /** Publiczny widok (bez tokenów). */
  state() {
    const d = this._read();
    const pub = (a) => ({ id: a.id, type: a.type, name: a.name });
    const active = d.list.find((a) => a.id === d.active) || d.list[0] || null;
    return { active: active ? pub(active) : null, list: d.list.map(pub) };
  }

  select(id) {
    const d = this._read();
    if (!d.list.some((a) => a.id === id)) throw new Error('Nie ma takiego konta.');
    d.active = id;
    this._write(d);
    return this.state();
  }

  remove(id) {
    const d = this._read();
    d.list = d.list.filter((a) => a.id !== id);
    if (d.active === id) d.active = d.list[0] ? d.list[0].id : null;
    this._write(d);
    return this.state();
  }

  addOffline(name) {
    name = String(name || '').trim();
    if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) throw new Error('Nick: 3–16 znaków, tylko litery, cyfry i _');
    this._upsert({ id: `offline:${name.toLowerCase()}`, type: 'offline', name });
    return this.state();
  }

  async addMicrosoft() {
    const xbox = await this._auth().launch('electron');
    const mc = await xbox.getMinecraft();
    this._upsert({
      id: `ms:${mc.profile.id}`,
      type: 'microsoft',
      name: mc.profile.name,
      uuid: mc.profile.id,
      ...this._enc(xbox.save()),
    });
    return this.state();
  }

  _activeRaw() {
    const d = this._read();
    return d.list.find((x) => x.id === d.active) || d.list[0] || null;
  }

  /** Świeża sesja Minecraft dla konta Microsoft (trzymana w pamięci ok. 10 minut). */
  async _msSession(a) {
    const c = this._cache;
    if (c && c.id === a.id && Date.now() - c.at < 10 * 60 * 1000) return c.mc;
    let xbox;
    try {
      xbox = await this._auth().refresh(this._dec(a));
    } catch (e) {
      throw new Error(`Sesja konta Microsoft wygasła – usuń konto ${a.name} i dodaj je ponownie. (${e.message || e})`);
    }
    const mc = await xbox.getMinecraft();
    const d = this._read();
    const updated = { ...a, name: mc.profile.name, ...this._enc(xbox.save()) };
    d.list = d.list.map((x) => (x.id === a.id ? updated : x)); // bez zmiany aktywnego konta
    this._write(d);
    this._cache = { id: a.id, at: Date.now(), mc };
    return mc;
  }

  /** Obiekt autoryzacji aktywnego konta dla minecraft-launcher-core. */
  async getLaunchAuth() {
    const a = this._activeRaw();
    if (!a) throw new Error('Najpierw dodaj konto.');
    if (a.type === 'offline') return Authenticator.getAuth(a.name);
    return (await this._msSession(a)).mclc();
  }

  /** Token API Minecraft aktywnego konta Microsoft (do zmiany skina). */
  async getMinecraftToken() {
    const a = this._activeRaw();
    if (!a) throw new Error('Najpierw dodaj konto.');
    if (a.type !== 'microsoft') throw new Error('Zmiana skina w launcherze działa na razie tylko dla kont Microsoft (premium).');
    const auth = (await this._msSession(a)).mclc();
    return auth.access_token;
  }
}

module.exports = { AccountStore };
