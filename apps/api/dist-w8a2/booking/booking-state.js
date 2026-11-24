"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HOME_TIMELINE_STEPS = exports.isHomeEvent = exports.HOME_EVENTS = exports.EDGES = exports.isTerminal = exports.TERMINAL = void 0;
exports.canTransition = canTransition;
exports.targetForEvent = targetForEvent;
exports.nextHomeState = nextHomeState;
exports.nextStatus = nextStatus;
exports.fromKiorlyStatus = fromKiorlyStatus;
exports.TERMINAL = ['COMPLETED', 'NO_SHOW', 'CANCELLED', 'EXPIRED'];
const isTerminal = (s) => exports.TERMINAL.includes(s);
exports.isTerminal = isTerminal;
exports.EDGES = {
    INTENT: ['HELD', 'EXPIRED', 'CANCELLED'],
    HELD: ['PENDING_CLINIC', 'CONFIRMED', 'EXPIRED', 'CANCELLED'],
    PENDING_CLINIC: ['CONFIRMED', 'EXPIRED', 'CANCELLED'],
    CONFIRMED: ['CANCELLED', 'CHECKED_IN', 'NO_SHOW', 'COMPLETED'],
    CHECKED_IN: ['COMPLETED', 'CONFIRMED', 'CANCELLED'],
    COMPLETED: [], NO_SHOW: [], CANCELLED: [], EXPIRED: [],
};
const RANK = { INTENT: 0, HELD: 1, PENDING_CLINIC: 2, CONFIRMED: 3, CHECKED_IN: 4, COMPLETED: 5, NO_SHOW: 5 };
function canTransition(from, to) {
    return exports.EDGES[from]?.includes(to) ?? false;
}
function targetForEvent(type) {
    switch (type) {
        case 'APPOINTMENT_CONFIRMED': return 'CONFIRMED';
        case 'RESCHEDULED':
        case 'APPOINTMENT_RESCHEDULED': return 'SAME';
        case 'CANCELLED_BY_CLINIC':
        case 'CANCELLED_BY_PATIENT': return 'CANCELLED';
        case 'CHECKED_IN': return 'CHECKED_IN';
        case 'CHECK_IN_REVERTED': return 'CONFIRMED';
        case 'COMPLETED': return 'COMPLETED';
        case 'NO_SHOW': return 'NO_SHOW';
        case 'MARKETPLACE_BOOKING_CONFIRM_TIMEOUT': return 'EXPIRED';
        case 'HOME_VISIT_ABORTED_UNSAFE': return 'CANCELLED';
        default: return null;
    }
}
exports.HOME_EVENTS = ['HOME_VISIT_ASSIGNED', 'HOME_VISIT_EN_ROUTE', 'HOME_VISIT_ABORTED_UNSAFE'];
const isHomeEvent = (t) => exports.HOME_EVENTS.includes(t);
exports.isHomeEvent = isHomeEvent;
const HOME_RANK = { ASSIGNED: 1, EN_ROUTE: 2, ARRIVED: 3 };
function nextHomeState(current, status, type) {
    if (current === 'ABORTED_UNSAFE' || (0, exports.isTerminal)(status))
        return null;
    const target = type === 'HOME_VISIT_ASSIGNED' ? 'ASSIGNED' : type === 'HOME_VISIT_EN_ROUTE' ? 'EN_ROUTE' : type === 'CHECKED_IN' ? 'ARRIVED' : type === 'HOME_VISIT_ABORTED_UNSAFE' ? 'ABORTED_UNSAFE' : null;
    if (!target)
        return null;
    if (target === 'ABORTED_UNSAFE')
        return ['PENDING_CLINIC', 'CONFIRMED', 'CHECKED_IN'].includes(status) ? target : null;
    if (!['PENDING_CLINIC', 'CONFIRMED', 'CHECKED_IN'].includes(status))
        return null;
    return (HOME_RANK[target] ?? 0) > (HOME_RANK[current ?? ''] ?? 0) ? target : null;
}
exports.HOME_TIMELINE_STEPS = ['CONFIRMED', 'ON_THE_WAY', 'ARRIVED', 'FINISHED'];
function nextStatus(current, type) {
    const t = targetForEvent(type);
    if (t === null)
        return null;
    if ((0, exports.isTerminal)(current))
        return null;
    if (t === 'SAME')
        return current === 'CONFIRMED' ? 'CONFIRMED' : null;
    if (type === 'CHECK_IN_REVERTED')
        return current === 'CHECKED_IN' ? 'CONFIRMED' : null;
    if (t === 'CANCELLED' || t === 'EXPIRED')
        return t === 'EXPIRED' && current !== 'PENDING_CLINIC' ? null : t;
    return (RANK[t] ?? 0) > (RANK[current] ?? 0) ? t : null;
}
function fromKiorlyStatus(s) {
    switch ((s ?? '').toUpperCase()) {
        case 'SCHEDULED': return 'PENDING_CLINIC';
        case 'CONFIRMED': return 'CONFIRMED';
        case 'CHECKED_IN':
        case 'IN_PROGRESS':
        case 'IN_CONSULTATION': return 'CHECKED_IN';
        case 'COMPLETED': return 'COMPLETED';
        case 'NO_SHOW': return 'NO_SHOW';
        case 'CANCELLED':
        case 'CANCELED': return 'CANCELLED';
        default: return null;
    }
}
//# sourceMappingURL=booking-state.js.map