// „Moje mody” – mody, shadery i paczki tekstur dodane przez gracza (z Modrinth albo z dysku).
//
// Pliki leżą w <gra>/mods-gracza/ (shadery i paczki tekstur w podfolderach), lista w <gra>/mods-gracza/lista.json.
// Przed startem gry włączone pozycje są kopiowane z przedrostkiem „gracz-” do mods/, shaderpacks/ albo resourcepacks/.
// Dzięki temu synchronizacja paczki ich nie kasuje, „Uruchom bez moich modów” łatwo je zdejmuje,
// a mody zablokowane przez administrację po prostu nie są kopiowane.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { modInfo, entries } = require('./jar');

const API = 'https://api.modrinth.com/v2';
const UA = { 'User-Agent': 'Glonft/melinasmp-launcher' };
const PREFIX = 'gracz-';
const IRIS = 'YL57xq9U'; // projekt Iris Shaders na Modrinth

// rodzaje: gdzie trafiają w grze i jaki to typ projektu na Modrinth
const KINDS = {
  mod: { dir: 'mods', store: '', type: 'mod' },
  shader: { dir: 'shaderpacks', store: 'shaderpacks', type: 'shader' },
  resourcepack: { dir: 'resourcepacks', store: 'resourcepacks', type: 'resourcepack' },
};
const kindLoaders = (kind, loader) => (kind === 'mod' ? [loader] : kind === 'shader' ? ['iris'] : ['minecraft']);

const sha1 = (buf) => crypto.createHash('sha1').update(buf).digest('hex');
const safeName = (n) => n.replace(/[^A-Za-z0-9._+-]/g, '_').replace(/^\.+/, '').slice(0, 120) || 'plik';

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

/** Lista zablokowanych przez administrację (z manifestu) → szybkie sprawdzanie. */
function blockIndex(blocked) {
  const byProject = new Map();
  const byModId = new Map();
  for (const b of blocked || []) {
    if (b.projectId) byProject.set(b.projectId, b);
    if (b.modId) byModId.set(String(b.modId).toLowerCase(), b);
  }
  return {
    find(entry) {
      return (entry.projectId && byProject.get(entry.projectId))
        || (entry.modId && byModId.get(String(entry.modId).toLowerCase())) || null;
    },
    project: (id) => byProject.get(id) || null,
  };
}
const blockMsg = (name, b) => `${name} jest zablokowany przez administrację serwera${b && b.reason ? ` (${b.reason})` : ''}.`;

class PlayerMods {
  constructor(gameDir, blocked = []) {
    this.dir = path.join(gameDir, 'mods-gracza');
    this.listFile = path.join(this.dir, 'lista.json');
    this.gameDir = gameDir;
    this.blocks = blockIndex(blocked);
  }

  storeDir(kind) { return path.join(this.dir, KINDS[kind || 'mod'].store); }

  list() {
    let l;
    try { l = JSON.parse(fs.readFileSync(this.listFile, 'utf8')); } catch { l = []; }
    return l.map((m) => {
      const b = this.blocks.find(m);
      return { kind: 'mod', ...m, blocked: b ? (b.reason || 'zablokowany') : null };
    });
  }
  save(list) {
    fs.mkdirSync(this.dir, { recursive: true });
    // eslint-disable-next-line no-unused-vars
    fs.writeFileSync(this.listFile, JSON.stringify(list.map(({ blocked, ...m }) => m), null, 2));
  }

  // ---------- Modrinth ----------

