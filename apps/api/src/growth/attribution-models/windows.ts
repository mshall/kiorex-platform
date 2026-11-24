import { addDays, localDay } from '../campaigns/market-day';
import type { PathTouch } from './models';

/**
 * Reporting look-back windows (GRW-P3-B). They never change `ATTRIBUTION_POLICY`: the money decision keeps its own windows (a provider link is 30 days there too, so the
 * default here matches the money policy). Unit: calendar days in the MARKET time zone; "day N inclusive" means a touch N local days before the conversion still counts and
 * N + 1 does not, whatever the hour (Cairo midnight, not UTC midnight).
 */
export interface ModelWindows { webAppDays: number; campaignDays: number; providerLinkDays: number }
export const DEFAULT_WINDOWS: ModelWindows = { webAppDays: 30, campaignDays: 7, providerLinkDays: 30 };
export const MAX_WINDOW_DAYS = 90;

const PROVIDER_KINDS = new Set(['PROVIDER_LINK', 'PROVIDER_QR', 'WIDGET']);
export function windowDaysFor(kind: string, w: ModelWindows = DEFAULT_WINDOWS): number {
  if (kind === 'CAMPAIGN') return w.campaignDays;
  if (PROVIDER_KINDS.has(kind)) return w.providerLinkDays;
  return w.webAppDays;
}
export const maxWindowDays = (w: ModelWindows = DEFAULT_WINDOWS) => Math.max(w.webAppDays, w.campaignDays, w.providerLinkDays);

/** Validates an operator-supplied window set (positive integers, at most 90 days). */
export function checkWindows(w: ModelWindows): ModelWindows {
  for (const [k, v] of Object.entries(w)) if (!Number.isInteger(v) || v < 1 || v > MAX_WINDOW_DAYS) throw new RangeError(`window ${k} must be an integer from 1 to ${MAX_WINDOW_DAYS}`);
  return w;
}

const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** True when the touch is inside its window for a conversion at `conversionAt` (and not after it). */
export function inWindow(t: PathTouch, conversionAt: number, zone: string, w: ModelWindows = DEFAULT_WINDOWS): boolean {
  if (t.at > conversionAt) return false;
  return dayDiff(localDay(t.at, zone), localDay(conversionAt, zone)) <= windowDaysFor(t.kind, w);
}
/** The earliest local day a touch can have for the conversion to see it (reads use it as the query bound, minus one day of slack for the zone). */
export const earliestTouchDay = (conversionAt: number, zone: string, w: ModelWindows = DEFAULT_WINDOWS) => addDays(localDay(conversionAt, zone), -maxWindowDays(w));
