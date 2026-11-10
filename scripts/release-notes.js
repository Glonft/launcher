// Tworzy build/release-notes.md z sekcji CHANGELOG.md dla wersji z package.json.
// electron-builder używa tego pliku jako opisu wydania na GitHubie.
// Brak sekcji dla tej wersji przerywa budowanie – żeby nie wydać wersji bez opisu zmian.
const fs = require('fs');
const path = require('path');
const { parseChangelog } = require('../src/changelog');

const root = path.join(__dirname, '..');
const version = require(path.join(root, 'package.json')).version;
const entries = parseChangelog(fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8'));
const entry = entries.find((e) => e.version === version);

if (!entry || !entry.items.length) {
  console.error(`BŁĄD: w CHANGELOG.md brakuje sekcji "## ${version}" z listą zmian.`);
  process.exit(1);
}

const body = `## Co nowego w ${version}\n\n${entry.items.map((i) => `- ${i}`).join('\n')}\n`;
fs.mkdirSync(path.join(root, 'build'), { recursive: true });
fs.writeFileSync(path.join(root, 'build', 'release-notes.md'), body);
console.log(body);
