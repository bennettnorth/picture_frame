import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseICS, expandEvents } from '../server/ics.js';
import { buildAgenda } from '../server/sources/calendar.js';

const TZ = 'America/New_York';
const ics = (body) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${body.trim().split('\n').map((l) => l.replace(/^ {4}/, '')).join('\r\n')}\r\nEND:VCALENDAR\r\n`;
const utc = (s) => Date.parse(s);
const iso = (ms) => new Date(ms).toISOString();

test('timed event with TZID converts to UTC', () => {
  const evs = parseICS(ics(`
    BEGIN:VEVENT
    UID:a
    DTSTART;TZID=America/New_York:20261013T093000
    DTEND;TZID=America/New_York:20261013T103000
    SUMMARY:Dentist\\, downtown
    LOCATION:123 Main St
    END:VEVENT`));
  const [e] = expandEvents(evs, utc('2026-10-13T00:00:00Z'), utc('2026-10-15T00:00:00Z'), TZ);
  assert.equal(e.title, 'Dentist, downtown');
  assert.equal(iso(e.start), '2026-10-13T13:30:00.000Z'); // EDT = UTC-4
  assert.equal(iso(e.end), '2026-10-13T14:30:00.000Z');
});

test('weekly recurrence keeps wall-clock time across DST and honours EXDATE', () => {
  const evs = parseICS(ics(`
    BEGIN:VEVENT
    UID:soccer
    DTSTART;TZID=America/New_York:20261024T090000
    DTEND;TZID=America/New_York:20261024T100000
    RRULE:FREQ=WEEKLY;BYDAY=SA
    EXDATE;TZID=America/New_York:20261107T090000
    SUMMARY:Soccer
    END:VEVENT`));
  const out = expandEvents(evs, utc('2026-10-20T00:00:00Z'), utc('2026-11-20T00:00:00Z'), TZ);
  assert.deepEqual(out.map((e) => iso(e.start)), [
    '2026-10-24T13:00:00.000Z', // EDT
    '2026-10-31T13:00:00.000Z',
    // 11-07 excluded
    '2026-11-14T14:00:00.000Z', // EST, still 9am local
  ]);
});

test('RRULE UNTIL in UTC and COUNT both stop expansion', () => {
  const evs = parseICS(ics(`
    BEGIN:VEVENT
    UID:until
    DTSTART;TZID=America/New_York:20261012T200000
    DTEND;TZID=America/New_York:20261012T210000
    RRULE:FREQ=DAILY;UNTIL=20261015T005959Z
    SUMMARY:Until
    END:VEVENT
    BEGIN:VEVENT
    UID:count
    DTSTART:20261012T150000Z
    DTEND:20261012T160000Z
    RRULE:FREQ=DAILY;COUNT=2
    SUMMARY:Count
    END:VEVENT`));
  const out = expandEvents(evs, utc('2026-10-10T00:00:00Z'), utc('2026-10-30T00:00:00Z'), TZ);
  // UNTIL 00:59 UTC on the 15th is 8:59pm on the 14th in New York: 12th, 13th, 14th.
  assert.equal(out.filter((e) => e.uid === 'until').length, 3);
  assert.equal(out.filter((e) => e.uid === 'count').length, 2);
});

test('RECURRENCE-ID override moves one instance; cancelled instance disappears', () => {
  const evs = parseICS(ics(`
    BEGIN:VEVENT
    UID:standup
    DTSTART;TZID=America/New_York:20261012T100000
    DTEND;TZID=America/New_York:20261012T101500
    RRULE:FREQ=DAILY;COUNT=3
    SUMMARY:Standup
    END:VEVENT
    BEGIN:VEVENT
    UID:standup
    RECURRENCE-ID;TZID=America/New_York:20261013T100000
    DTSTART;TZID=America/New_York:20261013T113000
    DTEND;TZID=America/New_York:20261013T114500
    SUMMARY:Standup (moved)
    END:VEVENT
    BEGIN:VEVENT
    UID:standup
    RECURRENCE-ID;TZID=America/New_York:20261014T100000
    DTSTART;TZID=America/New_York:20261014T100000
    STATUS:CANCELLED
    SUMMARY:Standup
    END:VEVENT`));
  const out = expandEvents(evs, utc('2026-10-12T00:00:00Z'), utc('2026-10-20T00:00:00Z'), TZ);
  assert.deepEqual(out.map((e) => [e.title, iso(e.start)]), [
    ['Standup', '2026-10-12T14:00:00.000Z'],
    ['Standup (moved)', '2026-10-13T15:30:00.000Z'],
  ]);
});

test('all-day and multi-day events, folded lines, agenda grouping', () => {
  const evs = parseICS(ics(`
    BEGIN:VEVENT
    UID:trip
    DTSTART;VALUE=DATE:20261013
    DTEND;VALUE=DATE:20261015
    SUMMARY:Trip to
      Boston
    END:VEVENT
    BEGIN:VEVENT
    UID:bday
    DTSTART;VALUE=DATE:20261014
    DTEND;VALUE=DATE:20261015
    RRULE:FREQ=YEARLY
    SUMMARY:Mom's birthday
    END:VEVENT
    BEGIN:VEVENT
    UID:dinner
    DTSTART;TZID=America/New_York:20261013T190000
    DTEND;TZID=America/New_York:20261013T210000
    SUMMARY:Dinner
    END:VEVENT`));
  const now = utc('2026-10-13T16:00:00Z'); // noon in New York
  const from = utc('2026-10-13T04:00:00Z');
  const inst = expandEvents(evs, from, from + 3 * 86400000, TZ)
    .map((e) => ({ ...e, calendar: 'Family', color: '#4285f4' }))
    .sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start - b.start);
  const agenda = buildAgenda(inst, { tz: TZ, days: 3, maxEvents: 20, now });
  assert.deepEqual(
    agenda.map((d) => [d.label, d.events.map((e) => `${e.time} ${e.title}`)]),
    [
      ['Today', ['All day Trip to Boston', '7p Dinner']],
      ['Tomorrow', ["All day Trip to Boston", "All day Mom's birthday"]],
    ],
  );
});

test('finished events are hidden from today', () => {
  const evs = parseICS(ics(`
    BEGIN:VEVENT
    UID:early
    DTSTART:20261013T120000Z
    DTEND:20261013T130000Z
    SUMMARY:Breakfast
    END:VEVENT`));
  const inst = expandEvents(evs, utc('2026-10-13T04:00:00Z'), utc('2026-10-14T04:00:00Z'), TZ);
  const agenda = buildAgenda(inst, { tz: TZ, days: 1, maxEvents: 20, now: utc('2026-10-13T16:00:00Z') });
  assert.deepEqual(agenda[0].events, []);
});
