import { CLARIFY_SLOTS, REPLY_INTENTS, TOOL_NAMES, type ModelStep } from './assistant.types';

export type { AssistantModel, ModelInput, ModelStep } from './assistant.types';

/** JSON Schema of a `ModelStep` (for JSON-schema constrained output of a real model, and for documentation). */
export const MODEL_STEP_JSON_SCHEMA = {
  oneOf: [
    { type: 'object', additionalProperties: false, required: ['kind', 'tool', 'args'], properties: { kind: { const: 'tool' }, tool: { enum: [...TOOL_NAMES] }, args: { type: 'object' } } },
    { type: 'object', additionalProperties: false, required: ['kind', 'intent'], properties: { kind: { const: 'reply_intent' }, intent: { enum: [...REPLY_INTENTS] }, slots: { type: 'object' } } },
    { type: 'object', additionalProperties: false, required: ['kind', 'slot'], properties: { kind: { const: 'clarify' }, slot: { enum: [...CLARIFY_SLOTS] } } },
    { type: 'object', additionalProperties: false, required: ['kind'], properties: { kind: { const: 'handoff' }, reason: { type: 'string', maxLength: 40 } } },
  ],
} as const;

const prim = (v: unknown) => v === null || ['string', 'number', 'boolean'].includes(typeof v);
const flat = (o: unknown, maxKeys: number, maxStr: number) => !!o && typeof o === 'object' && !Array.isArray(o) && Object.keys(o as object).length <= maxKeys && Object.values(o as object).every((v) => prim(v) && (typeof v !== 'string' || v.length <= maxStr));

/**
 * Validates a model answer. Anything that is not exactly a `ModelStep` (extra keys, free text, nested objects, over-long strings, an unknown tool or intent) is rejected: the orchestrator turns a
 * rejection into one `clarify` and, on the second in a row, into the deterministic path. The model can never put text in front of the patient.
 */
export function validateModelStep(raw: unknown): ModelStep | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const keys = Object.keys(o);
  const only = (allowed: string[]) => keys.every((k) => allowed.includes(k));
  switch (o.kind) {
    case 'tool': return only(['kind', 'tool', 'args']) && typeof o.tool === 'string' && (TOOL_NAMES as readonly string[]).includes(o.tool) && flat(o.args ?? {}, 12, 200) ? { kind: 'tool', tool: o.tool as ModelStep & never, args: (o.args ?? {}) as Record<string, unknown> } as ModelStep : null;
    case 'reply_intent': return only(['kind', 'intent', 'slots']) && typeof o.intent === 'string' && (REPLY_INTENTS as readonly string[]).includes(o.intent) && (o.slots === undefined || flat(o.slots, 5, 40)) ? { kind: 'reply_intent', intent: o.intent as never, ...(o.slots ? { slots: o.slots as Record<string, string | number | boolean> } : {}) } : null;
    case 'clarify': return only(['kind', 'slot']) && typeof o.slot === 'string' && (CLARIFY_SLOTS as readonly string[]).includes(o.slot) ? { kind: 'clarify', slot: o.slot as never } : null;
    case 'handoff': return only(['kind', 'reason']) && (o.reason === undefined || (typeof o.reason === 'string' && o.reason.length <= 40)) ? { kind: 'handoff', ...(o.reason ? { reason: o.reason as string } : {}) } : null;
    default: return null;
  }
}
