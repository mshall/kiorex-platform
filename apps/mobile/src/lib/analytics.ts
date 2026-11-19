/**
 * Privacy-safe product analytics (KX-03 §07), sent to POST /analytics/events (public, PHI-free, no identifiers).
 * The API validates a CLOSED whitelist and rejects the WHOLE batch on any unknown event/prop, so `track` enforces the same
 * whitelist client-side: unknown names are dropped, only the four allowed props survive, free text is never accepted.
 */
export const CLIENT_EVENTS = ["search_started", "results_viewed", "slot_viewed", "booking_started", "booking_failed", "review_submitted", "waitlist_joined", "vault_opened", "whatsapp_link_clicked"] as const;
export type AnalyticsEvent = (typeof CLIENT_EVENTS)[number];
export const ALLOWED_PROPS = ["specialtyCode", "providerId", "market", "code"] as const;
export const SPECIALTY_CODES = ["dermatology", "paediatrics", "obgyn", "orthopaedics", "ent", "internal_medicine", "cardiology", "psychiatry", "ophthalmology", "urology", "dentistry"] as const;
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const CODE = /^[A-Za-z0-9_]{1,40}$/;
const MARKET = /^[A-Z]{2}$/;

type Props = Partial<Record<(typeof ALLOWED_PROPS)[number], string | null | undefined>>;
export type Evt = { name: AnalyticsEvent; props: Record<string, string> };
export type Sink = (batch: Evt[]) => void;

export function sanitize(props: Record<string, unknown> = {}) {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(props)) {
    if (!(ALLOWED_PROPS as readonly string[]).includes(k) || typeof v !== "string") continue;
    if (k === "specialtyCode" && !(SPECIALTY_CODES as readonly string[]).includes(v)) continue;
    if (k === "providerId" && !ID.test(v)) continue;
    if (k === "market" && !MARKET.test(v)) continue;
    if (k === "code" && !CODE.test(v)) continue;
    out[k] = v;
  }
  return out;
}

const KEYWORD_TO_SPECIALTY: Record<string, string> = {
  "اسنان": "dentistry", "أسنان": "dentistry", "سنان": "dentistry", "dent": "dentistry",
  "اطفال": "paediatrics", "أطفال": "paediatrics", "child": "paediatrics", "pediatric": "paediatrics", "paediatric": "paediatrics",
  "قلب": "cardiology", "heart": "cardiology", "cardio": "cardiology",
  "جلد": "dermatology", "skin": "dermatology", "derma": "dermatology",
  "عيون": "ophthalmology", "eye": "ophthalmology",
  "عظام": "orthopaedics", "bone": "orthopaedics", "ortho": "orthopaedics",
  "نساء": "obgyn", "ولادة": "obgyn", "gyn": "obgyn",
  "انف": "ent", "أنف": "ent", "ent": "ent",
  "نفسي": "psychiatry", "psych": "psychiatry",
  "مسالك": "urology", "urolog": "urology",
  "باطنة": "internal_medicine", "internal": "internal_medicine",
};

/** Maps free-text search to a specialty code, or null. The raw text is never returned. */
export function mapKeywordToSpecialty(q: string): string | null {
  const t = q.trim().toLowerCase();
  for (const [kw, code] of Object.entries(KEYWORD_TO_SPECIALTY)) if (t.includes(kw)) return code;
  return null;
}

let sink: Sink | null = null;
let queue: Evt[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;

export const setAnalyticsSink = (s: Sink | null) => { sink = s; };

export function flushAnalytics() {
  if (timer) clearTimeout(timer);
  timer = undefined;
  if (!queue.length) return;
  const batch = queue; queue = [];
  try { sink?.(batch); } catch { /* analytics must never break the app */ }
}

export function track(name: AnalyticsEvent, props?: Props) {
  if (!(CLIENT_EVENTS as readonly string[]).includes(name)) return;
  queue.push({ name, props: sanitize(props) });
  timer ??= setTimeout(flushAnalytics, 1500);
}
