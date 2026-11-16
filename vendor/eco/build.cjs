const fs = require('fs');
const path = require('path');
const dir = 'vendor/eco';
const letters = ['a','b','c','d','e'];
const entries = [];
for (const letter of letters) {
  const text = fs.readFileSync(path.join(dir, letter + '.tsv'), 'utf8').replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/).filter(Boolean);
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split('\t');
    if (cols.length < 3) continue;
    const [eco, name, pgn] = cols;
    const moves = pgn
      .replace(/\{[^}]*\}/g, ' ')
      .replace(/\d+\.(\.\.)?/g, ' ')
      .replace(/\$\d+/g, ' ')
      .replace(/1-0|0-1|1\/2-1\/2|\*/g, ' ')
      .split(/\s+/)
      .map(s => s.trim())
      .filter(Boolean)
      .map(s => s.replace(/[!?]+$/g, ''));
    if (!moves.length) continue;
    entries.push({ eco, name, moves });
  }
}
fs.writeFileSync(path.join(dir, 'openings.json'), JSON.stringify(entries));
console.log('entries', entries.length, 'bytes', fs.statSync(path.join(dir, 'openings.json')).size);
