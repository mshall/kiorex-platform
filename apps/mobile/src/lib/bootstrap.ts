import { config } from "./config";
import { prefs } from "./storage";

/** GET /api/v1/bootstrap (GRW-P1-H): live markets, regional API endpoint, capabilities. Cached for a day so a cold start from a link never blocks on the network. */
export interface Bootstrap {
  defaultMarket: string; resolvedMarket?: string; liveMarkets: string[]; showMarketSelector: boolean; locales: string[]; minAppVersion?: string | null;
  apiEndpoint?: string; capabilities?: Partial<Record<"deepLinks" | "marketplace" | "homeVisits", boolean>>;
  /** GRW-P2-B3 (additive): effective growth features. `referral` is true only when growth.patient_referral is on for the market. */
  features?: { referral?: boolean; loyalty?: boolean };
}
const KEY = "kx.bootstrap.v1";
const MAX_AGE_MS = 24 * 3600_000;

export function validBootstrap(v: unknown): v is Bootstrap {
  const b = v as Bootstrap | null;
  return !!b && typeof b === "object" && typeof b.defaultMarket === "string" && /^[A-Z]{2}$/.test(b.defaultMarket) && Array.isArray(b.liveMarkets) && b.liveMarkets.every((m) => typeof m === "string" && /^[A-Z]{2}$/.test(m)) && typeof b.showMarketSelector === "boolean";
}

export async function cachedBootstrap(now = Date.now()): Promise<Bootstrap | null> {
  try { const raw = await prefs.get(KEY); if (!raw) return null; const o = JSON.parse(raw) as { at: number; b: unknown }; return validBootstrap(o.b) && now - o.at < MAX_AGE_MS ? o.b : null; } catch { return null; }
}

/** Fetches with a short timeout; any failure returns the cache (or null). The apiEndpoint is informational: the app keeps using its build-time API origin until the regional rollout switches clients. */
export async function loadBootstrap(cc?: string, timeoutMs = 2500): Promise<Bootstrap | null> {
  const cached = await cachedBootstrap();
  if (cached && !cc) return cached;
  try {
    const ctl = typeof AbortController !== "undefined" ? new AbortController() : undefined;
    const timer = setTimeout(() => ctl?.abort(), timeoutMs);
    const url = `${config.apiOrigin}/api/v1/bootstrap${cc && /^[a-z]{2}$/i.test(cc) ? `?cc=${cc.toLowerCase()}` : ""}`;
    const res = await fetch(url, { headers: { Accept: "application/json" }, signal: ctl?.signal });
    clearTimeout(timer);
    if (!res.ok) return cached;
    const b = (await res.json()) as unknown;
    if (!validBootstrap(b)) return cached;
    await prefs.set(KEY, JSON.stringify({ at: Date.now(), b }));
    return b;
  } catch { return cached; }
}

/** The market selector is shown only when more than one market is live (founder rule 23 Nov 2026). */
export const shouldShowMarketSelector = (b: Bootstrap | null): boolean => !!b && b.showMarketSelector === true && b.liveMarkets.length > 1;
