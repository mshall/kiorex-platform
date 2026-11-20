/**
 * Kiorex booking state machine — exactly KX-03 §05. Kiorly's appointment status is authoritative;
 * transitions are driven by outbox webhook events (or GET-by-ref reconciliation).
 */
export type BookingStatus = 'INTENT' | 'HELD' | 'PENDING_CLINIC' | 'CONFIRMED' | 'CHECKED_IN' | 'COMPLETED' | 'NO_SHOW' | 'CANCELLED' | 'EXPIRED';

export const TERMINAL: BookingStatus[] = ['COMPLETED', 'NO_SHOW', 'CANCELLED', 'EXPIRED'];
export const isTerminal = (s: string) => (TERMINAL as string[]).includes(s);

/** Diagram edges. */
export const EDGES: Record<BookingStatus, BookingStatus[]> = {
  INTENT: ['HELD', 'EXPIRED', 'CANCELLED'],
  HELD: ['PENDING_CLINIC', 'CONFIRMED', 'EXPIRED', 'CANCELLED'],
  PENDING_CLINIC: ['CONFIRMED', 'EXPIRED', 'CANCELLED'],
  CONFIRMED: ['CANCELLED', 'CHECKED_IN', 'NO_SHOW', 'COMPLETED'],
  CHECKED_IN: ['COMPLETED', 'CONFIRMED' /* CHECK_IN_REVERTED */, 'CANCELLED'],
  COMPLETED: [], NO_SHOW: [], CANCELLED: [], EXPIRED: [],
};

const RANK: Record<string, number> = { INTENT: 0, HELD: 1, PENDING_CLINIC: 2, CONFIRMED: 3, CHECKED_IN: 4, COMPLETED: 5, NO_SHOW: 5 };

export function canTransition(from: BookingStatus, to: BookingStatus): boolean {
  return EDGES[from]?.includes(to) ?? false;
}

/** Kiorly event type → target status (null = no state change). RESCHEDULED keeps CONFIRMED. */
export function targetForEvent(type: string): BookingStatus | 'SAME' | null {
  switch (type) {
    case 'APPOINTMENT_CONFIRMED': return 'CONFIRMED';
    case 'RESCHEDULED': case 'APPOINTMENT_RESCHEDULED': return 'SAME';
    case 'CANCELLED_BY_CLINIC': case 'CANCELLED_BY_PATIENT': return 'CANCELLED';
    case 'CHECKED_IN': return 'CHECKED_IN';
    case 'CHECK_IN_REVERTED': return 'CONFIRMED';
    case 'COMPLETED': return 'COMPLETED';
    case 'NO_SHOW': return 'NO_SHOW';
    case 'MARKETPLACE_BOOKING_CONFIRM_TIMEOUT': return 'EXPIRED';
    case 'HOME_VISIT_ABORTED_UNSAFE': return 'CANCELLED'; // unsafe abort = CANCELLED (never a no-show, BR61); the deposit is held for review (KXMPAY07)
    default: return null;
  }
}

// ───────────── Rev 2.3 home sub-states (KX-03 §05 "State machine: home sub-states") ─────────────

/**
 * Home visits keep the KX-03 §05 status machine and add a sub-state driven by Kiorly events:
 *   HOME_VISIT_ASSIGNED -> ASSIGNED, HOME_VISIT_EN_ROUTE -> EN_ROUTE, CHECKED_IN (arrival geostamp attributed by Kiorly) -> ARRIVED,
 *   HOME_VISIT_ABORTED_UNSAFE -> ABORTED_UNSAFE (main status CANCELLED). Finished = main status COMPLETED.
 * Sub-states only move forward (ASSIGNED < EN_ROUTE < ARRIVED); stale / out-of-order events are ignored; ABORTED_UNSAFE is terminal.
 */
export type HomeState = 'ASSIGNED' | 'EN_ROUTE' | 'ARRIVED' | 'ABORTED_UNSAFE';
export const HOME_EVENTS = ['HOME_VISIT_ASSIGNED', 'HOME_VISIT_EN_ROUTE', 'HOME_VISIT_ABORTED_UNSAFE'] as const;
export const isHomeEvent = (t: string) => (HOME_EVENTS as readonly string[]).includes(t);
const HOME_RANK: Record<string, number> = { ASSIGNED: 1, EN_ROUTE: 2, ARRIVED: 3 };

/** Next home sub-state for an event (null = no change). `status` is the main booking status. */
export function nextHomeState(current: string | null | undefined, status: string, type: string): HomeState | null {
  if (current === 'ABORTED_UNSAFE' || isTerminal(status)) return null;
  const target: HomeState | null = type === 'HOME_VISIT_ASSIGNED' ? 'ASSIGNED' : type === 'HOME_VISIT_EN_ROUTE' ? 'EN_ROUTE' : type === 'CHECKED_IN' ? 'ARRIVED' : type === 'HOME_VISIT_ABORTED_UNSAFE' ? 'ABORTED_UNSAFE' : null;
  if (!target) return null;
  if (target === 'ABORTED_UNSAFE') return ['PENDING_CLINIC', 'CONFIRMED', 'CHECKED_IN'].includes(status) ? target : null;
  if (!['PENDING_CLINIC', 'CONFIRMED', 'CHECKED_IN'].includes(status)) return null;
  return (HOME_RANK[target] ?? 0) > (HOME_RANK[current ?? ''] ?? 0) ? target : null;
}

/** The patient-facing timeline of a home visit: Confirmed -> On the way -> Arrived -> Finished (KXMHV06). */
export const HOME_TIMELINE_STEPS = ['CONFIRMED', 'ON_THE_WAY', 'ARRIVED', 'FINISHED'] as const;

/**
 * Decide the status after applying an event. Tolerates out-of-order/missed events: forward jumps are allowed
 * (e.g. COMPLETED without CHECKED_IN), terminal states never move, stale events are ignored.
 */
export function nextStatus(current: BookingStatus, type: string): BookingStatus | null {
  const t = targetForEvent(type);
  if (t === null) return null;
  if (isTerminal(current)) return null;
  if (t === 'SAME') return current === 'CONFIRMED' ? 'CONFIRMED' : null;
  if (type === 'CHECK_IN_REVERTED') return current === 'CHECKED_IN' ? 'CONFIRMED' : null;
  if (t === 'CANCELLED' || t === 'EXPIRED') return t === 'EXPIRED' && current !== 'PENDING_CLINIC' ? null : t;
  return (RANK[t] ?? 0) > (RANK[current] ?? 0) ? t : null;
}

/** Map Kiorly appointment status (GET /bookings/:ref) to a Kiorex status. */
export function fromKiorlyStatus(s: string | undefined | null): BookingStatus | null {
  switch ((s ?? '').toUpperCase()) {
    case 'SCHEDULED': return 'PENDING_CLINIC';
    case 'CONFIRMED': return 'CONFIRMED';
    case 'CHECKED_IN': case 'IN_PROGRESS': case 'IN_CONSULTATION': return 'CHECKED_IN';
    case 'COMPLETED': return 'COMPLETED';
    case 'NO_SHOW': return 'NO_SHOW';
    case 'CANCELLED': case 'CANCELED': return 'CANCELLED';
    default: return null;
  }
}
