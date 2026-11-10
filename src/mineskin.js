const fs = require('fs');
const path = require('path');

// Zamiana pliku PNG na prawdziwego skina Minecrafta (podpisanego) przez MineSkin.
// Zwracany adres textures.minecraft.net podajemy SkinRestorerowi: /skin set web <model> "<adres>".
const API = 'https://api.mineskin.org/v2/generate';

/** Klucz API: secrets.json (lokalnie / wstawiany przy budowaniu z sekretu GitHuba). */
function mineskinKey(appDir) {
  try {
    const s = JSON.parse(fs.readFileSync(path.join(appDir, 'secrets.json'), 'utf8'));
    return s.mineskinKey || null;
  } catch { return null; }
}

function firstError(j) {
  if (!j) return '';
  if (Array.isArray(j.errors) && j.errors.length) return j.errors[0].message || j.errors[0].code || '';
  return j.error || j.message || '';
}

/** Wysyła skina do MineSkin, zwraca https://textures.minecraft.net/texture/<hash>. */
async function generateSkin(key, buf, variant, label) {
  if (!key) throw new Error('Brak klucza MineSkin w tej wersji launchera.');
  const form = new FormData();
  form.append('file', new Blob([buf], { type: 'image/png' }), 'skin.png');
  form.append('variant', variant === 'slim' ? 'slim' : 'classic');
  form.append('visibility', 'unlisted');
  if (label) form.append('name', String(label).slice(0, 20));

  let res;
  try {
    res = await fetch(API, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'User-Agent': 'MelinaSMP-Launcher' },
      body: form,
    });
  } catch (e) {
    throw new Error(`Brak połączenia z MineSkin (${e.message}).`);
  }
  const text = await res.text();
  let j = null;
  try { j = JSON.parse(text); } catch { /* nie-JSON */ }

  if (res.status === 429) throw new Error('MineSkin: za dużo skinów naraz – spróbuj za minutę.');
  if (res.status === 401 || res.status === 403) throw new Error('MineSkin odrzucił klucz API – trzeba go zaktualizować w launcherze.');
  if (!res.ok || (j && j.success === false)) {
    throw new Error(`MineSkin: ${firstError(j) || `HTTP ${res.status}`}`);
  }

  const url = (j && j.skin && j.skin.texture && j.skin.texture.url && j.skin.texture.url.skin)
    || (text.match(/https?:\/\/textures\.minecraft\.net\/texture\/[0-9a-f]+/i) || [])[0];
  if (!url) throw new Error('MineSkin nie zwrócił adresu skina.');
  return url.replace(/^http:/, 'https:');
}

/** Komenda SkinRestorera (cudzysłów wymagany przy adresach). */
function skinCommand(variant, url) {
  return `/skin set web ${variant === 'slim' ? 'slim' : 'classic'} "${url}"`;
}

module.exports = { mineskinKey, generateSkin, skinCommand };
