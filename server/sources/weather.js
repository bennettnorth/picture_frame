import { fetchWithTimeout } from '../cache.js';

// Open-Meteo: free, no API key. https://open-meteo.com/en/docs
export function weatherUrl(cfg, timezone) {
  const imperial = (cfg.units || 'imperial') === 'imperial';
  const params = new URLSearchParams({
    latitude: cfg.latitude,
    longitude: cfg.longitude,
    timezone,
    current: 'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day,precipitation',
    hourly: 'temperature_2m,precipitation_probability,weather_code,is_day',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset',
    forecast_days: '6',
    temperature_unit: imperial ? 'fahrenheit' : 'celsius',
    wind_speed_unit: imperial ? 'mph' : 'kmh',
    precipitation_unit: imperial ? 'inch' : 'mm',
    timeformat: 'unixtime',
  });
  return `https://api.open-meteo.com/v1/forecast?${params}`;
}

export function parseWeather(json, cfg, now = Date.now()) {
  const nowSec = now / 1000;
  const h = json.hourly;
  const start = Math.max(0, h.time.findIndex((t) => t + 3600 > nowSec));
  const hourly = [];
  for (let i = start; i < Math.min(h.time.length, start + 12); i++) {
    hourly.push({
      time: h.time[i] * 1000,
      temp: Math.round(h.temperature_2m[i]),
      precip: h.precipitation_probability[i],
      code: h.weather_code[i],
      isDay: !!h.is_day[i],
    });
  }
  const d = json.daily;
  const daily = d.time.map((t, i) => ({
    date: t * 1000,
    high: Math.round(d.temperature_2m_max[i]),
    low: Math.round(d.temperature_2m_min[i]),
    precip: d.precipitation_probability_max[i],
    code: d.weather_code[i],
    sunrise: d.sunrise[i] * 1000,
    sunset: d.sunset[i] * 1000,
  }));
  const c = json.current;
  return {
    label: cfg.label || '',
    units: json.current_units?.temperature_2m || '°F',
    current: {
      temp: Math.round(c.temperature_2m),
      feelsLike: Math.round(c.apparent_temperature),
      humidity: c.relative_humidity_2m,
      wind: Math.round(c.wind_speed_10m),
      windUnit: (json.current_units?.wind_speed_10m || 'mph').replace('mp/h', 'mph'),
      code: c.weather_code,
      isDay: !!c.is_day,
    },
    hourly,
    daily,
  };
}

export async function getWeather(cfg, timezone) {
  const res = await fetchWithTimeout(weatherUrl(cfg, timezone));
  return parseWeather(await res.json(), cfg);
}
