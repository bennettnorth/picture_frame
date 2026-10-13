import { fetchWithTimeout } from '../cache.js';
import { parseICS, expandEvents } from '../ics.js';
import { dateKey, startOfDay, addDays } from '../time.js';

function timeLabel(ms, tz) {
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' })
    .format(new Date(ms))
    .replace(':00', '')
    .replace(' AM', 'a')
    .replace(' PM', 'p');
}

function dayLabel(key, todayKey) {
  if (key === todayKey) return 'Today';
  if (key === addDays(todayKey, 1)) return 'Tomorrow';
  const [y, m, d] = key.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long', month: 'short', day: 'numeric' }).format(
    new Date(Date.UTC(y, m - 1, d)),
  );
}

/** Group expanded instances into day buckets; multi-day events appear on each day they cover. */
export function buildAgenda(instances, { tz, days, maxEvents, now = Date.now() }) {
  const todayKey = dateKey(now, tz);
  const out = [];
  let count = 0;
  for (let i = 0; i < days && count < maxEvents; i++) {
    const key = addDays(todayKey, i);
    const dayStart = startOfDay(key, tz);
    const dayEnd = startOfDay(addDays(key, 1), tz);
    const events = [];
    for (const ev of instances) {
      if (count >= maxEvents) break;
      const onDay = ev.allDay ? ev.startKey <= key && key < ev.endKey : ev.start < dayEnd && (ev.end > dayStart || ev.start >= dayStart);
      if (!onDay) continue;
      if (i === 0 && !ev.allDay && ev.end <= now && ev.end > ev.start) continue; // already over today
      const continued = ev.allDay ? ev.startKey < key : ev.start < dayStart;
      events.push({
        title: ev.title,
        location: ev.location,
        calendar: ev.calendar,
        color: ev.color,
        allDay: ev.allDay,
        time: ev.allDay ? 'All day' : continued ? 'cont.' : timeLabel(ev.start, tz),
        endTime: ev.allDay || continued ? '' : timeLabel(ev.end, tz),
        start: ev.start,
        end: ev.end,
      });
      count++;
    }
    if (events.length || i === 0) out.push({ date: key, label: dayLabel(key, todayKey), events });
  }
  return out;
}

export async function getCalendar(cfg, tz) {
  const days = cfg.days || 5;
  const now = Date.now();
  const from = startOfDay(dateKey(now, tz), tz);
  const to = startOfDay(addDays(dateKey(now, tz), days), tz);
  const calendars = (cfg.calendars || []).filter((c) => c.url);
  if (!calendars.length) throw new Error('No calendar URLs configured (see .env.example)');

  const errors = [];
  const lists = await Promise.all(
    calendars.map(async (cal) => {
      try {
        const res = await fetchWithTimeout(cal.url.replace(/^webcal:/, 'https:'));
        return expandEvents(parseICS(await res.text(), tz), from, to, tz).map((e) => ({
          ...e,
          calendar: cal.name || '',
          color: cal.color || '#4285f4',
        }));
      } catch (err) {
        errors.push(`${cal.name || 'calendar'}: ${err.message}`);
        return [];
      }
    }),
  );
  if (errors.length === calendars.length) throw new Error(errors.join('; '));
  const instances = lists.flat().sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start - b.start);
  return { days: buildAgenda(instances, { tz, days, maxEvents: cfg.maxEvents || 14, now }), errors };
}
