// „Moje mody” – mody dodane przez gracza (z Modrinth albo z dysku).
//
// Pliki leżą w <gra>/mods-gracza/, lista w <gra>/mods-gracza/lista.json.
// Przed startem gry włączone mody są kopiowane do mods/ z przedrostkiem „gracz-”,
// dzięki czemu synchronizacja paczki ich nie kasuje, a „Uruchom bez moich modów” łatwo je zdejmuje.
// Jeśli mod gracza jest już w paczce (to samo modId), wygrywa paczka.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { modInfo } = require('./jar');

const API = 'https://api.modrinth.com/v2';
const UA = { 'User-Agent': 'Glonft/melinasmp-launcher' };
const PREFIX = 'gracz-';

const sha1 = (buf) => crypto.createHash('sha1').update(buf).digest('hex');
const safeName = (n) => n.replace(/[^A-Za-z0-9._+-]/g, '_').replace(/^\.+/, '').slice(0, 120) || 'mod.jar';

async function getJson(url, opt = {}) {
  const res = await fetch(url, { ...opt, headers: { ...UA, ...(opt.headers || {}) } });
  if (!res.ok) throw new Error(`Modrinth: HTTP ${res.status}`);
  return res.json();
}
async function getBuffer(url) {
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`Pobieranie: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

class PlayerMods {
  constructor(gameDir) {
    this.dir = path.join(gameDir, 'mods-gracza');
    this.listFile = path.join(this.dir, 'lista.json');
    this.gameDir = gameDir;
  }

  list() {
    try { return JSON.parse(fs.readFileSync(this.listFile, 'utf8')); } catch { return []; }
  }
  save(list) {
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(this.listFile, JSON.stringify(list, null, 2));
  }

  // ---------- Modrinth ----------

  /**
   * Szukanie / przeglądanie modów pod wersję gry i silnik (wszystkie – także wymagające serwera, z oznaczeniem).
   * opts: { category, sort: 'downloads'|'newest'|'updated'|'relevance', offset }
   */
  static async search(query, mc, loader, opts = {}) {
    const f = [[`categories:${loader}`], [`versions:${mc}`], ['project_type:mod']];
    if (opts.category && /^[a-z-]{2,30}$/.test(opts.category)) f.push([`categories:${opts.category}`]);
    const sort = ['downloads', 'newest', 'updated', 'relevance'].includes(opts.sort) ? opts.sort : (query ? 'relevance' : 'downloads');
    const offset = Math.max(0, Math.min(Number(opts.offset) || 0, 2000));
    const d = await getJson(`${API}/search?limit=20&offset=${offset}&index=${sort}&query=${encodeURIComponent(query || '')}&facets=${encodeURIComponent(JSON.stringify(f))}`);
    return {
      total: d.total_hits,
      hits: d.hits.map((h) => ({
        id: h.project_id, title: h.title, description: h.description, icon: h.icon_url,
        downloads: h.downloads, author: h.author,
        needsServer: h.server_side === 'required', serverOnly: h.client_side === 'unsupported',
      })),
    };
  }

  async addModrinth(projectId, mc, loader, requiredBy = null, depth = 0) {
    if (depth > 4) return [];
    const list = this.list();
    const existing = list.find((m) => m.projectId === projectId);
    if (existing) {
      if (requiredBy && !(existing.requiredBy || []).includes(requiredBy)) {
        existing.requiredBy = [...(existing.requiredBy || []), requiredBy];
        this.save(list);
      }
      return [];
    }
    const [project, versions] = await Promise.all([
      getJson(`${API}/project/${encodeURIComponent(projectId)}`),
      getJson(`${API}/project/${encodeURIComponent(projectId)}/version?loaders=${encodeURIComponent(JSON.stringify([loader]))}&game_versions=${encodeURIComponent(JSON.stringify([mc]))}`),
    ]);
    const v = versions.find((x) => x.version_type === 'release') || versions[0];
    if (!v) throw new Error(`${project.title} nie ma wersji na Minecraft ${mc} (${loader}).`);
    const file = v.files.find((f) => f.primary) || v.files[0];
    const buf = await getBuffer(file.url);
    if (file.hashes && file.hashes.sha1 && sha1(buf) !== file.hashes.sha1) throw new Error(`Uszkodzony plik ${file.filename} – spróbuj jeszcze raz.`);
    const name = safeName(file.filename);
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(path.join(this.dir, name), buf);
    let modId = null;
    try { modId = modInfo(buf).id; } catch { /* bez znaczenia */ }
    const entry = {
      id: `mr:${projectId}`, projectId, source: 'modrinth', name: project.title, version: v.version_number,
      file: name, sha1: sha1(buf), modId, enabled: true, requiredBy: requiredBy ? [requiredBy] : [],
      icon: project.icon_url || null,
      needsServer: project.server_side === 'required' || project.client_side === 'unsupported',
    };
    const fresh = this.list().filter((m) => m.file !== name);
    fresh.push(entry);
    this.save(fresh);
    const added = [entry.name];
    for (const dep of v.dependencies.filter((d) => d.dependency_type === 'required' && d.project_id)) {
      try { added.push(...await this.addModrinth(dep.project_id, mc, loader, entry.id, depth + 1)); }
      catch (e) { added.push(`(nie udało się dodać wymaganego moda: ${e.message})`); }
    }
    return added;
  }

  // ---------- z dysku ----------

  addFile(filePath, loader) {
    if (!/\.jar$/i.test(filePath)) throw new Error('Wybierz plik .jar.');
    const buf = fs.readFileSync(filePath);
    if (buf.length > 100 * 1024 * 1024) throw new Error('Plik jest za duży (maks. 100 MB).');
    const info = modInfo(buf);
    if (!info.loader) throw new Error('To nie wygląda na mod do Minecrafta (brak opisu moda w pliku).');
    if (info.loader !== loader) {
      throw new Error(`To mod dla ${info.loader === 'neoforge' ? 'NeoForge' : info.loader[0].toUpperCase() + info.loader.slice(1)}, a serwer używa ${loader === 'neoforge' ? 'NeoForge' : loader}.`);
    }
    const name = safeName(path.basename(filePath));
    const hash = sha1(buf);
    const list = this.list();
    if (list.some((m) => m.sha1 === hash)) throw new Error('Ten mod jest już na liście.');
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(path.join(this.dir, name), buf);
    const entry = {
      id: `dysk:${hash.slice(0, 12)}`, source: 'dysk', name: info.name || name.replace(/\.jar$/i, ''), version: info.version || '',
      file: name, sha1: hash, modId: info.id, enabled: true, requiredBy: [],
    };
    this.save(list.filter((m) => m.file !== name).concat(entry));
    return entry;
  }

  // ---------- zarządzanie ----------

  setEnabled(id, enabled) {
    const list = this.list();
    const m = list.find((x) => x.id === id);
    if (!m) throw new Error('Nie ma takiego moda.');
    m.enabled = !!enabled;
    this.save(list);
  }

  remove(id) {
    let list = this.list();
    const removeOne = (rid) => {
      const m = list.find((x) => x.id === rid);
      if (!m) return;
      list = list.filter((x) => x.id !== rid);
      fs.rmSync(path.join(this.dir, m.file), { force: true });
      // mody dodane automatycznie tylko dla tego moda – też do kosza
      for (const dep of list.filter((x) => (x.requiredBy || []).includes(rid))) {
        dep.requiredBy = dep.requiredBy.filter((r) => r !== rid);
        if (!dep.requiredBy.length) removeOne(dep.id);
      }
    };
    removeOne(id);
    this.save(list);
  }

  /** Aktualizacje z Modrinth (także dla plików z dysku, jeśli Modrinth zna ich hash). */
  async checkUpdates(mc, loader) {
    const list = this.list();
    if (!list.length) return [];
    const res = await getJson(`${API}/version_files/update`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hashes: list.map((m) => m.sha1), algorithm: 'sha1', loaders: [loader], game_versions: [mc] }),
    });
    const out = [];
    for (const m of list) {
      const v = res[m.sha1];
      if (!v) continue;
      const f = v.files.find((x) => x.primary) || v.files[0];
      if (f && f.hashes.sha1 !== m.sha1) out.push({ id: m.id, name: m.name, from: m.version, to: v.version_number, url: f.url, filename: f.filename, sha1: f.hashes.sha1 });
    }
    return out;
  }

  async applyUpdate(u) {
    const buf = await getBuffer(u.url);
    if (sha1(buf) !== u.sha1) throw new Error(`Uszkodzony plik ${u.filename}.`);
    const list = this.list();
    const m = list.find((x) => x.id === u.id);
    if (!m) return;
    const name = safeName(u.filename);
    if (name !== m.file) fs.rmSync(path.join(this.dir, m.file), { force: true });
    fs.writeFileSync(path.join(this.dir, name), buf);
    Object.assign(m, { file: name, sha1: u.sha1, version: u.to });
    this.save(list);
  }

  // ---------- przed startem gry ----------

  /**
   * Kopiuje włączone mody gracza do mods/ (gracz-*), usuwa resztę gracz-*.
   * packModIds: Set modId modów z paczki (te wygrywają). withoutMine: „Uruchom bez moich modów”.
   */
  install(packModIds, withoutMine, log) {
    const modsDir = path.join(this.gameDir, 'mods');
    fs.mkdirSync(modsDir, { recursive: true });
    const want = new Map();
    if (!withoutMine) {
      for (const m of this.list().filter((x) => x.enabled)) {
        if (m.modId && packModIds.has(m.modId)) { log(`Moje mody: „${m.name}” jest już w paczce serwera – używam wersji z paczki.`); continue; }
        const src = path.join(this.dir, m.file);
        if (fs.existsSync(src)) want.set(PREFIX + m.file, src);
      }
    }
    for (const f of fs.readdirSync(modsDir)) {
      if (f.startsWith(PREFIX) && !want.has(f)) fs.rmSync(path.join(modsDir, f), { force: true });
    }
    for (const [dest, src] of want) {
      const d = path.join(modsDir, dest);
      if (!fs.existsSync(d) || fs.statSync(d).size !== fs.statSync(src).size) fs.copyFileSync(src, d);
    }
    if (withoutMine) log('Uruchamiam bez Twoich modów.');
    else if (want.size) log(`Moje mody: ${want.size} włączonych.`);
    return want.size;
  }
}

/** modId modów z paczki (z pamięcią podręczną po hashu, żeby nie czytać 100+ plików przy każdym starcie). */
function packModIds(gameDir, manifest) {
  const cacheFile = path.join(gameDir, '.melinasmp-modids.json');
  let cache = {};
  try { cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8')); } catch { /* pusta */ }
  const ids = new Set();
  const next = {};
  for (const f of manifest.files.filter((x) => /^mods\/[^/]+\.jar$/i.test(x.path))) {
    let id = cache[f.sha1];
    if (id === undefined) {
      try { id = modInfo(fs.readFileSync(path.join(gameDir, f.path))).id || null; } catch { id = null; }
    }
    next[f.sha1] = id;
    if (id) ids.add(id);
  }
  try { fs.writeFileSync(cacheFile, JSON.stringify(next)); } catch { /* bez znaczenia */ }
  return ids;
}

module.exports = { PlayerMods, packModIds, PREFIX };
