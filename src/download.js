const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Readable, Transform } = require('stream');
const { pipeline } = require('stream/promises');

function sha1File(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha1');
    fs.createReadStream(file)
      .on('data', (d) => h.update(d))
      .on('end', () => resolve(h.digest('hex')))
      .on('error', reject);
  });
}

async function downloadOnce(url, dest, expectedSha1, onProgress) {
  const res = await fetch(url, { headers: { 'User-Agent': 'melinasmp-launcher' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} przy pobieraniu ${url}`);

  const total = Number(res.headers.get('content-length')) || 0;
  const tmp = dest + '.part';
  let done = 0;

  // Każdy fragment jest kopiowany (Buffer.from), bo bufor ze strumienia
  // może zostać ponownie użyty, zanim zostanie zapisany na dysk.
  const tap = new Transform({
    transform(chunk, _enc, cb) {
      const buf = Buffer.from(chunk);
      done += buf.length;
      if (onProgress) onProgress(done, total);
      cb(null, buf);
    },
  });

  try {
    await pipeline(Readable.fromWeb(res.body), tap, fs.createWriteStream(tmp));

    const size = fs.statSync(tmp).size;
    if (total && size !== total) {
      throw new Error(`Niepełny plik ${path.basename(dest)} (${size}/${total} B)`);
    }
    // Weryfikacja tego, co faktycznie jest na dysku
    if (expectedSha1) {
      const sha1 = await sha1File(tmp);
      if (sha1 !== expectedSha1.toLowerCase()) {
        throw new Error(`Zły hash pliku ${path.basename(dest)} (oczekiwano ${expectedSha1}, jest ${sha1})`);
      }
    }
    fs.renameSync(tmp, dest);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw e;
  }
}

/** Pobiera plik do `dest` (3 próby), opcjonalnie sprawdzając SHA-1. */
async function download(url, dest, expectedSha1, onProgress) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await downloadOnce(url, dest, expectedSha1, onProgress);
    } catch (e) {
      lastErr = e;
      if (attempt < 3) await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
  throw lastErr;
}

module.exports = { download, sha1File };
