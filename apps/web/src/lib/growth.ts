import { consentHeaders, readConsent, type StoredConsent } from "./consent";

/**
 * First-party growth analytics client (GRW-P1-J). Sends the CANONICAL funnel events the visitor stream owns (contracts `GROWTH_CLIENT_EVENT_NAMES`) to
 * `POST /api/v1/growth/v1/events`, in batches, with these rules:
 *  - nothing is sent before the visitor has made a choice in the consent banner (events wait in memory only, never persisted, dropped on unload);
 *  - with an analytics ACCEPT the `X-KX-Consent: analytics` header is added (the server may then key events to the `kxv` cookie); with a REJECT the same events go as the
 *    anonymous aggregate stream (no cookie, no identifier, nothing joinable);
 *  - props are a closed list of short tokens; `careType` is the only content field; a specialty, provider, search text, name, id or address cannot be expressed here.
 * `sendBeacon` is used on page hide when there is no consent header to carry (a beacon cannot set headers); otherwise `fetch(..., { keepalive: true })`.
 */
export const GROWTH_CLIENT_EVENTS = ["PageViewed", "SearchStarted", "ResultsViewed", "ProviderViewed", "AppInstalled", "WidgetLoaded", "WidgetBookingStarted", "WhatsAppConversationStarted", "ConsentGranted"] as const;
export type GrowthClientEvent = (typeof GROWTH_CLIENT_EVENTS)[number];
export const GROWTH_CARE_TYPES = ["DOCTORS", "PHYSIOTHERAPY", "HOME_NURSING"] as const;
export const GROWTH_LANDING_KINDS = ["HOME", "SPECIALTY_CITY", "SPECIALTY_DISTRICT", "CARE_TYPE_DISTRICT", "HUB", "DOCTOR", "CLINIC", "PROVIDER_LINK", "WIDGET", "REFERRAL", "CAMPAIGN", "WHATSAPP", "APP_OPEN", "OTHER"] as const;
const PROP_KEYS = ["surface", "platform", "locale", "step", "variant", "position", "count", "bucket", "reason", "sourceKind", "market", "appVersion", "widgetId"] as const;
const TOKEN = /^[A-Za-z0-9_.:-]{1,64}$/;
const MAX_BATCH = 20; const FLUSH_MS = 2000; const DEDUPE_MS = 60_000;

export interface GrowthEventInput { careType?: (typeof GROWTH_CARE_TYPES)[number]; landingKind?: (typeof GROWTH_LANDING_KINDS)[number]; props?: Record<string, string | number | boolean | null | undefined> }
interface Wire { name: GrowthClientEvent; occurredAt: string; careType?: string; landingKind?: string; props: Record<string, string | number | boolean> }

export function sanitizeProps(props: GrowthEventInput["props"] = {}): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(props)) {
    if (!(PROP_KEYS as readonly string[]).includes(k) || v === null || v === undefined) continue;
    if (typeof v === "string") { if (TOKEN.test(v) && !/@|\d{8,}/.test(v)) out[k] = v; } else if (typeof v === "number") { if (Number.isFinite(v) && Math.abs(v) < 1e9) out[k] = v; } else if (typeof v === "boolean") out[k] = v;
  }
  return out;
}

export interface TrackerDeps {
  send: (body: string, headers: Record<string, string>, opts: { unload: boolean }) => void;
  consent: () => StoredConsent | null;
  now: () => number;
  platform: () => string;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (h: unknown) => void;
}

export function createGrowthTracker(d: TrackerDeps) {
  let queue: Wire[] = []; let timer: unknown; const seen = new Map<string, number>();
  const decided = () => d.consent() !== null;
  function flush(unload = false) {
    if (timer !== undefined) { d.clearTimer(timer); timer = undefined; }
    if (!queue.length || !decided()) return; // before a choice nothing leaves the page
    const c = d.consent();
    while (queue.length) {
      const batch = queue.splice(0, MAX_BATCH);
      try { d.send(JSON.stringify({ events: batch }), { "Content-Type": "application/json", ...consentHeaders(c) }, { unload }); } catch { /* analytics must never break the app */ }
    }
  }
  function track(name: GrowthClientEvent, i: GrowthEventInput = {}) {
    if (!(GROWTH_CLIENT_EVENTS as readonly string[]).includes(name)) return;
    const careType = i.careType && (GROWTH_CARE_TYPES as readonly string[]).includes(i.careType) ? i.careType : undefined;
    const landingKind = i.landingKind && (GROWTH_LANDING_KINDS as readonly string[]).includes(i.landingKind) ? i.landingKind : undefined;
    const props = sanitizeProps({ platform: d.platform(), ...i.props });
    const key = JSON.stringify([name, careType, landingKind, props]); const t = d.now();
    const last = seen.get(key);
    if (last !== undefined && t - last < DEDUPE_MS) return; // duplicate suppression on the client; the server dedupes again by minute
    seen.set(key, t); if (seen.size > 200) seen.clear();
    queue.push({ name, occurredAt: new Date(t).toISOString(), ...(careType ? { careType } : {}), ...(landingKind ? { landingKind } : {}), props });
    if (queue.length > 100) queue = queue.slice(-100); // nothing grows without bound while the visitor has not decided
    if (queue.length >= MAX_BATCH) flush(); else timer ??= d.setTimer(() => flush(), FLUSH_MS);
  }
  return { track, flush, pending: () => queue.length, drop: () => { queue = []; } };
}

const browserDeps = (): TrackerDeps => ({
  send: (body, headers, { unload }) => {
    const url = "/api/v1/growth/v1/events";
    if (unload && !headers["X-KX-Consent"] && typeof navigator !== "undefined" && navigator.sendBeacon) { navigator.sendBeacon(url, new Blob([body], { type: "application/json" })); return; }
    void fetch(url, { method: "POST", headers, body, keepalive: true, credentials: "same-origin" }).catch(() => undefined);
  },
  consent: () => readConsent(),
  now: () => Date.now(),
  platform: () => "web",
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
});

let singleton: ReturnType<typeof createGrowthTracker> | null = null;
const tracker = () => (singleton ??= createGrowthTracker(browserDeps()));
export const trackGrowth = (name: GrowthClientEvent, i?: GrowthEventInput) => tracker().track(name, i);
export const flushGrowth = (unload = false) => tracker().flush(unload);
/** Test hook. */
export const resetGrowthTracker = () => { singleton = null; };
