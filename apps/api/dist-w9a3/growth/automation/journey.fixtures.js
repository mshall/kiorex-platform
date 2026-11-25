"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.clone = exports.FEEDBACK_FOLLOWUP = exports.BRANCHED = exports.REENGAGE_TWO_STEP = void 0;
exports.REENGAGE_TWO_STEP = {
    schema: 1,
    nodes: [
        { id: 'start', type: 'TRIGGER', event: 'STAGE_DORMANT' },
        { id: 'send1', type: 'SEND', template: 'REENGAGE_DORMANT', channels: ['PUSH', 'WHATSAPP'] },
        { id: 'wait1', type: 'WAIT', minutes: 7 * 24 * 60 },
        { id: 'only-ar', type: 'CONDITION', segment: { language: ['ar'] } },
        { id: 'send2', type: 'SEND', template: 'REENGAGE_DORMANT' },
        { id: 'done', type: 'END' },
    ],
    edges: [{ from: 'start', to: 'send1' }, { from: 'send1', to: 'wait1' }, { from: 'wait1', to: 'only-ar' }, { from: 'only-ar', to: 'send2' }, { from: 'send2', to: 'done' }],
};
exports.BRANCHED = {
    schema: 1,
    nodes: [
        { id: 'start', type: 'TRIGGER', event: 'STAGE_DORMANT' },
        { id: 'split', type: 'BRANCH_EXPERIMENT', experiment: 'winback-subject-test' },
        { id: 'a', type: 'SEND', template: 'REENGAGE_DORMANT' },
        { id: 'b', type: 'SEND', template: 'REFERRAL_NUDGE' },
        { id: 'end', type: 'END' },
    ],
    edges: [{ from: 'start', to: 'split' }, { from: 'split', to: 'a', label: 'control' }, { from: 'split', to: 'b', label: 'short' }, { from: 'a', to: 'end' }, { from: 'b', to: 'end' }],
};
exports.FEEDBACK_FOLLOWUP = {
    schema: 1,
    nodes: [
        { id: 'start', type: 'TRIGGER', event: 'VISIT_COMPLETED' },
        { id: 'w', type: 'WAIT', minutes: 3 * 24 * 60 },
        { id: 's', type: 'SEND', template: 'FEEDBACK_REMINDER', channels: ['PUSH', 'INAPP'] },
        { id: 'e', type: 'END' },
    ],
    edges: [{ from: 'start', to: 'w' }, { from: 'w', to: 's' }, { from: 's', to: 'e' }],
};
const clone = (x) => JSON.parse(JSON.stringify(x));
exports.clone = clone;
//# sourceMappingURL=journey.fixtures.js.map