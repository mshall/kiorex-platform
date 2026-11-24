"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.COUNTS_AGAINST_CEILING = exports.ACCEPTS_SPEND = exports.isTerminal = exports.nextStates = exports.allPairs = exports.isStatus = exports.CAMPAIGN_STATUSES = void 0;
exports.evaluateTransition = evaluateTransition;
const contracts_1 = require("@kiorex/contracts");
exports.CAMPAIGN_STATUSES = contracts_1.CAMPAIGN_STATES;
const isStatus = (v) => contracts_1.CAMPAIGN_STATES.includes(v);
exports.isStatus = isStatus;
const deny = (code, message) => ({ ok: false, code, message });
function evaluateTransition(from, to, c) {
    if (!(0, contracts_1.canTransitionCampaign)(from, to))
        return deny('CAMPAIGN_INVALID_TRANSITION', `A ${from} campaign cannot become ${to}`);
    switch (`${from}>${to}`) {
        case 'DRAFT>PENDING_APPROVAL':
            if (!c.startsAt || !c.endsAt)
                return deny('CAMPAIGN_INVALID', 'Set the start and end dates before asking for approval');
            return { ok: true };
        case 'DRAFT>SCHEDULED':
            if (!c.startsAt || !c.endsAt)
                return deny('CAMPAIGN_INVALID', 'Set the start and end dates before scheduling');
            if (c.approvalRequired)
                return deny('CAMPAIGN_APPROVAL_REQUIRED', 'This campaign needs a second approver: request approval first');
            return { ok: true };
        case 'PENDING_APPROVAL>SCHEDULED':
            return c.approvalCurrent ? { ok: true } : deny('CAMPAIGN_APPROVAL_REQUIRED', 'No current approval covers this campaign as it is now');
        case 'PENDING_APPROVAL>DRAFT':
        case 'SCHEDULED>DRAFT':
            return c.hasReason ? { ok: true } : deny('CAMPAIGN_INVALID', 'A reason is required');
        case 'SCHEDULED>ACTIVE':
            if (!c.startsAt || c.now.getTime() < c.startsAt.getTime())
                return deny('CAMPAIGN_INVALID_TRANSITION', 'The campaign has not reached its start time');
            if (c.endsAt && c.now.getTime() >= c.endsAt.getTime())
                return deny('CAMPAIGN_INVALID_TRANSITION', 'The campaign window already ended');
            if (c.approvalRequired && !c.approvalCurrent)
                return deny('CAMPAIGN_APPROVAL_REQUIRED', 'The approval no longer covers the campaign (it was edited after approval)');
            return { ok: true };
        case 'ACTIVE>PAUSED':
            return c.actorKind === 'USER' && c.requireReasonOnPause && !c.hasReason ? deny('CAMPAIGN_INVALID', 'A reason is required to pause a campaign') : { ok: true };
        case 'PAUSED>ACTIVE':
            if (c.budgetExhausted || c.pauseReason === 'BUDGET')
                return deny('CAMPAIGN_BUDGET_EXHAUSTED', 'The budget is used up: a budget increase approved by a second person is needed');
            if (c.dailyPauseActive)
                return deny('CAMPAIGN_INVALID_TRANSITION', 'The daily cap pause holds until the next market day');
            if (c.endsAt && c.now.getTime() >= c.endsAt.getTime())
                return deny('CAMPAIGN_INVALID_TRANSITION', 'The campaign window already ended');
            if (c.approvalRequired && !c.approvalCurrent)
                return deny('CAMPAIGN_APPROVAL_REQUIRED', 'A reactivation approval is needed: the campaign changed after it was approved');
            return { ok: true };
        default:
            return { ok: true };
    }
}
const allPairs = () => contracts_1.CAMPAIGN_STATES.flatMap((a) => contracts_1.CAMPAIGN_STATES.map((b) => [a, b]));
exports.allPairs = allPairs;
const nextStates = (from) => contracts_1.CAMPAIGN_TRANSITIONS[from];
exports.nextStates = nextStates;
const isTerminal = (s) => contracts_1.CAMPAIGN_TRANSITIONS[s].length === 0;
exports.isTerminal = isTerminal;
exports.ACCEPTS_SPEND = ['ACTIVE', 'PAUSED', 'COMPLETED', 'SCHEDULED'];
exports.COUNTS_AGAINST_CEILING = ['ACTIVE', 'SCHEDULED'];
//# sourceMappingURL=campaign.state.js.map