  /**
   * Szukanie / przeglądanie. opts: { kind: mod|shader|resourcepack, category, sort, offset }.
   * Zablokowane przez administrację nie są pokazywane.
   */
  static async search(query, mc, loader, opts = {}, blocked = []) {
    const kind = KINDS[opts.kind] ? opts.kind : 'mod';
    const f = [[`project_type:${KINDS[kind].type}`], [`versions:${mc}`]];
    if (kind === 'mod') f.push([`categories:${loader}`]);
    if (kind === 'shader') f.push(['categories:iris']);
    if (opts.category && /^[a-z0-9-]{2,30}$/.test(opts.category)) f.push([`categories:${opts.category}`]);
    const sort = ['downloads', 'newest', 'updated', 'relevance'].includes(opts.sort) ? opts.sort : (query ? 'relevance' : 'downloads');
    const offset = Math.max(0, Math.min(Number(opts.offset) || 0, 2000));
    const d = await getJson(`${API}/search?limit=20&offset=${offset}&index=${sort}&query=${encodeURIComponent(query || '')}&facets=${encodeURIComponent(JSON.stringify(f))}`);
    const blocks = blockIndex(blocked);
    return {
      total: d.total_hits,
      hits: d.hits.filter((h) => !blocks.project(h.project_id)).map((h) => ({
        id: h.project_id, title: h.title, description: h.description, icon: h.icon_url,
        downloads: h.downloads, author: h.author, kind,
        needsServer: kind === 'mod' && h.server_side === 'required',
        serverOnly: kind === 'mod' && h.client_side === 'unsupported',
      })),
    };
  }

  async addModrinth(projectId, mc, loader, kind = 'mod', requiredBy = null, depth = 0) {
    if (!KINDS[kind]) throw new Error('Nieznany rodzaj.');
    if (depth > 4) return [];
    const blocked = this.blocks.project(projectId);
    const list = this.list();
    const existing = list.find((m) => m.projectId === projectId);
    if (existing) {
      if (requiredBy && !(existing.requiredBy || []).includes(requiredBy)) {
        existing.requiredBy = [...(existing.requiredBy || []), requiredBy];
        this.save(list);
      }
      return [];
    }
    const loaders = kindLoaders(kind, loader);
    const [project, versions] = await Promise.all([
      getJson(`${API}/project/${encodeURIComponent(projectId)}`),
      getJson(`${API}/project/${encodeURIComponent(projectId)}/version?loaders=${encodeURIComponent(JSON.stringify(loaders))}&game_versions=${encodeURIComponent(JSON.stringify([mc]))}`),
    ]);
    if (blocked) throw new Error(blockMsg(project.title, blocked));
    let all = versions;
    let note = '';
    // shadery i paczki tekstur często nie mają oznaczonej każdej wersji gry – wtedy bierzemy najnowszą
    if (!all.length && kind !== 'mod') {
      all = await getJson(`${API}/project/${encodeURIComponent(projectId)}/version?loaders=${encodeURIComponent(JSON.stringify(loaders))}`);
      if (all.length) note = ` (nieoznaczona dla MC ${mc})`;
    }
    const v = all.find((x) => x.version_type === 'release') || all[0];
    if (!v) throw new Error(`${project.title} nie ma wersji na Minecraft ${mc}${kind === 'mod' ? ` (${loader})` : ''}.`);
    const file = v.files.find((f) => f.primary) || v.files[0];
    const buf = await getBuffer(file.url);
    if (file.hashes && file.hashes.sha1 && sha1(buf) !== file.hashes.sha1) throw new Error(`Uszkodzony plik ${file.filename} – spróbuj jeszcze raz.`);
    const name = safeName(file.filename);
    fs.mkdirSync(this.storeDir(kind), { recursive: true });
    fs.writeFileSync(path.join(this.storeDir(kind), name), buf);
    let modId = null;
    if (kind === 'mod') { try { modId = modInfo(buf).id; } catch { /* bez znaczenia */ } }
    const entry = {
      id: `mr:${projectId}`, kind, projectId, source: 'modrinth', name: project.title, version: v.version_number + note,
      file: name, sha1: sha1(buf), modId, enabled: true, requiredBy: requiredBy ? [requiredBy] : [],
      icon: project.icon_url || null,
      needsServer: kind === 'mod' && (project.server_side === 'required' || project.client_side === 'unsupported'),
    };
    const fresh = this.list().filter((m) => !((m.kind || 'mod') === kind && m.file === name));
    fresh.push(entry);
    this.save(fresh);
    const added = [entry.name];
    for (const dep of v.dependencies.filter((d) => d.dependency_type === 'required' && d.project_id)) {
      try { added.push(...await this.addModrinth(dep.project_id, mc, loader, 'mod', entry.id, depth + 1)); }
      catch (e) { added.push(`(nie udało się dodać wymaganego moda: ${e.message})`); }
    }
    return added;
  }

