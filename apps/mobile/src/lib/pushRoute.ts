// Push tap routing for the patient app. Remote payloads carry the product data under the `body` key (APNs custom key; FCM data) like the Kiorly staff app;
// expo-notifications surfaces it as content.data. We accept the object directly, nested under `body`, or as a JSON string. Never trust the payload:
// ids are validated before they become a path, and unknown shapes return null (the app then just opens).
export type PushData = Record<string, unknown>;

const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** Unwraps `{ body: {...} }` / `{ body: "{...}" }` / flat data into one object. */
export function pushPayload(raw: unknown): PushData | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as PushData;
  const b = o.body;
  if (b && typeof b === "object") return { ...o, ...(b as PushData) };
  if (typeof b === "string" && b.trim().startsWith("{")) { try { const p = JSON.parse(b); if (p && typeof p === "object") return { ...o, ...p }; } catch { /* fall through */ } }
  return o;
}

const str = (d: PushData, k: string): string => (typeof d[k] === "string" && SAFE_ID.test(d[k] as string) ? (d[k] as string) : "");

/** Maps a notification payload to an in-app path, or null. */
export function routeForPush(raw: unknown): string | null {
  const d = pushPayload(raw);
  if (!d) return null;
  const tpl = (typeof d.template === "string" ? d.template : typeof d.type === "string" ? d.type : typeof d.kind === "string" ? d.kind : "").toLowerCase();
  const sessionId = str(d, "sessionId") || str(d, "teleSessionId");
  const labId = str(d, "labBookingId");
  const orderId = str(d, "pharmacyOrderId") || str(d, "orderId");
  const bookingId = str(d, "bookingId") || str(d, "appointmentId");
  if (sessionId || /tele|video/.test(tpl)) return "/telemedicine";
  if (labId || (/lab/.test(tpl) && str(d, "orderId"))) return `/lab/booking/${labId || str(d, "orderId")}`;
  if (/result/.test(tpl) || str(d, "resultId") || str(d, "recordId")) return "/results";
  if (orderId || /pharmacy|order/.test(tpl)) return orderId ? `/pharmacy/order/${orderId}` : "/pharmacy/orders";
  if (bookingId) return `/appointment/${bookingId}`;
  if (/lab/.test(tpl)) return "/lab/bookings";
  return null;
}

/** The same tap can be reported by the live listener and the cold-start lookup; act once. */
export function makeTapDeduper() {
  let last = "";
  return (id: string | undefined | null): boolean => { if (!id || id === last) return false; last = id; return true; };
}
