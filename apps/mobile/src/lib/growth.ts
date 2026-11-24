import { Platform } from "react-native";
import { config } from "./config";
import { getGrowthConsent, type GrowthConsent } from "./growthConsent";
import { prefs } from "./storage";

/**
 * First-party growth analytics for the patient app (GRW-P1-J). Same contract as the web client: the canonical funnel events the visitor stream owns, in batches to
 * POST /api/v1/growth/v1/events, closed fields only (no specialty, provider, search text or device id), duplicates suppressed for a minute, and consent honoured:
 * nothing is sent while the choice is undecided; granted adds `X-KX-Consent: analytics`; denied sends the anonymous aggregate stream (no identifier at all; the
 * app has no cookie and no advertising id is read). `AppInstalled` is written once per install from the first launch.
 */
export const APP_EVENTS = ["PageViewed", "SearchStarted", "ResultsViewed", "ProviderViewed", "AppInstalled", "WhatsAppConversationStarted", "ConsentGranted"] as const;
export type AppGrowthEvent = (typeof APP_EVENTS)[number];
const CARE = ["DOCTORS", "PHYSIOTHERAPY", "HOME_NURSING"];
const PROP_KEYS = ["surface", "platform", "locale", "step", "variant", "position", "count", "bucket", "reason", "sourceKind", "market", "appVersion"];
const TOKEN = /^[A-Za-z0-9_.:-]{1,64}$/;
const INSTALLED_KEY = "kx.growth.installed.v1";

export interface Wire { name: AppGrowthEvent; occurredAt: string; careType?: string; landingKind?: string; props: Record<string, string | number | boolean> }
export interface Deps { consent: () => Promise<GrowthConsent>; send: (body: string, headers: Record<string, string>) => Promise<void>; now: () => number; platform: () => string }

export function createAppGrowth(d: Deps) {
  let queue: Wire[] = []; const seen = new Map<string, number>();
  async function flush() {
    if (!queue.length) return;
    const c = await d.consent();
    if (c === null) return; // undecided: keep in memory only
    const headers: Record<string, string> = { "Content-Type": "application/json", ...(c === "granted" ? { "X-KX-Consent": "analytics" } : {}) };
    while (queue.length) { const batch = queue.splice(0, 20); try { await d.send(JSON.stringify({ events: batch }), headers); } catch { /* analytics must never break the app */ } }
  }
  function track(name: AppGrowthEvent, i: { careType?: string; landingKind?: string; props?: Record<string, string | number | boolean | null | undefined> } = {}) {
    if (!(APP_EVENTS as readonly string[]).includes(name)) return;
    const props: Wire["props"] = { platform: d.platform() };
    for (const [k, v] of Object.entries(i.props ?? {})) if (PROP_KEYS.includes(k) && ((typeof v === "string" && TOKEN.test(v) && !/@|\d{8,}/.test(v)) || (typeof v === "number" && Number.isFinite(v)) || typeof v === "boolean")) props[k] = v as never;
    const careType = i.careType && CARE.includes(i.careType) ? i.careType : undefined;
    const key = JSON.stringify([name, careType, i.landingKind, props]); const t = d.now();
    if (seen.has(key) && t - seen.get(key)! < 60_000) return;
    seen.set(key, t); if (seen.size > 200) seen.clear();
    queue.push({ name, occurredAt: new Date(t).toISOString(), ...(careType ? { careType } : {}), ...(i.landingKind ? { landingKind: i.landingKind } : {}), props });
    if (queue.length > 100) queue = queue.slice(-100);
    if (queue.length >= 20) void flush();
  }
  return { track, flush, pending: () => queue.length };
}

const app = createAppGrowth({
  consent: () => getGrowthConsent(),
  send: async (body, headers) => { await fetch(`${config.apiOrigin}/api/v1/growth/v1/events`, { method: "POST", headers, body }); },
  now: () => Date.now(),
  platform: () => Platform.OS,
});
export const trackGrowth = app.track;
export const flushGrowth = app.flush;

/** First launch of an install: one AppInstalled (the device flag is a local boolean, never sent). Call once at startup. */
export async function recordInstallOnce() {
  if ((await prefs.get(INSTALLED_KEY)) === "1") return;
  await prefs.set(INSTALLED_KEY, "1");
  app.track("AppInstalled", { landingKind: "APP_OPEN" });
}
