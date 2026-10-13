// Usage: npm run find-station -- bedford      (search by name)
//        npm run find-station -- 40.7081 -73.9571   (nearest to a point)
import { stationInfo, distanceMeters } from '../server/sources/citibike.js';

const args = process.argv.slice(2);
if (!args.length) {
  console.log('Usage: npm run find-station -- <name words>   or   npm run find-station -- <lat> <lon>');
  process.exit(1);
}
const info = await stationInfo();
let rows;
if (args.length === 2 && args.every((a) => !isNaN(Number(a)))) {
  const [lat, lon] = args.map(Number);
  rows = info
    .map((s) => ({ ...s, d: distanceMeters(lat, lon, s.lat, s.lon) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, 10);
} else {
  const q = args.join(' ').toLowerCase();
  rows = info.filter((s) => s.name.toLowerCase().includes(q)).slice(0, 20);
}
for (const s of rows) {
  console.log(`${s.station_id}  ${s.name}${s.d != null ? `  (${Math.round(s.d)} m)` : ''}`);
}
console.log('\nPut the IDs you want in config.json -> citibike.stationIds');
