const fs = require('fs');
const { safeStorage } = require('electron');
const { Auth } = require('msmc');
const { Authenticator } = require('minecraft-launcher-core');

/**
 * Konto zapisane na dysku:
 *  { type: 'offline', name }
 *  { type: 'microsoft', name, uuid, refresh }  // refresh zaszyfrowany przez safeStorage
 */
class AccountStore {
  constructor(file, clientId) {
    this.file = file;
    this.clientId = clientId;
  }

  _auth() {
    return this.clientId
      ? new Auth({ client_id: this.clientId, redirect: 'https://login.microsoftonline.com/common/oauth2/nativeclient', prompt: 'select_account' })
      : new Auth('select_account');
  }

  get() {
    try {
      const a = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return { type: a.type, name: a.name };
    } catch { return null; }
  }

  _save(data) {
    fs.writeFileSync(this.file, JSON.stringify(data));
  }

  logout() {
    fs.rmSync(this.file, { force: true });
  }

  setOffline(name) {
    if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) {
      throw new Error('Nick: 3–16 znaków, tylko litery, cyfry i _');
    }
    this._save({ type: 'offline', name });
    return { type: 'offline', name };
  }

  async loginMicrosoft() {
    const xbox = await this._auth().launch('electron');
    const mc = await xbox.getMinecraft();
    const refresh = xbox.save();
    this._save({
      type: 'microsoft',
      name: mc.profile.name,
      uuid: mc.profile.id,
      refresh: safeStorage.isEncryptionAvailable()
        ? safeStorage.encryptString(refresh).toString('base64')
        : refresh,
      encrypted: safeStorage.isEncryptionAvailable(),
    });
    return { type: 'microsoft', name: mc.profile.name };
  }

  /** Zwraca obiekt autoryzacji dla minecraft-launcher-core. */
  async getLaunchAuth() {
    const a = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    if (a.type === 'offline') return Authenticator.getAuth(a.name);

    const refresh = a.encrypted
      ? safeStorage.decryptString(Buffer.from(a.refresh, 'base64'))
      : a.refresh;
    const xbox = await this._auth().refresh(refresh);
    const mc = await xbox.getMinecraft();
    // zapisz odświeżony token
    const newRefresh = xbox.save();
    a.refresh = a.encrypted ? safeStorage.encryptString(newRefresh).toString('base64') : newRefresh;
    a.name = mc.profile.name;
    this._save(a);
    return mc.mclc();
  }
}

module.exports = { AccountStore };
