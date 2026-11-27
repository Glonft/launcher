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
  constructor(file, clientId, authUrl = '') {
    this.file = file;
    this.clientId = clientId;
    this.authUrl = String(authUrl || '').replace(/\/$/, '');
    this._migrate();
    // „Zapamiętaj mnie” odznaczone → po ponownym uruchomieniu znowu ekran logowania
    const d = this._read();
    const a = d.list.find((x) => x.id === d.active);
    if (a && a.remember === false && !d.loggedOut) { d.loggedOut = true; this._write(d); }
  }

  /** Zapytanie do API kont graczy (panel na Pi). */
  async _api(p, body) {
    if (!this.authUrl) throw new Error('Logowanie kontem serwera jest niedostępne w tej wersji.');
    let r;
    try {
      r = await fetch(`${this.authUrl}/api/auth/${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(12000) });
    } catch { throw new Error('Brak połączenia z serwerem logowania. Sprawdź internet i spróbuj ponownie.'); }
    let j = {};
    try { j = await r.json(); } catch { /* pusta odpowiedź */ }
    if (!r.ok) throw new Error(j.error || `Błąd serwera logowania (${r.status}).`);
    return j;
  }

  /** Konto serwera (non-premium z hasłem): logowanie albo rejestracja → token zapisany zaszyfrowany. */
  async loginServer(nick, password, remember = true) {
    const r = await this._api('login', { nick, password });
    this._upsert({ id: `melina:${r.nick.toLowerCase()}`, type: 'melina', name: r.nick, remember: !!remember, ...this._encToken(r.token) });
    return this.state();
  }
  async registerServer(nick, email, password, remember = true) {
    const r = await this._api('register', { nick, email, password });
    this._upsert({ id: `melina:${r.nick.toLowerCase()}`, type: 'melina', name: r.nick, remember: !!remember, ...this._encToken(r.token) });
    return this.state();
  }
  forgotPassword(who) { return this._api('forgot', { who }); }

  _encToken(t) {
    return safeStorage.isEncryptionAvailable()
      ? { token: safeStorage.encryptString(t).toString('base64'), tokenEnc: true }
      : { token: t, tokenEnc: false };
  }
  _decToken(a) { return a.tokenEnc ? safeStorage.decryptString(Buffer.from(a.token, 'base64')) : a.token; }

  /**
   * Przed uruchomieniem gry: „bilet” na serwerze logowania (nick + Twoje IP na 10 minut),
   * dzięki któremu mod na serwerze gry wie, że to naprawdę Ty. Zwraca opis albo rzuca błąd.
   */
  async gameTicket() {
    const a = this._activeRaw();
    if (!a || !this.authUrl) return null;
    if (a.type === 'melina') {
      try { return await this._api('ticket', { token: this._decToken(a) }); } catch (e) {
        if (/wygasła/.test(e.message)) { this.logout(); throw new Error('Sesja wygasła – zaloguj się ponownie.'); }
        throw e;
      }
    }
    if (a.type === 'microsoft') {
      const mc = await this._msSession(a);
      return this._api('premium', { mcToken: mc.mclc().access_token });
    }
    return null; // dawne konto „sam nick” – bez biletu
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
      return { active: d.active || null, list: Array.isArray(d.list) ? d.list : [], ...(d.loggedOut ? { loggedOut: true } : {}) };
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
    delete d.loggedOut;
    this._write(d);
  }

  /** Publiczny widok (bez tokenów). */
  state() {
    const d = this._read();
    const pub = (a) => ({ id: a.id, type: a.type, name: a.name });
    const active = d.loggedOut ? null : d.list.find((a) => a.id === d.active) || d.list[0] || null;
    return { active: active ? pub(active) : null, list: d.list.map(pub) };
  }

  select(id) {
    const d = this._read();
    const acc = d.list.find((a) => a.id === id);
    if (!acc) throw new Error('Nie ma takiego konta.');
    if (acc.type === 'melina' && !acc.token) throw new Error('Podaj hasło, żeby zalogować się na to konto.');
    d.active = id;
    delete d.loggedOut;
    this._write(d);
    return this.state();
  }

  /** „Wyloguj”: konta zostają zapamiętane, ale launcher wraca do ekranu logowania. */
  logout() {
    const d = this._read();
    const a = d.list.find((x) => x.id === d.active);
    if (a && a.type === 'melina' && this.authUrl) {
      // token unieważniamy też na serwerze (w tle); konto zostaje na liście, ale trzeba podać hasło
      this._api('logout', { token: this._decToken(a) }).catch(() => {});
      d.list = d.list.map((x) => (x === a ? { ...x, token: null } : x));
    }
    d.loggedOut = true;
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
    if (d.loggedOut) return null;
    return d.list.find((x) => x.id === d.active) || d.list[0] || null;
  }

  /**
   * Sesja Minecraft dla konta Microsoft. Token Minecrafta jest ważny 24 h, więc trzymamy go w pamięci
   * do 20 h (osobno dla każdego konta) – nie logujemy się od nowa przy każdym otwarciu skina.
   */
  async _msSession(a) {
    this._sessions = this._sessions || new Map();
    const c = this._sessions.get(a.id);
    if (c && Date.now() - c.at < 20 * 60 * 60 * 1000) return c.mc;
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
    this._sessions.set(a.id, { at: Date.now(), mc });
    return mc;
  }

  /** Obiekt autoryzacji aktywnego konta dla minecraft-launcher-core. */
  async getLaunchAuth() {
    const a = this._activeRaw();
    if (!a) throw new Error('Najpierw dodaj konto.');
    if (a.type === 'offline' || a.type === 'melina') return Authenticator.getAuth(a.name);
    return (await this._msSession(a)).mclc();
  }

  /** Zapomina zapamiętaną sesję aktywnego konta (np. gdy serwer odrzucił token). */
  forgetSession() {
    const a = this._activeRaw();
    if (a && this._sessions) this._sessions.delete(a.id);
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
