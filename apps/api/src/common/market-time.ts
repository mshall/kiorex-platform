import { cfg } from './config';

/**
 * Market wall-clock time. Egypt observes daylight saving time (UTC+2 in winter, UTC+3 from the last Friday of April to the last Thursday of October), so a FIXED offset
 * (MARKET_TZ_OFFSET_HOURS) is wrong for half of the year: WhatsApp slot lists showed every time one hour early and the default quiet window ran an hour late. Every
 * market-local calculation goes through here; the zone comes from MARKET_TIME_ZONE (default Africa/Cairo) and the fixed offset is only the fallback when Intl cannot resolve it.
 */
export const marketZone = (): string => process.env.MARKET_TIME_ZONE || 'Africa/Cairo';

/** Minutes east of UTC of `timeZone` at the instant `at` (DST aware). */
export function zoneOffsetMinutes(timeZone: string, at: number | Date, fallbackMinutes: number): number {
  const ms = typeof at === 'number' ? at : at.getTime();
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(ms));
    const g = (t: string) => Number(parts.find((p) => p.type === t)!.value);
    return Math.round((Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second')) - Math.floor(ms / 1000) * 1000) / 60_000);
  } catch { return fallbackMinutes; }
}
export const marketOffsetMinutes = (at: number | Date = Date.now()): number => zoneOffsetMinutes(marketZone(), at, cfg().tzOffsetHours * 60);

/**
 * End (epoch ms) of the daily quiet window [startH, endH) that contains `at` in the market zone, or null when `at` is outside it. start > end wraps midnight; start == end is
 * no window. The end is converted back to UTC with the offset IN FORCE AT THE END (not at `at`), so a window that spans the Cairo DST change still ends at the right wall-clock hour.
 */
export function quietWindowEnd(at: number, startH: number, endH: number, zone = marketZone(), fallbackMinutes = cfg().tzOffsetHours * 60): number | null {
  if (startH === endH) return null;
  const off = zoneOffsetMinutes(zone, at, fallbackMinutes) * 60_000;
  const local = new Date(at + off);
  const h = local.getUTCHours();
  const inside = startH > endH ? h >= startH || h < endH : h >= startH && h < endH;
  if (!inside) return null;
  const endLocal = new Date(local); endLocal.setUTCHours(endH, 0, 0, 0);
  if (endLocal.getTime() <= local.getTime()) endLocal.setUTCDate(endLocal.getUTCDate() + 1);
  let utc = endLocal.getTime() - off;
  for (let i = 0; i < 2; i++) utc = endLocal.getTime() - zoneOffsetMinutes(zone, utc, fallbackMinutes) * 60_000; // settle on the offset at the end instant
  return utc;
}

/** "Mon 23 Nov 18:45" in the market zone, DST aware (WhatsApp booking copy). */
export function marketClock(iso: string, lang: 'ar' | 'en', zone = marketZone()): string {
  const d = new Date(iso);
  const day = d.toLocaleDateString(lang === 'ar' ? 'ar-EG' : 'en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: zone });
  const hm = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: zone }).format(d);
  return `${day} ${hm}`;
}
