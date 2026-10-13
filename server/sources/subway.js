import GtfsRealtimeBindings from 'gtfs-realtime-bindings';
import { fetchWithTimeout } from '../cache.js';

const { FeedMessage } = GtfsRealtimeBindings.transit_realtime;

// MTA realtime feeds are free and no longer need an API key.
// https://api.mta.info/#/subwayRealTimeFeeds
const BASE = 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/';
export const FEEDS = {
  'nyct%2Fgtfs': ['1', '2', '3', '4', '5', '6', '6X', '7', '7X', 'GS'],
  'nyct%2Fgtfs-ace': ['A', 'C', 'E', 'H', 'SR'],
  'nyct%2Fgtfs-bdfm': ['B', 'D', 'F', 'FX', 'M', 'FS'],
  'nyct%2Fgtfs-g': ['G'],
  'nyct%2Fgtfs-jz': ['J', 'Z'],
  'nyct%2Fgtfs-nqrw': ['N', 'Q', 'R', 'W'],
  'nyct%2Fgtfs-l': ['L'],
  'nyct%2Fgtfs-si': ['SI', 'SIR'],
};
const ALERTS_FEED = 'camsys%2Fsubway-alerts';

const toNum = (v) => (v == null ? null : typeof v === 'object' ? v.toNumber() : Number(v));

export function feedsFor(stops) {
  const wanted = new Set();
  for (const stop of stops) {
    if (!stop.routes?.length) return Object.keys(FEEDS); // unknown routes: check every feed
    for (const route of stop.routes) {
      const feed = Object.keys(FEEDS).find((f) => FEEDS[f].includes(String(route).toUpperCase()));
      if (!feed) throw new Error(`Unknown subway route "${route}"`);
      wanted.add(feed);
    }
  }
  return [...wanted];
}

export function decodeFeed(buffer) {
  return FeedMessage.decode(new Uint8Array(buffer));
}

// Collect upcoming arrivals for each configured stop across already-decoded feeds.
export function arrivalsFromFeeds(feeds, stops, { now = Date.now(), maxArrivals = 4 } = {}) {
  const byStop = new Map(stops.map((s) => [s.stopId, []]));
  const nowSec = now / 1000;

  for (const feed of feeds) {
    for (const entity of feed.entity) {
      const tu = entity.tripUpdate;
      if (!tu) continue;
      const routeId = tu.trip?.routeId;
      for (const stu of tu.stopTimeUpdate) {
        const list = byStop.get(stu.stopId);
        if (!list) continue;
        const t = toNum(stu.arrival?.time) || toNum(stu.departure?.time);
        if (!t || t < nowSec - 30) continue;
        list.push({ route: routeId, time: t * 1000 });
      }
    }
  }

  return stops.map((stop) => {
    const routes = stop.routes?.map((r) => String(r).toUpperCase());
    const arrivals = byStop
      .get(stop.stopId)
      .filter((a) => !routes || routes.includes(a.route) || routes.includes(a.route.replace(/X$/, '')))
      .sort((a, b) => a.time - b.time)
      .slice(0, stop.maxArrivals || maxArrivals);
    return {
      label: stop.label,
      direction: stop.direction || '',
      stopId: stop.stopId,
      arrivals,
    };
  });
}

function translation(ts) {
  const list = ts?.translation || [];
  return (list.find((t) => t.language === 'en') || list.find((t) => !t.language) || list[0])?.text || '';
}

export function alertsFromFeed(feed, routes, now = Date.now()) {
  const nowSec = now / 1000;
  const routeSet = new Set(routes);
  const out = [];
  for (const entity of feed.entity) {
    const alert = entity.alert;
    if (!alert) continue;
    const periods = alert.activePeriod || [];
    const active =
      periods.length === 0 ||
      periods.some((p) => (toNum(p.start) || 0) <= nowSec && (!toNum(p.end) || toNum(p.end) >= nowSec));
    if (!active) continue;
    const hit = [...new Set((alert.informedEntity || []).map((e) => e.routeId).filter((r) => routeSet.has(r)))];
    if (!hit.length) continue;
    const text = translation(alert.headerText).replace(/\s+/g, ' ').trim();
    if (text) out.push({ routes: hit.sort(), text });
  }
  // The feed repeats similar planned-work notices; drop exact duplicates.
  return out.filter((a, i) => out.findIndex((b) => b.text === a.text) === i);
}

async function fetchFeed(name) {
  const res = await fetchWithTimeout(BASE + name);
  return decodeFeed(await res.arrayBuffer());
}

export async function getSubway(cfg) {
  const stops = cfg.stops || [];
  const feeds = await Promise.all(feedsFor(stops).map(fetchFeed));
  const result = { stops: arrivalsFromFeeds(feeds, stops, { maxArrivals: cfg.maxArrivals }), alerts: [] };

  if (cfg.alerts !== false) {
    const routes = [...new Set(stops.flatMap((s) => s.routes || []).map((r) => String(r).toUpperCase()))];
    try {
      result.alerts = alertsFromFeed(await fetchFeed(ALERTS_FEED), routes).slice(0, cfg.maxAlerts || 3);
    } catch (err) {
      console.warn('[subway] alerts:', err.message); // arrivals matter more than alerts
    }
  }
  return result;
}
