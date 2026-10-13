// Minimal iCalendar (RFC 5545) reader for Google Calendar's "secret address in iCal format".
// Handles all-day and timed events, TZID / UTC / floating times, RRULE, EXDATE,
// RECURRENCE-ID overrides and cancelled instances.
import rrulePkg from 'rrule';
import { zonedToUtc, utcToWall, isValidZone, dateKey } from './time.js';

const { RRule } = rrulePkg;

function unescapeText(v) {
  return v.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');
}

function parseLine(line) {
  // NAME;PARAM=a;PARAM="b:c":VALUE (the first colon outside quotes ends the parameters)
  let inQuote = false;
  let i = 0;
  for (; i < line.length; i++) {
    if (line[i] === '"') inQuote = !inQuote;
    else if (line[i] === ':' && !inQuote) break;
  }
  const [name, ...rawParams] = line.slice(0, i).split(';');
  const params = {};
  for (const p of rawParams) {
    const eq = p.indexOf('=');
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { name: name.toUpperCase(), params, value: line.slice(i + 1) };
}

/** Parse one DATE or DATE-TIME value into { ms (real UTC), allDay, wall (fake-UTC ms), tz }. */
export function parseDate(value, params, defaultTz) {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(value.trim());
  if (!m) throw new Error(`Bad date "${value}"`);
  const [, y, mo, d, h, mi, s, z] = m;
  const n = (x) => Number(x || 0);
  if (!h || params.VALUE === 'DATE') {
    const wall = Date.UTC(n(y), n(mo) - 1, n(d));
    return { allDay: true, wall, tz: defaultTz, ms: zonedToUtc(n(y), n(mo), n(d), 0, 0, 0, defaultTz) };
  }
  if (z) {
    const ms = Date.UTC(n(y), n(mo) - 1, n(d), n(h), n(mi), n(s));
    return { allDay: false, ms, tz: 'UTC', wall: ms };
  }
  const tz = params.TZID && isValidZone(params.TZID) ? params.TZID : defaultTz;
  return {
    allDay: false,
    tz,
    wall: Date.UTC(n(y), n(mo) - 1, n(d), n(h), n(mi), n(s)),
    ms: zonedToUtc(n(y), n(mo), n(d), n(h), n(mi), n(s), tz),
  };
}

export function parseICS(text, defaultTz = 'America/New_York') {
  const lines = text.replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
  const events = [];
  let cur = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') {
      cur = { exdates: [] };
      continue;
    }
    if (line === 'END:VEVENT') {
      if (cur?.start) events.push(cur);
      cur = null;
      continue;
    }
    if (!cur || !line) continue;
    const { name, params, value } = parseLine(line);
    try {
      switch (name) {
        case 'UID': cur.uid = value; break;
        case 'SUMMARY': cur.summary = unescapeText(value); break;
        case 'LOCATION': cur.location = unescapeText(value); break;
        case 'STATUS': cur.status = value.toUpperCase(); break;
        case 'DTSTART': cur.start = parseDate(value, params, defaultTz); break;
        case 'DTEND': cur.end = parseDate(value, params, defaultTz); break;
        case 'DURATION': cur.duration = parseDuration(value); break;
        case 'RRULE': cur.rrule = value; break;
        case 'RECURRENCE-ID': cur.recurrenceId = parseDate(value, params, defaultTz); break;
        case 'EXDATE':
          for (const v of value.split(',')) cur.exdates.push(parseDate(v, params, defaultTz));
          break;
      }
    } catch {
      // skip a malformed property rather than the whole calendar
    }
  }
  return events;
}

function parseDuration(v) {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(v);
  if (!m) return 0;
  const [w, d, h, mi, s] = m.slice(2).map((x) => Number(x || 0));
  return (m[1] === '-' ? -1 : 1) * ((((w * 7 + d) * 24 + h) * 60 + mi) * 60 + s) * 1000;
}

