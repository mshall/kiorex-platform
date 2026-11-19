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
    default: return null;
  }
}

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
