// Sample data for `npm run demo`, so the layout can be previewed without network access or config.
import { dateKey, addDays, startOfDay } from './time.js';

export function demoSources(tz) {
  const min = (m) => Date.now() + m * 60000;
  const hour = 3600000;
  const today = dateKey(Date.now(), tz);
  const at = (dayOffset, h, m = 0) => startOfDay(addDays(today, dayOffset), tz) + h * hour + m * 60000;
  const ev = (title, time, opts = {}) => ({ title, time, location: '', color: '#4285f4', allDay: false, start: 0, end: 0, ...opts });

  return {
    weather: async () => ({
      label: 'Brooklyn',
      units: '°F',
      current: { temp: 62, feelsLike: 60, humidity: 55, wind: 9, windUnit: 'mph', code: 2, isDay: true },
      hourly: Array.from({ length: 12 }, (_, i) => ({
        time: Math.floor(Date.now() / hour) * hour + i * hour,
        temp: 62 + Math.round(Math.sin(i / 3) * 4),
        precip: i > 6 ? 40 : 5,
        code: i > 6 ? 61 : 2,
        isDay: i < 5,
      })),
      daily: [
        [66, 52, 30, 61], [70, 55, 0, 0], [64, 50, 10, 3], [58, 47, 70, 63], [61, 48, 20, 2],
      ].map(([high, low, precip, code], i) => ({ date: startOfDay(addDays(today, i), tz), high, low, precip, code })),
    }),
    subway: async () => ({
      stops: [
        { label: 'Bedford Av', direction: 'Manhattan', arrivals: [{ route: 'L', time: min(1.5) }, { route: 'L', time: min(6.2) }, { route: 'L', time: min(11.8) }, { route: 'L', time: min(17.1) }] },
        { label: 'Bedford Av', direction: 'Canarsie', arrivals: [{ route: 'L', time: min(3.4) }, { route: 'L', time: min(9.9) }, { route: 'L', time: min(16.3) }] },
        { label: 'Marcy Av', direction: 'Manhattan', arrivals: [{ route: 'J', time: min(4.1) }, { route: 'M', time: min(7.5) }, { route: 'J', time: min(12.2) }] },
      ],
      alerts: [{ routes: ['L'], text: 'L trains run every 12 minutes this weekend while we make track repairs' }],
    }),
    citibike: async () => ({
      stations: [
        { name: 'N 7 St & Bedford Ave', distance: 60, classic: 4, ebikes: 2, docks: 15, active: true },
        { name: 'Driggs Ave & N 9 St', distance: 210, classic: 11, ebikes: 0, docks: 6, active: true },
        { name: 'Wythe Ave & Metropolitan Ave', distance: 420, classic: 0, ebikes: 1, docks: 22, active: true },
      ],
    }),
    calendar: async () => ({
      errors: [],
      days: [
        { date: today, label: 'Today', events: [
          ev('Book club', '7:30p', { start: at(0, 19, 30), end: at(0, 21), location: "Sam's place" }),
          ev('Pick up dry cleaning', '5p', { start: at(0, 17), end: at(0, 17, 30), color: '#33b679' }),
        ].sort((a, b) => a.start - b.start) },
        { date: addDays(today, 1), label: 'Tomorrow', events: [
          ev("Mom's birthday", 'All day', { allDay: true, color: '#f4511e' }),
          ev('Dentist', '9:30a', { start: at(1, 9, 30), end: at(1, 10, 30), location: '123 Court St' }),
          ev('Soccer practice', '6p', { start: at(1, 18), end: at(1, 19), color: '#33b679' }),
        ] },
        { date: addDays(today, 2), label: 'Thursday', events: [ev('Date night', '8p', { start: at(2, 20), end: at(2, 22), color: '#8e24aa' })] },
      ],
    }),
  };
}
