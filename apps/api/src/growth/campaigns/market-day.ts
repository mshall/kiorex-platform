/**
 * Market-local calendar helpers for campaigns (GRW-P2-A). PURE. A "day" is a calendar day in the market's time zone (Africa/Cairo for EG), not a UTC day: the daily cap
 * rolls over at local midnight, including on the two nights a year the zone changes its offset. The zone table is reference data, like MARKET_FACTS: adding a market
 * adds a row (P3-G moves it to the MARKET_PROFILE config kind); nothing branches on a country.
 */
export const MARKET_TIMEZONES: Readonly<Record<string, string>> = { EG: 'Africa/Cairo', SA: 'Asia/Riyadh', AE: 'Asia/Dubai' };
export const marketTimezone = (market: string): string => MARKET_TIMEZONES[market.toUpperCase()] ?? 'UTC';

const fmts = new Map<string, Intl.DateTimeFormat>();
const fmt = (zone: string) => { let f = fmts.get(zone); if (!f) { f = new Intl.DateTimeFormat('en-CA', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }); fmts.set(zone, f); } return f; };
const parts = (at: number, zone: string) => { const p: Record<string, number> = {}; for (const x of fmt(zone).formatToParts(new Date(at))) if (x.type !== 'literal') p[x.type] = Number(x.value); return p as { year: number; month: number; day: number; hour: number; minute: number; second: number }; };

/** `YYYY-MM-DD` of the instant in the zone. */
export function localDay(at: Date | number, zone: string): string {
  const t = typeof at === 'number' ? at : at.getTime(); const p = parts(t, zone);
  return `${String(p.year).padStart(4, '0')}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}
const offsetMs = (at: number, zone: string) => { const p = parts(at, zone); return Date.UTC(p.year, p.month - 1, p.day, p.hour === 24 ? 0 : p.hour, p.minute, p.second) - Math.floor(at / 1000) * 1000; };
/** UTC instant of local midnight at the start of `day` (YYYY-MM-DD) in the zone. */
export function startOfLocalDay(day: string, zone: string): Date {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const naive = Date.UTC(y, m - 1, d, 0, 0, 0);
  let utc = naive - offsetMs(naive, zone);
  const again = naive - offsetMs(utc, zone); if (again !== utc) utc = again;
  return new Date(utc);
}
export const addDays = (day: string, n: number): string => { const t = Date.parse(`${day}T00:00:00Z`) + n * 86_400_000; return new Date(t).toISOString().slice(0, 10); };
/** The instant the next local day begins: a daily-cap pause holds until then. */
export const nextDayBoundary = (at: Date, zone: string): Date => startOfLocalDay(addDays(localDay(at, zone), 1), zone);
/** Calendar days (inclusive) between two instants in the zone. */
export function daysBetween(a: Date, b: Date, zone: string): string[] {
  const out: string[] = []; let d = localDay(a, zone); const end = localDay(b, zone);
  for (let i = 0; i < 800 && d <= end; i++) { out.push(d); d = addDays(d, 1); }
  return out;
}
