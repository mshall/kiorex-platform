"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GATE_REASONS = exports.MESSAGE_CLASSES = void 0;
exports.evaluateSendGate = evaluateSendGate;
const engagement_public_1 = require("../../engagement/engagement-public");
Object.defineProperty(exports, "MESSAGE_CLASSES", { enumerable: true, get: function () { return engagement_public_1.MESSAGE_CLASSES; } });
const quiet_hours_1 = require("./quiet-hours");
exports.GATE_REASONS = [
    'OK', 'JOURNEY_DISABLED', 'MARKETING_FLAG_OFF', 'HOLDOUT', 'NO_CONSENT', 'CHANNEL_OPTED_OUT', 'SUPPRESSED', 'QUIET_HOURS', 'CAP_DAY', 'CAP_WEEK',
    'WHATSAPP_TEMPLATE_REQUIRED', 'NO_ADDRESS', 'PHI_BLOCKED', 'DUPLICATE', 'STOPPED', 'NOT_ELIGIBLE',
];
const skip = (reason, deferUntil) => ({ decision: 'SKIP', reason, ...(deferUntil !== undefined ? { deferUntil } : {}) });
function evaluateSendGate(i) {
    const marketing = i.messageClass === 'MARKETING';
    if (!i.journeyEnabled)
        return skip('JOURNEY_DISABLED');
    if (marketing) {
        if (!i.marketingFlagOn)
            return skip('MARKETING_FLAG_OFF');
        if (i.inHoldout)
            return skip('HOLDOUT');
    }
    if ((i.messageClass === 'TRANSACTIONAL' && i.channel !== 'INAPP') || marketing) {
        if (!i.consent)
            return skip('NO_CONSENT');
    }
    const bypassesOptOut = i.messageClass === 'SECURITY' || (i.messageClass === 'CLINICAL' && i.critical === true);
    if (!bypassesOptOut && i.channel !== 'INAPP' && i.channelOptedOut)
        return skip('CHANNEL_OPTED_OUT');
    if (marketing && i.suppressed)
        return skip('SUPPRESSED');
    const quietExempt = i.channel === 'INAPP' || i.messageClass === 'SECURITY' || (i.messageClass === 'CLINICAL' && i.critical === true) || (!marketing && i.quietBypass === true);
    if (!quietExempt && i.quiet) {
        const until = (0, quiet_hours_1.quietEnd)(i.now, i.quiet);
        if (until !== null)
            return skip('QUIET_HOURS', until);
    }
    if (marketing) {
        if (i.caps.perDay <= 0 || i.sentDay >= i.caps.perDay)
            return skip('CAP_DAY');
        if (i.caps.perWeek <= 0 || i.sentWeek >= i.caps.perWeek)
            return skip('CAP_WEEK');
    }
    if (i.channel === 'WHATSAPP' && !i.whatsappWindowOpen && !i.templateApproved)
        return skip('WHATSAPP_TEMPLATE_REQUIRED');
    if (!i.hasAddress)
        return skip('NO_ADDRESS');
    if (i.phiHits.length > 0)
        return skip('PHI_BLOCKED');
    if (i.duplicate)
        return skip('DUPLICATE');
    return { decision: 'SEND', reason: 'OK' };
}
//# sourceMappingURL=send-gate.js.map