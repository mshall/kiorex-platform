"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.allowedChannels = exports.defaultChannels = exports.templateClass = void 0;
exports.validateGraph = validateGraph;
const engagement_public_1 = require("../../engagement/engagement-public");
const health_terms_1 = require("./health-terms");
const lifecycle_segments_1 = require("../lifecycle/lifecycle-segments");
const journey_graph_1 = require("./journey.graph");
const ID = /^[a-z][a-z0-9_-]{0,31}$/;
const VARIANT = /^[a-z0-9_-]{1,32}$/;
const EXPERIMENT_KEY = /^[a-z0-9][a-z0-9-]{1,47}$/;
const NODE_KEYS = {
    TRIGGER: ['id', 'type', 'label', 'event'], WAIT: ['id', 'type', 'label', 'minutes'], CONDITION: ['id', 'type', 'label', 'segment'], SEND: ['id', 'type', 'label', 'template', 'channels'],
    BRANCH_EXPERIMENT: ['id', 'type', 'label', 'experiment'], END: ['id', 'type', 'label'],
};
function clinicalHit(v, path) {
    if (typeof v === 'string') {
        const m = (0, health_terms_1.healthWordIn)(v);
        return m ? { path, word: m } : null;
    }
    if (Array.isArray(v)) {
        for (const [i, x] of v.entries()) {
            const h = clinicalHit(x, `${path}/${i}`);
            if (h)
                return h;
        }
        return null;
    }
    if (v && typeof v === 'object') {
        for (const [k, x] of Object.entries(v)) {
            if ((0, lifecycle_segments_1.isClinicalSegmentKey)(k) || (0, health_terms_1.healthWordIn)(k))
                return { path: `${path}/${k}`, word: k };
            const h = clinicalHit(x, `${path}/${k}`);
            if (h)
                return h;
        }
    }
    return null;
}
const templateClass = (t) => (0, engagement_public_1.messageClassOf)(t);
exports.templateClass = templateClass;
const defaultChannels = (t) => ((0, exports.templateClass)(t) === 'MARKETING' ? ['PUSH', 'WHATSAPP', 'SMS', 'EMAIL'] : ['PUSH', 'INAPP']);
exports.defaultChannels = defaultChannels;
const allowedChannels = (t) => ((0, exports.templateClass)(t) === 'MARKETING' ? ['PUSH', 'WHATSAPP', 'SMS', 'EMAIL'] : journey_graph_1.CHANNELS);
exports.allowedChannels = allowedChannels;
function validateGraph(input) {
    const errors = [];
    const err = (code, path, message) => errors.push({ code, path, message });
    if (!input || typeof input !== 'object' || Array.isArray(input))
        return { valid: false, errors: [{ code: 'SCHEMA', path: '/', message: 'a journey graph is an object { schema, nodes, edges }' }] };
    const g = input;
    for (const k of Object.keys(g))
        if (!['schema', 'nodes', 'edges'].includes(k))
            err('UNKNOWN_FIELD', `/${k}`, `"${k}" is not a graph field (exit conditions, gates and caps are not editable)`);
    if (g.schema !== 1)
        err('SCHEMA', '/schema', 'schema must be 1');
    if (!Array.isArray(g.nodes) || !Array.isArray(g.edges)) {
        err('SCHEMA', '/', 'nodes and edges must be lists');
        return { valid: false, errors };
    }
    if (g.nodes.length > journey_graph_1.AUTOMATION_POLICY.maxNodes)
        err('TOO_MANY_NODES', '/nodes', `a journey has at most ${journey_graph_1.AUTOMATION_POLICY.maxNodes} nodes (got ${g.nodes.length})`);
    if (g.nodes.length === 0)
        err('NO_TRIGGER', '/nodes', 'a journey needs a TRIGGER node');
    if (g.edges.length > journey_graph_1.AUTOMATION_POLICY.maxNodes * 3)
        err('SCHEMA', '/edges', 'too many edges');
    const ids = new Set();
    g.nodes.forEach((raw, i) => {
        const p = `/nodes/${i}`;
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
            err('SCHEMA', p, 'a node is an object');
            return;
        }
        const n = raw;
        if (typeof n.id !== 'string' || !ID.test(n.id))
            err('SCHEMA', `${p}/id`, 'id must match [a-z][a-z0-9_-]{0,31}');
        else if (ids.has(n.id))
            err('DUPLICATE_ID', `${p}/id`, `duplicate node id "${n.id}"`);
        else
            ids.add(n.id);
        if (typeof n.type !== 'string' || !journey_graph_1.NODE_TYPES.includes(n.type)) {
            err('UNKNOWN_NODE_TYPE', `${p}/type`, `node type "${String(n.type)}" does not exist (allowed: ${journey_graph_1.NODE_TYPES.join(', ')}); the consent and gate node is inserted by the compiler and cannot be drawn`);
            return;
        }
        for (const k of Object.keys(n))
            if (!NODE_KEYS[n.type].includes(k))
                err('UNKNOWN_FIELD', `${p}/${k}`, `"${k}" is not a field of ${n.type}`);
        if (n.label !== undefined && (typeof n.label !== 'string' || n.label.length > 80))
            err('SCHEMA', `${p}/label`, 'label is text of at most 80 characters');
        switch (n.type) {
            case 'TRIGGER':
                if (typeof n.event !== 'string' || !journey_graph_1.TRIGGER_EVENTS.includes(n.event))
                    err('TRIGGER_EVENT_NOT_ALLOWED', `${p}/event`, `event must be one of ${journey_graph_1.TRIGGER_EVENTS.join(', ')}`);
                break;
            case 'WAIT':
                if (!Number.isInteger(n.minutes) || n.minutes < journey_graph_1.AUTOMATION_POLICY.minWaitMinutes || n.minutes > journey_graph_1.AUTOMATION_POLICY.maxWaitMinutes)
                    err('WAIT_RANGE', `${p}/minutes`, `a wait is a whole number of minutes between ${journey_graph_1.AUTOMATION_POLICY.minWaitMinutes} and ${journey_graph_1.AUTOMATION_POLICY.maxWaitMinutes} (90 days)`);
                break;
            case 'CONDITION': {
                const r = (0, lifecycle_segments_1.validateSegmentRule)(n.segment);
                if (!r.valid)
                    for (const m of r.errors)
                        err(/clinical/.test(m) ? 'CLINICAL_REFERENCE' : 'CONDITION_INVALID', `${p}/segment${m.split(':')[0]}`, m);
                else if (!Object.keys(r.value).length)
                    err('CONDITION_INVALID', `${p}/segment`, 'a condition must say something');
                break;
            }
            case 'SEND': {
                if (typeof n.template !== 'string' || !journey_graph_1.SEND_TEMPLATES.includes(n.template) || !(n.template in engagement_public_1.TEMPLATES)) {
                    err('TEMPLATE_NOT_ALLOWED', `${p}/template`, `template must be one of ${journey_graph_1.SEND_TEMPLATES.join(', ')} (status, security and booking templates cannot be used in a journey)`);
                    break;
                }
                if (n.channels !== undefined) {
                    const allowed = (0, exports.allowedChannels)(n.template);
                    if (!Array.isArray(n.channels) || n.channels.length === 0 || n.channels.length > 5 || !n.channels.every((c) => typeof c === 'string' && allowed.includes(c)) || new Set(n.channels).size !== n.channels.length)
                        err('CHANNEL_NOT_ALLOWED', `${p}/channels`, `channels must be a non-empty list without repeats from ${allowed.join(', ')}`);
                }
                break;
            }
            case 'BRANCH_EXPERIMENT':
                if (typeof n.experiment !== 'string' || !EXPERIMENT_KEY.test(n.experiment))
                    err('BRANCH_INVALID', `${p}/experiment`, 'experiment must be the key of an experiment on the win-back message surface');
                break;
            default: break;
        }
        const hit = clinicalHit(Object.fromEntries(Object.entries(n).filter(([k]) => k !== 'type' && k !== 'template' && k !== 'event')), p);
        if (hit)
            err('CLINICAL_REFERENCE', hit.path, `"${hit.word}" refers to clinical, provider or order data; a journey can only use non-clinical attributes`);
    });
    const nodes = g.nodes.filter((n) => n && typeof n === 'object');
    const triggers = nodes.filter((n) => n.type === 'TRIGGER');
    if (triggers.length === 0 && nodes.length)
        err('NO_TRIGGER', '/nodes', 'a journey needs exactly one TRIGGER node');
    if (triggers.length > 1)
        err('MULTIPLE_TRIGGERS', '/nodes', 'a journey has exactly one TRIGGER node');
    const hasLoop = (0, journey_graph_1.cycles)({ schema: 1, nodes: nodes, edges: g.edges.filter((e) => e && typeof e === 'object') }).length > 0;
    if (!hasLoop && !nodes.some((n) => n.type === 'END'))
        err('NO_END', '/nodes', 'a journey needs at least one END node (a loop is ended by the per-person send cap)');
    if (!nodes.some((n) => n.type === 'SEND'))
        err('NO_SEND', '/nodes', 'a journey needs at least one SEND node');
    g.edges.forEach((raw, i) => {
        const p = `/edges/${i}`;
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
            err('EDGE_INVALID', p, 'an edge is an object { from, to }');
            return;
        }
        const e = raw;
        for (const k of Object.keys(e))
            if (!['from', 'to', 'label'].includes(k))
                err('UNKNOWN_FIELD', `${p}/${k}`, `"${k}" is not an edge field`);
        if (typeof e.from !== 'string' || !ids.has(e.from))
            err('EDGE_INVALID', `${p}/from`, 'from must be the id of a node');
        if (typeof e.to !== 'string' || !ids.has(e.to))
            err('EDGE_INVALID', `${p}/to`, 'to must be the id of a node');
        if (e.label !== undefined && (typeof e.label !== 'string' || !VARIANT.test(e.label)))
            err('EDGE_INVALID', `${p}/label`, 'a label is a variant key [a-z0-9_-]{1,32}');
    });
    if (errors.length)
        return { valid: false, errors };
    const graph = g;
    const byId = (0, journey_graph_1.nodeById)(graph);
    const trigger = triggers[0].id;
    for (const n of graph.nodes) {
        const out = (0, journey_graph_1.outgoing)(graph, n.id);
        const inc = graph.edges.filter((e) => e.to === n.id);
        const at = `/nodes/${graph.nodes.indexOf(n)}`;
        if (n.type === 'TRIGGER' && inc.length)
            err('EDGE_INVALID', at, 'nothing may lead into the TRIGGER');
        if (n.type === 'END') {
            if (out.length)
                err('EDGE_INVALID', at, 'an END node has no outgoing edge');
            continue;
        }
        if (n.type === 'BRANCH_EXPERIMENT') {
            const labels = out.map((e) => e.label);
            if (out.length < 2 || out.length > journey_graph_1.AUTOMATION_POLICY.maxBranchArms)
                err('BRANCH_INVALID', at, `a branch has 2 to ${journey_graph_1.AUTOMATION_POLICY.maxBranchArms} arms`);
            else if (labels.some((l) => !l) || new Set(labels).size !== labels.length || !labels.includes('control'))
                err('BRANCH_INVALID', at, 'every arm is labelled with a distinct variant key and one arm is "control"');
            continue;
        }
        if (out.length === 0)
            err('DEAD_END', at, `"${n.id}" leads nowhere: every path must reach an END node`);
        else if (out.length > 1)
            err('EDGE_INVALID', at, `"${n.id}" has ${out.length} outgoing edges; only a branch splits a path`);
        else if (out[0].label !== undefined)
            err('EDGE_INVALID', at, 'only branch arms carry a label');
    }
    const seen = (0, journey_graph_1.reachable)(graph, trigger);
    const looped = (0, journey_graph_1.cycles)(graph).length > 0;
    for (const n of graph.nodes)
        if (!seen.has(n.id) && !(looped && n.type === 'END'))
            err('UNREACHABLE', `/nodes/${graph.nodes.indexOf(n)}`, `"${n.id}" cannot be reached from the TRIGGER`);
    if (errors.length)
        return { valid: false, errors };
    for (const c of (0, journey_graph_1.cycles)(graph)) {
        const longWait = c.some((id) => { const n = byId.get(id); return n.type === 'WAIT' && n.minutes >= journey_graph_1.AUTOMATION_POLICY.cycleMinWaitMinutes; });
        if (!longWait)
            err('CYCLE_WITHOUT_DAILY_WAIT', '/edges', `the loop ${c.join(' > ')} has no WAIT of at least one day`);
    }
    const maxSends = (id, path) => {
        if (path.includes(id))
            return 0;
        const n = byId.get(id);
        const here = n.type === 'SEND' ? 1 : 0;
        const outs = (0, journey_graph_1.outgoing)(graph, id);
        return here + (outs.length ? Math.max(...outs.map((e) => maxSends(e.to, [...path, id]))) : 0);
    };
    const sends = maxSends(trigger, []);
    if (sends > journey_graph_1.AUTOMATION_POLICY.maxSendsPerJourney)
        err('SEND_CAP', '/nodes', `a path may send at most ${journey_graph_1.AUTOMATION_POLICY.maxSendsPerJourney} messages per person per journey (this one sends ${sends})`);
    return errors.length ? { valid: false, errors } : { valid: true, graph, errors: [] };
}
//# sourceMappingURL=journey.validator.js.map