  /** Czy jest Iris (u gracza albo w paczce) – potrzebny do shaderów. */
  hasIris(packIds) {
    return packIds.has('iris') || this.list().some((m) => m.projectId === IRIS || m.modId === 'iris');
  }

  // ---------- z dysku ----------

  /** .jar = mod, .zip = shader albo paczka tekstur (rozpoznawane po zawartości). */
  addFile(filePath, loader) {
    const lower = filePath.toLowerCase();
    if (lower.endsWith('.zip')) return this.addPackFile(filePath);
    if (!lower.endsWith('.jar')) throw new Error('Wybierz plik .jar (mod) albo .zip (shader / paczka tekstur).');
    const buf = fs.readFileSync(filePath);
    if (buf.length > 100 * 1024 * 1024) throw new Error('Plik jest za duży (maks. 100 MB).');
    const info = modInfo(buf);
    if (!info.loader) throw new Error('To nie wygląda na mod do Minecrafta (brak opisu moda w pliku).');
    if (info.loader !== loader) {
      throw new Error(`To mod dla ${info.loader === 'neoforge' ? 'NeoForge' : info.loader[0].toUpperCase() + info.loader.slice(1)}, a serwer używa ${loader === 'neoforge' ? 'NeoForge' : loader}.`);
    }
    const b = info.id && this.blocks.find({ modId: info.id });
    if (b) throw new Error(blockMsg(info.name || info.id, b));
    return this.storeFile('mod', filePath, buf, { name: info.name, version: info.version, modId: info.id });
  }

  addPackFile(filePath) {
    const buf = fs.readFileSync(filePath);
    if (buf.length > 500 * 1024 * 1024) throw new Error('Plik jest za duży (maks. 500 MB).');
    let names;
    try { names = [...entries(buf).keys()]; } catch { throw new Error('To nie jest poprawny plik .zip.'); }
    let kind = null;
    if (names.some((n) => /^([^/]+\/)?shaders\//.test(n))) kind = 'shader';
    else if (names.some((n) => /^([^/]+\/)?pack\.mcmeta$/.test(n))) kind = 'resourcepack';
    if (!kind) throw new Error('Ten .zip nie wygląda ani na shader, ani na paczkę tekstur.');
    return this.storeFile(kind, filePath, buf, {});
  }

  storeFile(kind, filePath, buf, info) {
    const name = safeName(path.basename(filePath));
    const hash = sha1(buf);
    const list = this.list();
    if (list.some((m) => m.sha1 === hash)) throw new Error('To jest już na liście.');
    fs.mkdirSync(this.storeDir(kind), { recursive: true });
    fs.writeFileSync(path.join(this.storeDir(kind), name), buf);
    const entry = {
      id: `dysk:${hash.slice(0, 12)}`, kind, source: 'dysk', name: info.name || name.replace(/\.(jar|zip)$/i, ''), version: info.version || '',
      file: name, sha1: hash, modId: info.modId || null, enabled: true, requiredBy: [],
    };
    this.save(list.filter((m) => !((m.kind || 'mod') === kind && m.file === name)).concat(entry));
    return entry;
  }

  // ---------- zarządzanie ----------

  setEnabled(id, enabled) {
    const list = this.list();
    const m = list.find((x) => x.id === id);
    if (!m) throw new Error('Nie ma takiej pozycji.');
    if (enabled && m.blocked) throw new Error(blockMsg(m.name, { reason: m.blocked === 'zablokowany' ? '' : m.blocked }));
    m.enabled = !!enabled;
    this.save(list);
  }

  remove(id) {
    let list = this.list();
    const removeOne = (rid) => {
      const m = list.find((x) => x.id === rid);
      if (!m) return;
      list = list.filter((x) => x.id !== rid);
      fs.rmSync(path.join(this.storeDir(m.kind), m.file), { force: true });
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
    const out = [];
    for (const kind of Object.keys(KINDS)) {
      const part = list.filter((m) => m.kind === kind);
      if (!part.length) continue;
      const res = await getJson(`${API}/version_files/update`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hashes: part.map((m) => m.sha1), algorithm: 'sha1', loaders: kindLoaders(kind, loader), game_versions: [mc] }),
      });
      for (const m of part) {
        const v = res[m.sha1];
        if (!v) continue;
        const f = v.files.find((x) => x.primary) || v.files[0];
        if (f && f.hashes.sha1 !== m.sha1) out.push({ id: m.id, name: m.name, from: m.version, to: v.version_number, url: f.url, filename: f.filename, sha1: f.hashes.sha1 });
      }
    }
    return out;
  }

