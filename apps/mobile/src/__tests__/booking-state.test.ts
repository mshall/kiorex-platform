import { ApiError } from "@/api/errors";
import { bookingLanded, canReview, classifyBookingError, isUpcoming, pollIntervalFor, screenFor } from "@/lib/booking-state";

const alt = (h: number) => ({ startsAt: `2030-01-01T0${h}:00:00Z`, endsAt: `2030-01-01T0${h}:20:00Z` });

describe("classifyBookingError (KXMBK04-07)", () => {
  it("409 SLOT_TAKEN → at most 3 alternatives", () => {
    const a = classifyBookingError(new ApiError(409, "SLOT_TAKEN", "taken", { alternatives: [alt(1), alt(2), alt(3), alt(4)] }));
    expect(a.kind).toBe("slot_taken");
    if (a.kind === "slot_taken") expect(a.alternatives).toHaveLength(3);
  });
  it("SLOT_TAKEN without alternatives still resolves", () => expect(classifyBookingError(new ApiError(409, "SLOT_TAKEN", "x"))).toEqual({ kind: "slot_taken", alternatives: [] }));
  it("HOLD_EXPIRED / DEPOSIT_REQUIRED", () => {
    expect(classifyBookingError(new ApiError(422, "HOLD_EXPIRED", "x")).kind).toBe("hold_expired");
    expect(classifyBookingError(new ApiError(409, "DEPOSIT_REQUIRED", "x")).kind).toBe("deposit_required");
  });
  it("FEATURE_DISABLED → unavailable", () => expect(classifyBookingError(new ApiError(403, "FEATURE_DISABLED", "x", { key: "kiorex.marketplace" })).kind).toBe("unavailable"));
  it("CANCELLATION_WINDOW_CLOSED is surfaced distinctly", () => expect(classifyBookingError(new ApiError(422, "CANCELLATION_WINDOW_CLOSED", "x")).kind).toBe("window_closed"));
  it("network error or CLINIC_SYSTEM_BUSY → look up the booking first, never retry blindly (KXMBK05)", () => {
    expect(classifyBookingError(new TypeError("Network request failed")).kind).toBe("lookup_first");
    expect(classifyBookingError(new ApiError(503, "CLINIC_SYSTEM_BUSY", "x", { retryable: true })).kind).toBe("lookup_first");
  });
  it("unknown code → generic", () => expect(classifyBookingError(new ApiError(500, "WAT", "x"))).toEqual({ kind: "generic", code: "WAT" }));
});

describe("booking state machine helpers (KX-03 §05)", () => {
  it("bookingLanded is true only for CONFIRMED / PENDING_CLINIC", () => {
    expect(bookingLanded({ status: "CONFIRMED" })).toBe(true);
    expect(bookingLanded({ status: "PENDING_CLINIC" })).toBe(true);
    expect(bookingLanded({ status: "HELD" })).toBe(false);
    expect(bookingLanded(undefined)).toBe(false);
  });
  it("HELD belongs on checkout, everything else on the appointment page", () => {
    expect(screenFor("HELD")).toBe("checkout");
    for (const s of ["PENDING_CLINIC", "CONFIRMED", "CHECKED_IN", "COMPLETED", "NO_SHOW", "CANCELLED", "EXPIRED"] as const) expect(screenFor(s)).toBe("appointment");
  });
  it("upcoming = active and not yet over", () => {
    const now = Date.parse("2030-01-01T12:00:00Z");
    expect(isUpcoming({ status: "CONFIRMED", endsAt: "2030-01-02T10:00:00Z" }, now)).toBe(true);
    expect(isUpcoming({ status: "CONFIRMED", endsAt: "2029-12-31T10:00:00Z" }, now)).toBe(false);
    expect(isUpcoming({ status: "CANCELLED", endsAt: "2030-01-02T10:00:00Z" }, now)).toBe(false);
  });
  it("polls only while waiting on the hold or the clinic", () => {
    expect(pollIntervalFor("HELD")).toBe(5000);
    expect(pollIntervalFor("PENDING_CLINIC")).toBe(5000);
    expect(pollIntervalFor("CONFIRMED")).toBe(false);
    expect(pollIntervalFor(undefined)).toBe(false);
  });
  it("only completed, not-yet-reviewed visits can be reviewed", () => {
    expect(canReview({ id: "a", status: "COMPLETED" })).toBe(true);
    expect(canReview({ id: "a", status: "COMPLETED" }, new Set(["a"]))).toBe(false);
    expect(canReview({ id: "a", status: "CONFIRMED" })).toBe(false);
  });
});
