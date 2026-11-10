const fs = require('fs');
const { newer } = require('./portable-updater');

/** CHANGELOG.md → [{ version, date, items: [...] }], najnowsze pierwsze. */
function parseChangelog(text) {
  const clean = String(text).replace(/\r\n/g, '\n').replace(/<!--[\s\S]*?-->/g, '');
  return clean
    .split(/^## +/m)
    .slice(1)
    .map((chunk) => {
      const [head, ...rest] = chunk.split('\n');
      const m = head.match(/^v?(\d+\.\d+\.\d+)\s*(?:[-–—]\s*(.*))?$/);
      if (!m) return null;
      const items = rest.map((l) => l.trim()).filter((l) => l.startsWith('- ')).map((l) => l.slice(2).trim());
      return { version: m[1], date: (m[2] || '').trim(), items };
    })
    .filter(Boolean);
}

function readChangelog(file) {
  try { return parseChangelog(fs.readFileSync(file, 'utf8')); } catch { return []; }
}

/** Wpisy nowsze niż `since` i nie nowsze niż `current`. */
function entriesBetween(entries, since, current) {
  return entries.filter((e) => newer(e.version, since) && !newer(e.version, current));
}

module.exports = { parseChangelog, readChangelog, entriesBetween };
