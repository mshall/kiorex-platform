/**
 * Privacy-safe product analytics (KX-03 §07). NO symptoms, diagnoses or free text: only whitelisted event names and
 * whitelisted prop keys survive `sanitize`. Search keywords are mapped to specialty codes BEFORE logging.
 */
export type AnalyticsEvent =
  | "search_started" | "results_viewed" | "slot_viewed" | "hold_created"
  | "booking_confirmed" | "booking_failed" | "visit_attended" | "no_show"
  | "review_submitted" | "refund_settled" | "payout_sent";

const ALLOWED_PROPS = new Set(["specialty", "area", "resultCount", "page", "doctorId", "visitTypeId", "bookingId", "code", "rating", "hasDeposit", "channel", "sort", "platform"]);

type Props = Record<string, string | number | boolean | null | undefined>;
type Evt = { name: AnalyticsEvent; at: string; props: Record<string, string | number | boolean> };
export type Sink = (batch: Evt[]) => void;

export function sanitize(props: Props = {}) {
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(props)) {
    if (!ALLOWED_PROPS.has(k) || v == null) continue;
    if (typeof v === "string" && v.length > 64) continue; // free text never allowed
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
  "باطنة": "internal-medicine", "internal": "internal-medicine",
};

/** Maps free-text search to a specialty code, or "other". The raw text is never returned. */
export function mapKeywordToSpecialty(q: string): string {
  const t = q.trim().toLowerCase();
  for (const [kw, code] of Object.entries(KEYWORD_TO_SPECIALTY)) if (t.includes(kw)) return code;
  return "other";
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
  queue.push({ name, at: new Date().toISOString(), props: sanitize({ platform: "mobile", ...props }) });
  timer ??= setTimeout(flushAnalytics, 1500);
}
