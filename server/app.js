import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ROOT } from './config.js';
import { cached } from './cache.js';
import { tzOffset } from './time.js';
import { getWeather } from './sources/weather.js';
import { getSubway } from './sources/subway.js';
import { getCitiBike } from './sources/citibike.js';
import { getCalendar } from './sources/calendar.js';

const PUBLIC = path.join(ROOT, 'public');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

export function createSources(config, overrides = {}) {
  const tz = config.timezone;
  const sources = {};
  // TTLs balance freshness with being polite to free APIs.
  if (config.weather) sources.weather = cached(10 * 60e3, () => getWeather(config.weather, tz));
  if (config.subway?.stops?.length) sources.subway = cached(30e3, () => getSubway(config.subway));
  if (config.citibike) sources.citibike = cached(60e3, () => getCitiBike(config.citibike));
  if (config.calendar) sources.calendar = cached(5 * 60e3, () => getCalendar(config.calendar, tz));
  return { ...sources, ...overrides };
}

export async function dashboardPayload(config, sources) {
  const names = Object.keys(sources);
  const results = await Promise.allSettled(names.map((n) => sources[n]()));
  const now = Date.now();
  const body = {
    now,
    timezone: config.timezone,
    tzOffsetMin: tzOffset(now, config.timezone) / 60000,
  };
  names.forEach((name, i) => {
    const r = results[i];
    body[name] = r.status === 'fulfilled' ? r.value : { error: r.reason?.message || String(r.reason) };
    if (r.status === 'rejected') console.warn(`[${name}]`, body[name].error);
  });
  return body;
}

export function createApp(config, sources = createSources(config)) {
  return createServer(async (req, res) => {
    const url = new URL(req.url, 'http://frame');
    try {
      if (url.pathname === '/api/dashboard') {
        const body = JSON.stringify(await dashboardPayload(config, sources));
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        return res.end(body);
      }
      if (url.pathname === '/healthz') {
        res.writeHead(200, { 'content-type': 'text/plain' });
        return res.end('ok');
      }
      const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
      const file = path.join(PUBLIC, rel);
      if (!file.startsWith(PUBLIC + path.sep)) throw Object.assign(new Error('forbidden'), { code: 'ENOENT' });
      const data = await readFile(file);
      res.writeHead(200, {
        'content-type': TYPES[path.extname(file)] || 'application/octet-stream',
        'cache-control': 'no-cache',
      });
      res.end(data);
    } catch (err) {
      const notFound = err.code === 'ENOENT' || err.code === 'EISDIR';
      res.writeHead(notFound ? 404 : 500, { 'content-type': 'text/plain' });
      res.end(notFound ? 'not found' : 'server error');
      if (!notFound) console.error(err);
    }
  });
}
