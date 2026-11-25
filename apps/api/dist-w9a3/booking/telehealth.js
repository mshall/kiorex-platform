"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isTelehealthEvent = exports.TELE_EVENT_STATE = exports.teleWindow = exports.safeJoinUrl = exports.TELE_CLOSE_AFTER_MS = exports.TELE_OPEN_BEFORE_MS = void 0;
exports.parseTelehealth = parseTelehealth;
exports.presentTelehealth = presentTelehealth;
exports.TELE_OPEN_BEFORE_MS = 15 * 60_000;
exports.TELE_CLOSE_AFTER_MS = 2 * 3600_000;
const iso = (v) => { const d = typeof v === 'string' || typeof v === 'number' || v instanceof Date ? new Date(v) : null; return d && !Number.isNaN(d.getTime()) ? d.toISOString() : null; };
const safeJoinUrl = (v) => {
    if (typeof v !== 'string' || v.length > 2048)
        return null;
    try {
        const u = new URL(v);
        return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
    }
    catch {
        return null;
    }
};
exports.safeJoinUrl = safeJoinUrl;
function parseTelehealth(raw, prev) {
    if (!raw || typeof raw !== 'object')
        return null;
    const r = raw;
    const sessionId = typeof r.sessionId === 'string' && r.sessionId ? r.sessionId : prev?.sessionId;
    if (!sessionId)
        return null;
    const joinUrl = (0, exports.safeJoinUrl)(r.joinUrl ?? r.patientJoinUrl) ?? prev?.joinUrl ?? null;
    return { sessionId, joinUrl, opensAt: iso(r.opensAt) ?? null, closesAt: iso(r.closesAt) ?? null, state: prev?.state ?? 'SCHEDULED', movedFrom: prev?.movedFrom ?? null };
}
const teleWindow = (b, startsAt) => ({
    opensAt: b.opensAt ?? new Date(startsAt.getTime() - exports.TELE_OPEN_BEFORE_MS).toISOString(),
    closesAt: b.closesAt ?? new Date(startsAt.getTime() + exports.TELE_CLOSE_AFTER_MS).toISOString(),
});
exports.teleWindow = teleWindow;
function presentTelehealth(block, booking) {
    if (!block)
        return null;
    let state = block.state;
    if (state !== 'IN_PERSON') {
        if (booking.status === 'CANCELLED' || booking.status === 'EXPIRED')
            state = 'CANCELLED';
        else if (booking.status === 'NO_SHOW')
            state = 'MISSED';
        else if (booking.status === 'COMPLETED')
            state = 'ENDED';
    }
    const w = (0, exports.teleWindow)(block, booking.startsAt);
    const joinable = (state === 'SCHEDULED' || state === 'LIVE') && !!block.joinUrl;
    return { sessionId: block.sessionId, state, joinUrl: joinable ? block.joinUrl : null, opensAt: w.opensAt, closesAt: w.closesAt, movedFrom: state === 'SCHEDULED' || state === 'LIVE' ? block.movedFrom : null };
}
exports.TELE_EVENT_STATE = {
    'telehealth.session.created': 'SCHEDULED',
    'telehealth.session.link_regenerated': 'LINK',
    'telehealth.session.rescheduled': 'WINDOW',
    'telehealth.session.started': 'LIVE',
    'telehealth.session.ended': 'ENDED',
    'telehealth.session.missed': 'MISSED',
    'telehealth.session.cancelled': 'CANCELLED',
    'telehealth.session.converted': 'IN_PERSON',
};
const isTelehealthEvent = (type) => type.toLowerCase().startsWith('telehealth.');
exports.isTelehealthEvent = isTelehealthEvent;
//# sourceMappingURL=telehealth.js.map