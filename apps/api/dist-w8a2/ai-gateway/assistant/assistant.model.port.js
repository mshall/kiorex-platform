"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MODEL_STEP_JSON_SCHEMA = void 0;
exports.validateModelStep = validateModelStep;
const assistant_types_1 = require("./assistant.types");
exports.MODEL_STEP_JSON_SCHEMA = {
    oneOf: [
        { type: 'object', additionalProperties: false, required: ['kind', 'tool', 'args'], properties: { kind: { const: 'tool' }, tool: { enum: [...assistant_types_1.TOOL_NAMES] }, args: { type: 'object' } } },
        { type: 'object', additionalProperties: false, required: ['kind', 'intent'], properties: { kind: { const: 'reply_intent' }, intent: { enum: [...assistant_types_1.REPLY_INTENTS] }, slots: { type: 'object' } } },
        { type: 'object', additionalProperties: false, required: ['kind', 'slot'], properties: { kind: { const: 'clarify' }, slot: { enum: [...assistant_types_1.CLARIFY_SLOTS] } } },
        { type: 'object', additionalProperties: false, required: ['kind'], properties: { kind: { const: 'handoff' }, reason: { type: 'string', maxLength: 40 } } },
    ],
};
const prim = (v) => v === null || ['string', 'number', 'boolean'].includes(typeof v);
const flat = (o, maxKeys, maxStr) => !!o && typeof o === 'object' && !Array.isArray(o) && Object.keys(o).length <= maxKeys && Object.values(o).every((v) => prim(v) && (typeof v !== 'string' || v.length <= maxStr));
function validateModelStep(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
        return null;
    const o = raw;
    const keys = Object.keys(o);
    const only = (allowed) => keys.every((k) => allowed.includes(k));
    switch (o.kind) {
        case 'tool': return only(['kind', 'tool', 'args']) && typeof o.tool === 'string' && assistant_types_1.TOOL_NAMES.includes(o.tool) && flat(o.args ?? {}, 12, 200) ? { kind: 'tool', tool: o.tool, args: (o.args ?? {}) } : null;
        case 'reply_intent': return only(['kind', 'intent', 'slots']) && typeof o.intent === 'string' && assistant_types_1.REPLY_INTENTS.includes(o.intent) && (o.slots === undefined || flat(o.slots, 5, 40)) ? { kind: 'reply_intent', intent: o.intent, ...(o.slots ? { slots: o.slots } : {}) } : null;
        case 'clarify': return only(['kind', 'slot']) && typeof o.slot === 'string' && assistant_types_1.CLARIFY_SLOTS.includes(o.slot) ? { kind: 'clarify', slot: o.slot } : null;
        case 'handoff': return only(['kind', 'reason']) && (o.reason === undefined || (typeof o.reason === 'string' && o.reason.length <= 40)) ? { kind: 'handoff', ...(o.reason ? { reason: o.reason } : {}) } : null;
        default: return null;
    }
}
//# sourceMappingURL=assistant.model.port.js.map