"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.stageChange = exports.stageRank = exports.daysBetween = exports.DEFAULT_STAGE_THRESHOLDS = exports.LIFECYCLE_STAGES = void 0;
exports.deriveStage = deriveStage;
exports.LIFECYCLE_STAGES = ['REGISTERED', 'ACTIVATED', 'BOOKED', 'ATTENDED', 'RETAINED', 'DORMANT', 'CHURNED'];
exports.DEFAULT_STAGE_THRESHOLDS = { dormantDays: 180, churnedDays: 365, retainedAttendedMin: 2, retainedWindowDays: 365 };
const DAY = 86_400_000;
const daysBetween = (from, to) => Math.floor((to.getTime() - from.getTime()) / DAY);
exports.daysBetween = daysBetween;
function deriveStage(f, now, t = exports.DEFAULT_STAGE_THRESHOLDS) {
    const lastActivity = [f.lastBookingAt, f.lastAttendedAt, f.registeredAt].filter((d) => !!d).reduce((a, b) => (a.getTime() >= b.getTime() ? a : b));
    const idle = (0, exports.daysBetween)(lastActivity, now);
    if (!f.hasUpcoming) {
        if (idle >= t.churnedDays)
            return 'CHURNED';
        if (idle >= t.dormantDays)
            return 'DORMANT';
    }
    if (f.attendedInWindow >= t.retainedAttendedMin)
        return 'RETAINED';
    if (f.attendedTotal >= 1)
        return 'ATTENDED';
    if (f.bookedCount >= 1)
        return 'BOOKED';
    if (f.intentCount >= 1)
        return 'ACTIVATED';
    return 'REGISTERED';
}
const stageRank = (s) => exports.LIFECYCLE_STAGES.indexOf(s);
exports.stageRank = stageRank;
const stageChange = (from, to) => ({ from, to, changed: from !== to });
exports.stageChange = stageChange;
//# sourceMappingURL=lifecycle.stage.js.map