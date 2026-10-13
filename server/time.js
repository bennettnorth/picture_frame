// Time zone helpers built on Intl, so DST is handled without a tz database dependency.

const formatters = new Map();
function partsFormatter(tz) {
  if (!formatters.has(tz)) {
    formatters.set(
      tz,
      new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        hourCycle: 'h23',
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        second: 'numeric',
      }),
    );
  }
  return formatters.get(tz);
}

export function isValidZone(tz) {
  try {
    partsFormatter(tz);
    return true;
  } catch {
    return false;
  }
}

/** Offset of `tz` from UTC at instant `utcMs`, in ms (New York in winter: -5h). */
export function tzOffset(utcMs, tz) {
  const p = {};
  for (const { type, value } of partsFormatter(tz).formatToParts(new Date(utcMs))) p[type] = Number(value);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/** Wall-clock time in `tz` -> real UTC ms. */
export function zonedToUtc(y, mo, d, h, mi, s, tz) {
  const wall = Date.UTC(y, mo - 1, d, h, mi, s);
  let utc = wall - tzOffset(wall, tz);
  utc = wall - tzOffset(utc, tz); // second pass settles DST transitions
  return utc;
}

/** Real UTC ms -> "fake UTC" ms whose UTC fields read as the wall clock in `tz`. */
export function utcToWall(utcMs, tz) {
  return utcMs + tzOffset(utcMs, tz);
}

/** YYYY-MM-DD of an instant in `tz`. */
export function dateKey(utcMs, tz) {
  return new Date(utcToWall(utcMs, tz)).toISOString().slice(0, 10);
}

/** Midnight (real UTC ms) starting the given YYYY-MM-DD in `tz`. */
export function startOfDay(key, tz) {
  const [y, m, d] = key.split('-').map(Number);
  return zonedToUtc(y, m, d, 0, 0, 0, tz);
}

export function addDays(key, n) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
