const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { download } = require('./download');

function run(cmd, args, log) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { windowsHide: true });
    p.stdout.on('data', (d) => log(d.toString().trim()));
    p.stderr.on('data', (d) => log(d.toString().trim()));
    p.on('close', (code) => resolve(code));
    p.on('error', (e) => { log(String(e)); resolve(-1); });
  });
}

/** Instaluje NeoForge (jeśli brak) i zwraca id wersji, np. "neoforge-21.1.265". */
async function ensureNeoForge(gameDir, neoVersion, javaExe, log) {
  const versionId = `neoforge-${neoVersion}`;
  const json = path.join(gameDir, 'versions', versionId, `${versionId}.json`);
  if (fs.existsSync(json)) return versionId;

  // Instalator wymaga tego pliku w folderze docelowym
  const profiles = path.join(gameDir, 'launcher_profiles.json');
  if (!fs.existsSync(profiles)) fs.writeFileSync(profiles, JSON.stringify({ profiles: {} }));

  const url = `https://maven.neoforged.net/releases/net/neoforged/neoforge/${neoVersion}/neoforge-${neoVersion}-installer.jar`;
  const installer = path.join(gameDir, 'cache', `neoforge-${neoVersion}-installer.jar`);
  log(`Pobieranie instalatora NeoForge ${neoVersion}...`);
  await download(url, installer);

  log('Instalowanie NeoForge (pierwsze uruchomienie może potrwać kilka minut)...');
  let code = await run(javaExe, ['-jar', installer, '--install-client', gameDir], log);
  if (code !== 0) code = await run(javaExe, ['-jar', installer, '--installClient', gameDir], log);
  if (code !== 0 || !fs.existsSync(json)) throw new Error('Instalacja NeoForge nie powiodła się – zobacz log.');

  return versionId;
}

/**
 * Argumenty JVM z pliku wersji NeoForge (module path, --add-opens itd.).
 * minecraft-launcher-core ich nie przekazuje, a bez nich gra pada na starcie
 * z "module java.base does not opens java.lang.invoke".
 */
function getNeoForgeJvmArgs(gameDir, versionId) {
  const json = JSON.parse(
    fs.readFileSync(path.join(gameDir, 'versions', versionId, `${versionId}.json`), 'utf8')
  );
  const raw = (json.arguments && json.arguments.jvm) || [];
  const vars = {
    library_directory: path.join(gameDir, 'libraries'),
    classpath_separator: path.delimiter,
    version_name: versionId,
  };
  const out = [];
  for (const a of raw) {
    if (typeof a !== 'string') continue; // wpisy warunkowe (rules) pomijamy
    out.push(a.replace(/\$\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m)));
  }
  return out;
}

module.exports = { ensureNeoForge, getNeoForgeJvmArgs };
