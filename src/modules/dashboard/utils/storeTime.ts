export interface StoreDateParts {
  readonly year: number; readonly month: number; readonly day: number;
  readonly hour: number; readonly minute: number; readonly second: number;
}
const formatterCache = new Map<string, Intl.DateTimeFormat>();
function getFormatter(timeZone: string): Intl.DateTimeFormat {
  const zone = timeZone.trim() || 'UTC';
  let formatter = formatterCache.get(zone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-GB', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
    formatter.format(new Date(0));
    formatterCache.set(zone, formatter);
  }
  return formatter;
}
export function getStoreDateParts(date: Date, timeZone: string): StoreDateParts {
  if (!Number.isFinite(date.getTime())) throw new RangeError('Invalid date supplied.');
  const values = new Map(getFormatter(timeZone).formatToParts(date).map((part) => [part.type, part.value] as const));
  return { year: Number(values.get('year')), month: Number(values.get('month')), day: Number(values.get('day')), hour: Number(values.get('hour')), minute: Number(values.get('minute')), second: Number(values.get('second')) };
}
/** A local-calendar Date carrier; its Y/M/D fields represent the store's calendar date. */
export function getStoreDateCarrier(date: Date, timeZone: string): Date {
  const parts = getStoreDateParts(date, timeZone);
  return new Date(parts.year, parts.month - 1, parts.day);
}
export function storeWallTimeToUtc(parts: Pick<StoreDateParts, 'year'|'month'|'day'> & Partial<Pick<StoreDateParts, 'hour'|'minute'|'second'>>, timeZone: string): Date {
  const target = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour ?? 0, parts.minute ?? 0, parts.second ?? 0);
  let guess = target;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const actual = getStoreDateParts(new Date(guess), timeZone);
    const represented = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second);
    const delta = target - represented;
    if (delta === 0) return new Date(guess);
    guess += delta;
  }
  const resolved = new Date(guess);
  const actual = getStoreDateParts(resolved, timeZone);
  if (actual.year !== parts.year || actual.month !== parts.month || actual.day !== parts.day || actual.hour !== (parts.hour ?? 0) || actual.minute !== (parts.minute ?? 0)) throw new RangeError('Store local time does not exist in the configured timezone.');
  return resolved;
}
export function getStoreDayBounds(dateCarrier: Date, timeZone: string): { start: Date; end: Date } {
  const year = dateCarrier.getFullYear(), month = dateCarrier.getMonth() + 1, day = dateCarrier.getDate();
  const start = storeWallTimeToUtc({ year, month, day }, timeZone);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  const nextStart = storeWallTimeToUtc({ year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate() }, timeZone);
  return { start, end: new Date(nextStart.getTime() - 1) };
}
