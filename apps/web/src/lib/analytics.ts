/**
 * Privacy-safe product analytics (KX-03 §07). NO symptoms, diagnoses or free text: only the
 * whitelisted event names and whitelisted prop keys below survive `sanitize`.
 * Search keywords are mapped to specialty codes BEFORE logging (see mapKeywordToSpecialty).
 */
export type AnalyticsEvent =
  | "search_started" | "results_viewed" | "slot_viewed" | "booking_started" | "booking_failed"
  | "review_submitted" | "waitlist_joined" | "vault_opened" | "whatsapp_link_clicked";

/** Mirrors the server's closed whitelist (apps/api/src/analytics): anything else would make the whole batch 400. */
const ALLOWED_PROPS = new Set(["specialtyCode", "providerId", "market", "code"]);
export const SPECIALTY_CODES = ["dermatology", "paediatrics", "obgyn", "orthopaedics", "ent", "internal_medicine", "cardiology", "psychiatry", "ophthalmology", "urology", "dentistry"];
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const CODE = /^[A-Za-z0-9_]{1,40}$/;

type Props = Record<string, string | number | boolean | null | undefined>;
export type WireEvent = { name: AnalyticsEvent; props: Record<string, string> };
export type Sink = (batch: WireEvent[]) => void;

export function sanitize(props: Props = {}) {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(props)) {
    if (!ALLOWED_PROPS.has(k) || typeof v !== "string") continue; // free text, numbers and unknown keys never leave the browser
    if (k === "specialtyCode" && !SPECIALTY_CODES.includes(v)) continue;
    if (k === "providerId" && !ID.test(v)) continue;
    if (k === "market" && !/^[A-Z]{2}$/.test(v)) continue;
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

/** Maps free-text search to a specialty code, or "other". The raw text is never returned. */
export function mapKeywordToSpecialty(q: string): string {
  const t = q.trim().toLowerCase();
  for (const [kw, code] of Object.entries(KEYWORD_TO_SPECIALTY)) if (t.includes(kw)) return code;
  return "other";
}

let sink: Sink | null = null;
let queue: WireEvent[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;

export const setAnalyticsSink = (s: Sink | null) => { sink = s; };

function flush() {
  timer = undefined;
  if (!queue.length) return;
  const batch = queue; queue = [];
  try { sink?.(batch); } catch { /* analytics must never break the app */ }
}

export function track(name: AnalyticsEvent, props?: Props) {
  queue.push({ name, props: sanitize(props) });
  timer ??= setTimeout(flush, 1500);
}
export const flushAnalytics = flush;
