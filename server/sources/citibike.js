import { cached, fetchWithTimeout } from '../cache.js';

// Citi Bike's public GBFS feed: free, no key. https://citibikenyc.com/system-data
const GBFS = 'https://gbfs.citibikenyc.com/gbfs/en/';

async function getJson(name) {
  const res = await fetchWithTimeout(GBFS + name);
  return (await res.json()).data.stations;
}

// Station names and locations barely change, so refresh them hourly.
export const stationInfo = cached(60 * 60 * 1000, () => getJson('station_information.json'));

export function distanceMeters(lat1, lon1, lat2, lon2) {
  const rad = Math.PI / 180;
  const a =
    Math.sin(((lat2 - lat1) * rad) / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lon2 - lon1) * rad) / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(a));
}

export function pickStations(info, cfg) {
  if (cfg.stationIds?.length) {
    return cfg.stationIds.map((id) => {
      const s = info.find((x) => x.station_id === id);
      if (!s) throw new Error(`Citi Bike station ${id} not found (run npm run find-station)`);
      return s;
    });
  }
  const { latitude, longitude, count = 3 } = cfg.near || {};
  if (latitude == null) return [];
  return info
    .map((s) => ({ ...s, distance: distanceMeters(latitude, longitude, s.lat, s.lon) }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, count);
}

export function mergeStatus(stations, status) {
  const byId = new Map(status.map((s) => [s.station_id, s]));
  return stations.map((s) => {
    const st = byId.get(s.station_id) || {};
    const ebikes = st.num_ebikes_available || 0;
    return {
      id: s.station_id,
      name: s.name,
      distance: s.distance == null ? null : Math.round(s.distance),
      classic: Math.max(0, (st.num_bikes_available || 0) - ebikes),
      ebikes,
      docks: st.num_docks_available || 0,
      active: st.is_renting === 1 || st.is_renting === true,
    };
  });
}

export async function getCitiBike(cfg) {
  const [info, status] = await Promise.all([stationInfo(), getJson('station_status.json')]);
  return { stations: mergeStatus(pickStations(info, cfg), status) };
}
