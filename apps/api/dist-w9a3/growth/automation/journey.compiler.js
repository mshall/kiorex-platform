"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.COMPILED_STOP_KEYS = exports.mandatoryStops = exports.GATE_CHECKS_OTHER = exports.MARKETING_GATE_CHECKS = void 0;
exports.compileGraph = compileGraph;
const engagement_public_1 = require("../../engagement/engagement-public");
const journey_graph_1 = require("./journey.graph");
const journey_validator_1 = require("./journey.validator");
exports.MARKETING_GATE_CHECKS = ['MARKETING_FLAG', 'HOLDOUT', 'CHANNEL_CONSENT', 'CHANNEL_OPT_OUT', 'SUPPRESSION', 'QUIET_HOURS', 'FREQUENCY_CAP', 'WHATSAPP_TEMPLATE', 'PHI_GUARD', 'DEDUPE'];
exports.GATE_CHECKS_OTHER = ['CONSENT', 'CHANNEL_OPT_OUT', 'QUIET_HOURS', 'PHI_GUARD', 'DEDUPE'];
const mandatoryStops = (marketing, trigger) => {
    const s = ['bookedAfterAnchor', 'accountDeleted'];
    if (marketing)
        s.push('MARKETING_CONSENT_LOST');
    if (trigger === 'STAGE_DORMANT')
        s.push('leftDormant');
    return s;
};
exports.mandatoryStops = mandatoryStops;
function walk(c, id, st) {
    if (st.depth > 80) {
        c.truncated.v = true;
        return;
    }
    const node = (0, journey_graph_1.nodeById)(c.graph).get(id);
    const next = (ns = {}) => { for (const e of (0, journey_graph_1.outgoing)(c.graph, id))
        walk(c, e.to, { ...st, ...ns, depth: st.depth + 1 }); };
    switch (node.type) {
        case 'TRIGGER': return next();
        case 'END': return;
        case 'WAIT': return next({ delay: st.delay + node.minutes });
        case 'CONDITION': return next({ segments: [...st.segments, node.segment] });
        case 'BRANCH_EXPERIMENT':
            for (const e of (0, journey_graph_1.outgoing)(c.graph, id))
                walk(c, e.to, { ...st, branch: [...st.branch, { experiment: node.experiment, variant: e.label }], depth: st.depth + 1 });
            return;
        case 'SEND': {
            if (st.sends >= journey_graph_1.AUTOMATION_POLICY.maxSendsPerJourney || c.steps.length >= journey_graph_1.AUTOMATION_POLICY.maxCompiledSteps) {
                c.truncated.v = true;
                return;
            }
            const n = node;
            const t = engagement_public_1.TEMPLATES[n.template];
            const cls = (0, journey_validator_1.templateClass)(n.template);
            const marketing = cls === 'MARKETING';
            const channels = (n.channels ?? (0, journey_validator_1.defaultChannels)(n.template));
            const step = {
                step: ++c.counter.n, delayMinutes: st.delay, messageClass: cls, channels, kind: n.template,
                purpose: marketing ? 'MARKETING' : t.reminder ? 'REMINDER' : 'TRANSACTIONAL', stopOn: (0, exports.mandatoryStops)(marketing, c.trigger),
                ...(st.segments.length ? { segments: st.segments } : {}), ...(st.branch.length ? { branch: st.branch } : {}),
                ...(marketing ? { gate: { inserted: true, checks: exports.MARKETING_GATE_CHECKS } } : {}),
            };
            c.steps.push(step);
            c.info.push({ step: step.step, nodeId: n.id, template: n.template, messageClass: cls, delayMinutes: st.delay, channels, branch: [...st.branch], conditions: st.segments.length, gateInserted: marketing });
            return next({ delay: 0, segments: [], sends: st.sends + 1 });
        }
    }
}
function compileGraph(graph, meta) {
    const trigger = graph.nodes.find((n) => n.type === 'TRIGGER');
    const event = trigger.type === 'TRIGGER' ? trigger.event : 'REGISTERED';
    const ctx = { graph, trigger: event, steps: [], info: [], counter: { n: 0 }, truncated: { v: false } };
    walk(ctx, trigger.id, { delay: 0, segments: [], branch: [], sends: 0, depth: 0 });
    const checksum = (0, journey_graph_1.checksumOf)(graph);
    const def = {
        key: `auto.${meta.market.toLowerCase()}.${meta.key}`, version: meta.version, trigger: 'AUTOMATION', anchored: true, steps: ctx.steps, params: { maxSends: journey_graph_1.AUTOMATION_POLICY.maxSendsPerJourney, maxPer30Days: journey_graph_1.AUTOMATION_POLICY.maxSendsPer30Days },
        describe: { en: meta.name || `Journey ${meta.key}`, ar: meta.name || `رحلة ${meta.key}` },
        custom: { definitionId: meta.definitionId, market: meta.market, definitionKey: meta.key, checksum, trigger: event, maxSends: journey_graph_1.AUTOMATION_POLICY.maxSendsPerJourney },
    };
    const gateNodes = ctx.info.filter((i) => i.gateInserted).map((i) => ({ beforeStep: i.step, checks: exports.MARKETING_GATE_CHECKS }));
    return { def, checksum, steps: ctx.info, gateNodes, truncated: ctx.truncated.v, trigger: event };
}
exports.COMPILED_STOP_KEYS = ['bookedAfterAnchor', 'accountDeleted', 'MARKETING_CONSENT_LOST', 'leftDormant'];
//# sourceMappingURL=journey.compiler.js.map