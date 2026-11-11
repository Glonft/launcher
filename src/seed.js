// Duże pliki „startowe” z dodatków (np. teren Distant Horizons przygotowany przez admina).
//
// Różnią się od zwykłych plików paczki:
//  - gra je zmienia (DH dopisuje teren), więc NIE porównujemy ich z hashem przy każdym starcie –
//    pamiętamy tylko, którą wersję od admina już wgraliśmy (.melinasmp-seed.json),
//  - pobierają się w tle (gra może ruszyć wcześniej), z wznawianiem przerwanego pobierania,
//  - przed podmianą robimy kopię danych gracza (<plik>.kopia),
//  - wyłączenie dodatku NIE kasuje danych gracza.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Readable, Transform } = require('stream');
const { pipeline } = require('stream/promises');

const STATE = '.melinasmp-seed.json';
const MARGIN = 300 * 1024 * 1024; // zapas wolnego miejsca

const hashOf = (f) => (f.sha256 ? `sha256:${f.sha256.toLowerCase()}` : `sha1:${String(f.sha1).toLowerCase()}`);

function readState(gameDir) {
  try { return JSON.parse(fs.readFileSync(path.join(gameDir, STATE), 'utf8')); } catch { return {}; }
}
function writeState(gameDir, state) {
  fs.writeFileSync(path.join(gameDir, STATE), JSON.stringify(state, null, 2));
}

function hashFile(file, algo) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash(algo);
    fs.createReadStream(file).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });
}

function freeBytes(dir) {
  try {
    const s = fs.statfsSync(dir);
    return Number(s.bavail) * Number(s.bsize);
  } catch { return Infinity; } // nie da się sprawdzić – nie blokujemy
}

const paths = (dest) => ({ part: `${dest}.melina-new.part`, ready: `${dest}.melina-new`, marker: `${dest}.melina-new.json`, backup: `${dest}.kopia` });

/** Pliki seed z włączonych dodatków, z docelową ścieżką. */
function seedFiles(enabledGroups, gameDir, safeJoin) {
  return enabledGroups.flatMap((g) => g.files.filter((f) => f.seed).map((f) => ({ ...f, group: g.name, dest: safeJoin(gameDir, f.path) })));
}

/**
 * Przed startem gry: wgrywa w pełni pobrane i sprawdzone nowe wersje (gra jeszcze nie działa,
 * więc pliki nie są zablokowane). Zwraca listę plików, które trzeba jeszcze pobrać.
 */
function applyReady(seeds, gameDir, log) {
  const state = readState(gameDir);
  const todo = [];
  for (const f of seeds) {
    const want = hashOf(f);
    const p = paths(f.dest);
    if (fs.existsSync(p.ready) && fs.existsSync(p.marker)) {
      let marker = {};
      try { marker = JSON.parse(fs.readFileSync(p.marker, 'utf8')); } catch { /* uszkodzony znacznik */ }
      if (marker.hash === want) {
        if (fs.existsSync(f.dest)) {
          fs.rmSync(p.backup, { force: true });
          fs.renameSync(f.dest, p.backup);
          log(`„${f.group}”: Twoje dotychczasowe dane zapisano jako ${path.basename(p.backup)}`);
        }
        fs.renameSync(p.ready, f.dest);
        fs.rmSync(p.marker, { force: true });
        state[f.path] = { hash: want, installed: new Date().toISOString() };
        writeState(gameDir, state);
        log(`„${f.group}”: wgrano ${f.path}`);
        continue;
      }
      // stara, nieaktualna wersja czekająca na wgranie – do kosza
      fs.rmSync(p.ready, { force: true });
      fs.rmSync(p.marker, { force: true });
    }
    if (state[f.path] && state[f.path].hash === want && fs.existsSync(f.dest)) continue;
    todo.push(f);
  }
  return todo;
}