function durationOf(ev) {
  if (ev.end) return ev.start.allDay ? ev.end.wall - ev.start.wall : ev.end.ms - ev.start.ms;
  if (ev.duration) return ev.duration;
  return ev.start.allDay ? 86400000 : 0;
}

const DAY = 86400000;

/**
 * Expand events into concrete instances overlapping [fromMs, toMs).
 * Returns [{ uid, title, location, start, end, allDay, startKey, endKey }], start/end in real UTC ms.
 * All-day instances also carry startKey/endKey (YYYY-MM-DD, end exclusive).
 */
export function expandEvents(events, fromMs, toMs, tz = 'America/New_York') {
  const overrides = new Map(); // uid -> Set of overridden original-start ms
  for (const ev of events) {
    if (ev.recurrenceId) {
      if (!overrides.has(ev.uid)) overrides.set(ev.uid, new Set());
      overrides.get(ev.uid).add(ev.recurrenceId.allDay ? ev.recurrenceId.wall : ev.recurrenceId.ms);
    }
  }

  const out = [];
  const push = (ev, startWall, startMs) => {
    const allDay = ev.start.allDay;
    const dur = durationOf(ev);
    let start, end, startKey, endKey;
    if (allDay) {
      startKey = new Date(startWall).toISOString().slice(0, 10);
      endKey = new Date(startWall + Math.max(dur, DAY)).toISOString().slice(0, 10);
      const [y, m, d] = startKey.split('-').map(Number);
      const [y2, m2, d2] = endKey.split('-').map(Number);
      start = zonedToUtc(y, m, d, 0, 0, 0, tz);
      end = zonedToUtc(y2, m2, d2, 0, 0, 0, tz);
    } else {
      start = startMs;
      end = startMs + dur;
    }
    const overlaps = start === end ? start >= fromMs && start < toMs : end > fromMs && start < toMs;
    if (overlaps) {
      out.push({
        uid: ev.uid,
        title: ev.summary || '(No title)',
        location: ev.location || '',
        start,
        end,
        allDay,
        startKey: allDay ? startKey : dateKey(start, tz),
        endKey: allDay ? endKey : dateKey(Math.max(start, end - 1), tz),
      });
    }
  };

  for (const ev of events) {
    if (ev.status === 'CANCELLED') continue;
    if (ev.recurrenceId || !ev.rrule) {
      push(ev, ev.start.wall, ev.start.ms);
      continue;
    }

    // Expand in the event's wall-clock time ("fake UTC") so 9am stays 9am across DST,
    // then convert each occurrence back to a real instant.
    const evTz = ev.start.allDay ? 'UTC' : ev.start.tz;
    const options = RRule.parseString(ev.rrule);
    if (options.until && /UNTIL=\d{8}T\d{6}Z/i.test(ev.rrule) && evTz !== 'UTC') {
      options.until = new Date(utcToWall(options.until.getTime(), evTz));
    }
    options.dtstart = new Date(ev.start.wall);
    const rule = new RRule(options);

    const dur = durationOf(ev);
    const toWall = (ms) => (evTz === 'UTC' ? ms : utcToWall(ms, evTz));
    const from = new Date(toWall(fromMs) - dur - 2 * DAY);
    const to = new Date(toWall(toMs) + 2 * DAY);
    const skip = overrides.get(ev.uid) || new Set();
    const ex = new Set(ev.exdates.map((x) => (ev.start.allDay ? x.wall : x.ms)));

    for (const occ of rule.between(from, to, true)) {
      const wall = occ.getTime();
      let ms = wall;
      if (!ev.start.allDay && evTz !== 'UTC') {
        const d = new Date(wall);
        ms = zonedToUtc(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), evTz);
      }
      const id = ev.start.allDay ? wall : ms;
      if (ex.has(id) || skip.has(id)) continue;
      push(ev, wall, ms);
    }
  }
  return out.sort((a, b) => a.start - b.start || Number(b.allDay) - Number(a.allDay));
}
