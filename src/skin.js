// Zmiana skina konta Microsoft przez oficjalne API Minecraft (to samo, którego używa oficjalny launcher).
const API = 'https://api.minecraftservices.com/minecraft/profile';
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Sprawdza, czy plik to PNG 64×64 lub 64×32. Zwraca { width, height } albo rzuca błąd po polsku. */
function validateSkin(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 24 || !buf.subarray(0, 8).equals(PNG_SIG)) {
    throw new Error('To nie jest plik PNG.');
  }
  if (buf.length > 1024 * 1024) throw new Error('Plik jest za duży (maks. 1 MB).');
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  if (width !== 64 || (height !== 64 && height !== 32)) {
    throw new Error(`Skin musi mieć 64×64 albo 64×32 piksele (ten ma ${width}×${height}).`);
  }
  return { width, height };
}

async function apiError(res, what) {
  let msg = '';
  try {
    const j = await res.json();
    msg = j.errorMessage || j.error || j.developerMessage || '';
  } catch { /* brak treści */ }
  if (res.status === 401) return new Error('Sesja wygasła – usuń konto i dodaj je ponownie.');
  if (res.status === 429) return new Error('Za dużo zmian naraz – odczekaj chwilę i spróbuj ponownie.');
  if (res.status === 404) return new Error('To konto nie ma Minecrafta (brak profilu).');
  return new Error(`${what}: HTTP ${res.status}${msg ? ` – ${msg}` : ''}`);
}

function activeSkin(profile) {
  const s = (profile.skins || []).find((x) => x.state === 'ACTIVE') || (profile.skins || [])[0];
  return s ? { url: String(s.url).replace(/^http:/, 'https:'), variant: s.variant === 'SLIM' ? 'slim' : 'classic' } : null;
}

function capesOf(profile) {
  return (profile.capes || []).map((c) => ({
    id: c.id,
    name: c.alias || 'Peleryna',
    url: String(c.url).replace(/^http:/, 'https:'),
    active: c.state === 'ACTIVE',
  }));
}

async function getProfile(token) {
  const res = await fetch(API, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw await apiError(res, 'Nie udało się pobrać profilu');
  const p = await res.json();
  return { id: p.id, name: p.name, skin: activeSkin(p), capes: capesOf(p) };
}

async function toDataUrl(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Nie udało się pobrać skina (HTTP ${res.status})`);
  return `data:image/png;base64,${Buffer.from(await res.arrayBuffer()).toString('base64')}`;
}

async function uploadSkin(token, buf, variant) {
  validateSkin(buf);
  const form = new FormData();
  form.append('variant', variant === 'slim' ? 'slim' : 'classic');
  form.append('file', new Blob([buf], { type: 'image/png' }), 'skin.png');
  const res = await fetch(`${API}/skins`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
  if (!res.ok) throw await apiError(res, 'Nie udało się ustawić skina');
}

async function resetSkin(token) {
  const res = await fetch(`${API}/skins/active`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw await apiError(res, 'Nie udało się przywrócić domyślnego skina');
}

/** Zakłada posiadaną pelerynę (id) albo ją chowa (null). */
async function setCape(token, capeId) {
  const res = capeId
    ? await fetch(`${API}/capes/active`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ capeId }),
    })
    : await fetch(`${API}/capes/active`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw await apiError(res, capeId ? 'Nie udało się założyć peleryny' : 'Nie udało się schować peleryny');
}

module.exports = { validateSkin, getProfile, toDataUrl, uploadSkin, resetSkin, setCape };
