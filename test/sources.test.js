import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickStations, mergeStatus } from '../server/sources/citibike.js';
import { parseWeather } from '../server/sources/weather.js';
import { createApp } from '../server/app.js';
import { cached } from '../server/cache.js';

test('Citi Bike: nearest stations by distance, split classic and e-bikes', () => {
  const info = [
    { station_id: 'far', name: 'Far', lat: 40.75, lon: -73.99 },
    { station_id: 'near', name: 'Near', lat: 40.7082, lon: -73.9572 },
    { station_id: 'mid', name: 'Mid', lat: 40.712, lon: -73.96 },
  ];
  const picked = pickStations(info, { near: { latitude: 40.7081, longitude: -73.9571, count: 2 } });
  assert.deepEqual(picked.map((s) => s.station_id), ['near', 'mid']);
  const status = [{ station_id: 'near', num_bikes_available: 7, num_ebikes_available: 3, num_docks_available: 12, is_renting: 1 }];
  const [near, mid] = mergeStatus(picked, status);
  assert.deepEqual([near.classic, near.ebikes, near.docks, near.active], [4, 3, 12, true]);
  assert.equal(mid.active, false);
  assert.throws(() => pickStations(info, { stationIds: ['nope'] }), /not found/);
});

test('weather: hourly starts at the current hour', () => {
  const t0 = Date.parse('2026-10-13T15:00:00Z') / 1000;
  const hours = Array.from({ length: 30 }, (_, i) => t0 + i * 3600);
  const json = {
    current_units: { temperature_2m: '°F', wind_speed_10m: 'mp/h' },
    current: { temperature_2m: 61.4, apparent_temperature: 59, relative_humidity_2m: 50, weather_code: 2, wind_speed_10m: 8.2, is_day: 1 },
    hourly: { time: hours, temperature_2m: hours.map((_, i) => 60 + i), precipitation_probability: hours.map(() => 10), weather_code: hours.map(() => 1), is_day: hours.map(() => 1) },
    daily: { time: [t0], temperature_2m_max: [66.6], temperature_2m_min: [50.2], precipitation_probability_max: [30], weather_code: [3], sunrise: [t0], sunset: [t0] },
  };
  const w = parseWeather(json, { label: 'Home' }, Date.parse('2026-10-13T16:20:00Z'));
  assert.equal(w.current.temp, 61);
  assert.equal(w.hourly[0].temp, 61); // the 16:00 slot
  assert.equal(w.hourly.length, 12);
  assert.equal(w.daily[0].high, 67);
});

test('cache serves stale data when a refresh fails', async () => {
  let n = 0;
  const get = cached(0, async () => {
    if (++n > 1) throw new Error('boom');
    return { v: 1 };
  });
  assert.deepEqual(await get(), { v: 1 });
  assert.deepEqual(await get(), { v: 1, stale: true, error: 'boom' });
});

test('server returns per-source data and errors, serves the page, blocks traversal', async () => {
  const config = { timezone: 'America/New_York' };
  const app = createApp(config, {
    weather: async () => ({ ok: 1 }),
    subway: async () => { throw new Error('feed down'); },
  });
  await new Promise((r) => app.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.address().port}`;
  try {
    const body = await (await fetch(`${base}/api/dashboard`)).json();
    assert.deepEqual(body.weather, { ok: 1 });
    assert.deepEqual(body.subway, { error: 'feed down' });
    assert.ok([-240, -300].includes(body.tzOffsetMin));
    assert.match(await (await fetch(base + '/')).text(), /<title>Home Dashboard/);
    assert.equal((await fetch(`${base}/..%2fpackage.json`)).status, 404);
  } finally {
    app.close();
  }
});
