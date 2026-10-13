// Usage: npm run find-stop -- bedford
// Downloads the MTA's static subway GTFS (stops.txt) and prints matching platform stop IDs.
// IDs ending in N are northbound (usually toward Manhattan/the Bronx), S southbound.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const q = process.argv.slice(2).join(' ').toLowerCase();
if (!q) {
  console.log('Usage: npm run find-stop -- <station name>');
  process.exit(1);
}
const res = await fetch('https://rrgtfsfeeds.s3.amazonaws.com/gtfs_subway.zip');
if (!res.ok) throw new Error(`Download failed: ${res.status}`);
const dir = mkdtempSync(path.join(tmpdir(), 'gtfs-'));
try {
  const zip = path.join(dir, 'gtfs.zip');
  writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
  const stops = execFileSync('unzip', ['-p', zip, 'stops.txt'], { encoding: 'utf8' });
  const [header, ...lines] = stops.trim().split(/\r?\n/);
  const cols = header.split(',');
  const idx = (n) => cols.indexOf(n);
  for (const line of lines) {
    const f = line.split(',');
    const id = f[idx('stop_id')];
    const name = f[idx('stop_name')];
    if (/[NS]$/.test(id) && name.toLowerCase().includes(q)) {
      console.log(`${id.padEnd(6)} ${name} (${id.endsWith('N') ? 'northbound' : 'southbound'})`);
    }
  }
  console.log('\nPut a stop ID and the lines that stop there in config.json -> subway.stops');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
