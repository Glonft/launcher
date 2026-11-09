const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

/** Pobiera plik do `dest`, opcjonalnie sprawdzając SHA-1. */
async function download(url, dest, expectedSha1, onProgress) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const res = await fetch(url, { headers: { 'User-Agent': 'moj-launcher' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} przy pobieraniu ${url}`);

  const total = Number(res.headers.get('content-length')) || 0;
  const hash = crypto.createHash('sha1');
  const tmp = dest + '.part';
  let done = 0;

  const body = Readable.fromWeb(res.body);
  body.on('data', (chunk) => {
    done += chunk.length;
    hash.update(chunk);
    if (onProgress) onProgress(done, total);
  });
  await pipeline(body, fs.createWriteStream(tmp));

  const sha1 = hash.digest('hex');
  if (expectedSha1 && sha1 !== expectedSha1.toLowerCase()) {
    fs.rmSync(tmp, { force: true });
    throw new Error(`Zły hash pliku ${path.basename(dest)} (oczekiwano ${expectedSha1}, jest ${sha1})`);
  }
  fs.renameSync(tmp, dest);
}

function sha1File(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha1');
    fs.createReadStream(file)
      .on('data', (d) => h.update(d))
      .on('end', () => resolve(h.digest('hex')))
      .on('error', reject);
  });
}

module.exports = { download, sha1File };