  async applyUpdate(u) {
    const buf = await getBuffer(u.url);
    if (sha1(buf) !== u.sha1) throw new Error(`Uszkodzony plik ${u.filename}.`);
    const list = this.list();
    const m = list.find((x) => x.id === u.id);
    if (!m) return;
    const dir = this.storeDir(m.kind);
    const name = safeName(u.filename);
    if (name !== m.file) fs.rmSync(path.join(dir, m.file), { force: true });
    fs.writeFileSync(path.join(dir, name), buf);
    Object.assign(m, { file: name, sha1: u.sha1, version: u.to });
    this.save(list);
  }

  // ---------- przed startem gry ----------

  /**
   * Kopiuje włączone pozycje gracza (gracz-*) do mods/, shaderpacks/, resourcepacks/ i usuwa resztę gracz-*.
   * packModIds: Set modId modów z paczki (te wygrywają). withoutMine: „Uruchom bez moich modów” (dotyczy modów).
   */
  install(packModIds, withoutMine, log) {
    const want = { mod: new Map(), shader: new Map(), resourcepack: new Map() };
    for (const m of this.list().filter((x) => x.enabled)) {
      if (m.blocked) { log(`Moje mody: „${m.name}” jest zablokowany przez administrację – pomijam.`); continue; }
      if (m.kind === 'mod' && withoutMine) continue;
      if (m.kind === 'mod' && m.modId && packModIds.has(m.modId)) { log(`Moje mody: „${m.name}” jest już w paczce serwera – używam wersji z paczki.`); continue; }
      const src = path.join(this.storeDir(m.kind), m.file);
      if (fs.existsSync(src)) want[m.kind].set(PREFIX + m.file, src);
    }
    for (const [kind, map] of Object.entries(want)) {
      const target = path.join(this.gameDir, KINDS[kind].dir);
      fs.mkdirSync(target, { recursive: true });
      for (const f of fs.readdirSync(target)) {
        if (f.startsWith(PREFIX) && !map.has(f)) fs.rmSync(path.join(target, f), { force: true, recursive: true });
      }
      for (const [dest, src] of map) {
        const d = path.join(target, dest);
        if (!fs.existsSync(d) || fs.statSync(d).size !== fs.statSync(src).size) fs.copyFileSync(src, d);
      }
    }
    if (withoutMine) log('Uruchamiam bez Twoich modów.');
    else if (want.mod.size) log(`Moje mody: ${want.mod.size} włączonych.`);
    return want.mod.size;
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

module.exports = { PlayerMods, packModIds, PREFIX, IRIS, KINDS };
