// Pure helpers for the KX-03 §05 booking state machine and the confirm/hold error handling (KXMBK04-06).
import { ApiError } from "@/api/errors";
import type { Booking, BookingStatus, Slot } from "@/api/types";

export type BookingErrorAction =
  | { kind: "slot_taken"; alternatives: Slot[] }
  | { kind: "hold_expired" }
  | { kind: "deposit_required" }
  | { kind: "unavailable" }
  | { kind: "window_closed" }
  | { kind: "not_changeable" }
  | { kind: "lookup_first" }   // network error / timeout: GET the booking BEFORE any retry (KXMBK05)
  | { kind: "generic"; code: string };

/** Maps a failed hold/confirm/cancel/reschedule call to the UI action. Never retries with a new idempotency key. */
export function classifyBookingError(e: unknown): BookingErrorAction {
  if (!(e instanceof ApiError)) return { kind: "lookup_first" };
  if (e.isFeatureDisabled) return { kind: "unavailable" };
  switch (e.code) {
    case "SLOT_TAKEN": return { kind: "slot_taken", alternatives: ((e.details?.alternatives as Slot[] | undefined) ?? []).slice(0, 3) };
    case "HOLD_EXPIRED": return { kind: "hold_expired" };
    case "BOOKING_NOT_CONFIRMABLE":
    case "BOOKING_NOT_CHANGEABLE": return { kind: "not_changeable" };
    case "DEPOSIT_REQUIRED": return { kind: "deposit_required" };
    case "CANCELLATION_WINDOW_CLOSED":
    case "RESCHEDULE_WINDOW_CLOSED": return { kind: "window_closed" };
    // The clinic system is busy / the outcome is unknown: GET the booking first, never mint a new idempotency key (KXMBK05).
    case "CLINIC_SYSTEM_BUSY": return { kind: "lookup_first" };
    default: return { kind: "generic", code: e.code };
  }
}

/** After an ambiguous failure: has the booking actually progressed server-side? */
export const bookingLanded = (b: Pick<Booking, "status"> | undefined) => b?.status === "CONFIRMED" || b?.status === "PENDING_CLINIC";

/** Where a booking belongs in the UI. HELD → checkout; everything else → appointment detail. */
export const screenFor = (s: BookingStatus): "checkout" | "appointment" => (s === "HELD" || s === "INTENT" ? "checkout" : "appointment");

export const isUpcoming = (b: Pick<Booking, "status" | "endsAt">, now = Date.now()) =>
  (b.status === "CONFIRMED" || b.status === "PENDING_CLINIC") && new Date(b.endsAt).getTime() > now;

export const isActiveBooking = (s: BookingStatus) => s === "HELD" || s === "PENDING_CLINIC";

/** Polling cadence for states waiting on the clinic / hold. */
export const pollIntervalFor = (s: BookingStatus | undefined, home = false) =>
  s && isActiveBooking(s) ? 5_000 : home && (s === "CONFIRMED" || s === "CHECKED_IN") ? 15_000 : false; // home visits: assigned / on the way / arrived updates

/** Only COMPLETED visits can be reviewed, once (KXMRV01). `reviewedBookingIds` comes from GET /me/reviews. */
export const canReview = (b: Pick<Booking, "id" | "status">, reviewedBookingIds: ReadonlySet<string> = new Set()) => b.status === "COMPLETED" && !reviewedBookingIds.has(b.id);