/** Sprząta pobierane pliki dodatków, które gracz wyłączył (dane gracza zostają). */
function cleanupDisabled(manifest, enabledIds, gameDir, safeJoin, log) {
  for (const g of manifest.optional || []) {
    if (enabledIds.has(g.id)) continue;
    for (const f of g.files.filter((x) => x.seed)) {
      const p = paths(safeJoin(gameDir, f.path));
      for (const tmp of [p.part, p.ready, p.marker]) {
        if (fs.existsSync(tmp)) { fs.rmSync(tmp, { force: true }); log(`Wyłączony dodatek „${g.name}”: przerwano pobieranie`); }
      }
    }
  }
}

async function downloadResumable(f, onProgress) {
  const p = paths(f.dest);
  fs.mkdirSync(path.dirname(f.dest), { recursive: true });
  let have = fs.existsSync(p.part) ? fs.statSync(p.part).size : 0;
  if (f.size && have > f.size) { fs.rmSync(p.part); have = 0; }

  if (f.size && have < f.size) {
    const need = f.size - have + MARGIN;
    const free = freeBytes(path.dirname(f.dest));
    if (free < need) {
      throw new Error(`Za mało miejsca na dysku na „${f.group}”: potrzeba ${(need / 1e9).toFixed(1)} GB, wolne ${(free / 1e9).toFixed(1)} GB.`);
    }
  }

  if (!f.size || have < f.size) {
    const headers = { 'User-Agent': 'melinasmp-launcher' };
    if (have > 0) headers.Range = `bytes=${have}-`;
    const res = await fetch(f.url, { headers });
    if (res.status === 416) { fs.rmSync(p.part, { force: true }); throw new Error('Serwer odrzucił wznowienie – spróbuję od początku.'); }
    if (!res.ok) throw new Error(`HTTP ${res.status} przy pobieraniu ${path.basename(f.path)}`);
    const append = res.status === 206 && have > 0;
    if (!append) have = 0;
    const total = f.size || (Number(res.headers.get('content-length')) || 0) + have;
    let done = have;
    const tap = new Transform({
      transform(chunk, _e, cb) {
        const buf = Buffer.from(chunk);
        done += buf.length;
        onProgress(done, total);
        cb(null, buf);
      },
    });
    await pipeline(Readable.fromWeb(res.body), tap, fs.createWriteStream(p.part, { flags: append ? 'a' : 'w' }));
  }

  const size = fs.statSync(p.part).size;
  if (f.size && size !== f.size) throw new Error(`Niepełny plik (${size}/${f.size} B) – dokończę przy następnym uruchomieniu.`);
  const algo = f.sha256 ? 'sha256' : 'sha1';
  const got = await hashFile(p.part, algo);
  if (got !== (f.sha256 || f.sha1).toLowerCase()) {
    fs.rmSync(p.part, { force: true });
    throw new Error(`Uszkodzony plik ${path.basename(f.path)} – pobiorę go od nowa.`);
  }
  fs.renameSync(p.part, p.ready);
  fs.writeFileSync(p.marker, JSON.stringify({ hash: hashOf(f) }));
}

/**
 * Pobiera pliki w tle. onStatus({ name, done, total }) / onStatus(null) na koniec.
 * Gotowe pliki wgrywają się przy następnym starcie gry (applyReady).
 */
async function downloadInBackground(todo, log, onStatus) {
  for (const f of todo) {
    log(`„${f.group}”: pobieranie w tle ${path.basename(f.path)}${f.size ? ` (${(f.size / 1e9).toFixed(2)} GB)` : ''}...`);
    let ok = false;
    for (let attempt = 1; attempt <= 3 && !ok; attempt++) {
      try {
        await downloadResumable(f, (done, total) => onStatus({ name: f.group, done, total }));
        ok = true;
        log(`„${f.group}”: pobrano. Zostanie wgrane przy następnym uruchomieniu gry.`);
      } catch (e) {
        log(`„${f.group}”: ${e.message === 'terminated' || /fetch failed|ECONN|socket/i.test(e.message) ? 'przerwane połączenie, wznawiam…' : e.message}`);
        if (/miejsca/.test(e.message)) break;
        if (attempt < 3) await new Promise((r) => setTimeout(r, 3000 * attempt));
      }
    }
  }
  onStatus(null);
}

module.exports = { seedFiles, applyReady, cleanupDisabled, downloadInBackground, hashOf, paths, STATE };
