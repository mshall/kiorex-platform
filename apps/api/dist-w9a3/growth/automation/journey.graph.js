"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.outgoing = exports.nodeById = exports.checksumOf = exports.AUTOMATION_POLICY = exports.BRANCH_SURFACE = exports.SEND_TEMPLATES = exports.CHANNELS = exports.TRIGGER_EVENTS = exports.NODE_TYPES = void 0;
exports.canonical = canonical;
exports.reachable = reachable;
exports.cycles = cycles;
const node_crypto_1 = require("node:crypto");
exports.NODE_TYPES = ['TRIGGER', 'WAIT', 'CONDITION', 'SEND', 'BRANCH_EXPERIMENT', 'END'];
exports.TRIGGER_EVENTS = ['REGISTERED', 'BOOKING_STARTED', 'BOOKING_EXPIRED', 'VISIT_COMPLETED', 'REFERRAL_QUALIFIED', 'REWARD_EVENT', 'CONSENT_CHANGED', 'STAGE_DORMANT'];
exports.CHANNELS = ['PUSH', 'WHATSAPP', 'SMS', 'EMAIL', 'INAPP'];
exports.SEND_TEMPLATES = ['WELCOME', 'BOOKING_RECOVERY', 'FEEDBACK_REMINDER', 'REENGAGE_DORMANT', 'REFERRAL_NUDGE', 'REFERRAL_INVITE_CARD', 'FAMILY_ONBOARDING', 'FAMILY_ONBOARDING_CARD'];
exports.BRANCH_SURFACE = 'lifecycle.winback.subject_line';
exports.AUTOMATION_POLICY = {
    maxNodes: 12,
    minWaitMinutes: 15,
    maxWaitMinutes: 90 * 24 * 60,
    cycleMinWaitMinutes: 24 * 60,
    maxSendsPerJourney: 3,
    maxSendsPer30Days: 4,
    maxCompiledSteps: 24,
    maxBranchArms: 3,
};
function canonical(v) {
    if (v === null || typeof v !== 'object')
        return JSON.stringify(v);
    if (Array.isArray(v))
        return `[${v.map(canonical).join(',')}]`;
    const o = v;
    return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`;
}
const checksumOf = (g) => (0, node_crypto_1.createHash)('sha256').update(canonical(g), 'utf8').digest('hex');
exports.checksumOf = checksumOf;
const nodeById = (g) => new Map(g.nodes.map((n) => [n.id, n]));
exports.nodeById = nodeById;
const outgoing = (g, id) => g.edges.filter((e) => e.from === id);
exports.outgoing = outgoing;
function reachable(g, start) {
    const seen = new Set();
    const stack = [start];
    while (stack.length) {
        const id = stack.pop();
        if (seen.has(id))
            continue;
        seen.add(id);
        for (const e of (0, exports.outgoing)(g, id))
            stack.push(e.to);
    }
    return seen;
}
function cycles(g) {
    const found = [];
    const keys = new Set();
    const dfs = (start, id, path) => {
        for (const e of (0, exports.outgoing)(g, id)) {
            if (e.to === start) {
                const cyc = [...path];
                const k = [...cyc].sort().join('|');
                if (!keys.has(k)) {
                    keys.add(k);
                    found.push(cyc);
                }
                continue;
            }
            if (path.includes(e.to))
                continue;
            dfs(start, e.to, [...path, e.to]);
        }
    };
    for (const n of g.nodes)
        dfs(n.id, n.id, [n.id]);
    return found;
}
//# sourceMappingURL=journey.graph.js.map