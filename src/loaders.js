const fs = require('fs');
const path = require('path');
const { ensureNeoForge, getNeoForgeJvmArgs } = require('./neoforge');

// Obsługiwane silniki (pack.json → "loader": { "type": ..., "version": ... }).
const LOADERS = {
  vanilla: 'Minecraft (bez modów)',
  fabric: 'Fabric',
  neoforge: 'NeoForge',
};

/** Argumenty JVM z pliku wersji (MCLC ich nie przekazuje). Wspólne dla Fabric i NeoForge. */
function versionJvmArgs(gameDir, versionId) {
  return getNeoForgeJvmArgs(gameDir, versionId);
}

/**
 * Fabric: profil wersji pobierany z meta.fabricmc.net (bez instalatora).
 * Biblioteki i główną klasę bierze z niego minecraft-launcher-core.
 */
async function ensureFabric(gameDir, mcVersion, loaderVersion, log) {
  const url = `https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(mcVersion)}/${encodeURIComponent(loaderVersion)}/profile/json`;
  const expectedId = `fabric-loader-${loaderVersion}-${mcVersion}`;
  const existing = path.join(gameDir, 'versions', expectedId, `${expectedId}.json`);
  if (fs.existsSync(existing)) return expectedId;

  log(`Pobieranie Fabric ${loaderVersion} dla MC ${mcVersion}...`);
  let res;
  try {
    res = await fetch(url, { headers: { 'User-Agent': 'melinasmp-launcher' } });
  } catch (e) {
    throw new Error(`Brak połączenia z serwerem Fabric (${e.message}).`);
  }
  if (res.status === 400 || res.status === 404) {
    throw new Error(`Fabric ${loaderVersion} nie istnieje dla Minecraft ${mcVersion} – sprawdź "loader.version" w pack.json.`);
  }
  if (!res.ok) throw new Error(`Serwer Fabric odpowiedział HTTP ${res.status}.`);
  const profile = await res.json();
  if (!profile || !profile.id || !Array.isArray(profile.libraries)) {
    throw new Error('Serwer Fabric zwrócił niepoprawny profil wersji.');
  }

  const dir = path.join(gameDir, 'versions', profile.id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${profile.id}.json`), JSON.stringify(profile, null, 2));
  log(`Fabric gotowy (${profile.id}).`);
  return profile.id;
}

/**
 * Instaluje silnik z manifestu (jeśli trzeba).
 * Zwraca { versionId (null dla vanilla), jvmArgs[] }.
 */
async function ensureLoader(gameDir, manifest, javaExe, log) {
  const loader = manifest.loader || { type: 'vanilla' };
  const type = String(loader.type || 'vanilla').toLowerCase();
  const mc = manifest.minecraft;

  switch (type) {
    case 'vanilla':
      log(`Silnik: Minecraft ${mc} (bez modów)`);
      return { versionId: null, jvmArgs: [] };

    case 'fabric': {
      if (!loader.version) throw new Error('pack.json: brak "loader.version" dla Fabric.');
      const versionId = await ensureFabric(gameDir, mc, loader.version, log);
      return { versionId, jvmArgs: versionJvmArgs(gameDir, versionId) };
    }

    case 'neoforge': {
      if (!loader.version) throw new Error('pack.json: brak "loader.version" dla NeoForge.');
      const versionId = await ensureNeoForge(gameDir, loader.version, javaExe, log);
      return { versionId, jvmArgs: versionJvmArgs(gameDir, versionId) };
    }

    default:
      throw new Error(`Nieobsługiwany silnik "${loader.type}". Obsługiwane: ${Object.keys(LOADERS).join(', ')}.`);
  }
}

module.exports = { ensureLoader, LOADERS };
