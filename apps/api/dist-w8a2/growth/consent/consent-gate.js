"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.marketingPurposeFor = exports.GATE_CHANNELS = exports.GATE_PURPOSES = void 0;
exports.quietEnd = quietEnd;
exports.evaluateSend = evaluateSend;
exports.GATE_PURPOSES = ['TRANSACTIONAL', 'SECURITY', 'CLINICAL', 'REMINDER', 'MARKETING'];
exports.GATE_CHANNELS = ['WHATSAPP', 'SMS', 'EMAIL', 'PUSH', 'INAPP'];
const marketingPurposeFor = (channel) => `MARKETING_${channel === 'INAPP' ? 'PUSH' : channel}`;
exports.marketingPurposeFor = marketingPurposeFor;
function quietEnd(at, q) {
    if (q.startHour === q.endHour)
        return null;
    const off = q.tzOffsetMinutes * 60_000;
    const local = new Date(at + off);
    const h = local.getUTCHours();
    const inside = q.startHour > q.endHour ? h >= q.startHour || h < q.endHour : h >= q.startHour && h < q.endHour;
    if (!inside)
        return null;
    const end = new Date(local);
    end.setUTCHours(q.endHour, 0, 0, 0);
    if (end.getTime() <= local.getTime())
        end.setUTCDate(end.getUTCDate() + 1);
    return end.getTime() - off;
}
function evaluateSend(f) {
    const marketing = f.purpose === 'MARKETING';
    if (marketing && !f.marketingEnabled)
        return { allow: false, reason: 'MARKETING_DISABLED' };
    if ((marketing || f.purpose === 'REMINDER') && !f.consent)
        return { allow: false, reason: 'CONSENT' };
    if (f.purpose !== 'SECURITY' && f.optedOut)
        return { allow: false, reason: 'OPT_OUT' };
    if (marketing && f.suppressed)
        return { allow: false, reason: 'SUPPRESSED' };
    const quietExempt = f.purpose === 'SECURITY' || (f.channel === 'INAPP' && !marketing) || (f.purpose === 'CLINICAL' && f.critical === true) || f.quietBypass === true;
    if (!quietExempt && f.quiet) {
        const until = quietEnd(f.now, f.quiet);
        if (until !== null)
            return { allow: false, reason: 'QUIET_HOURS', until };
    }
    if (marketing) {
        if (f.caps.perDay <= 0 || f.sentLast24h >= f.caps.perDay)
            return { allow: false, reason: 'FREQUENCY_CAP_DAY' };
        if (f.caps.perWeek <= 0 || f.sentLast7d >= f.caps.perWeek)
            return { allow: false, reason: 'FREQUENCY_CAP_WEEK' };
    }
    return { allow: true };
}
//# sourceMappingURL=consent-gate.js.map