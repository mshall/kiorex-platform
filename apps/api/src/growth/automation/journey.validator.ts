import { messageClassOf, TEMPLATES, type MessageClass } from '../../engagement/engagement-public';
import { healthWordIn } from './health-terms';
import { isClinicalSegmentKey, validateSegmentRule } from '../lifecycle/lifecycle-segments';
import {
  AUTOMATION_POLICY as P, CHANNELS, NODE_TYPES, SEND_TEMPLATES, TRIGGER_EVENTS, cycles, nodeById, outgoing, reachable,
  type AutomationChannel, type JourneyGraph, type SendTemplate,
} from './journey.graph';

export type ValidationCode =
  | 'SCHEMA' | 'UNKNOWN_FIELD' | 'UNKNOWN_NODE_TYPE' | 'TOO_MANY_NODES' | 'DUPLICATE_ID' | 'NO_TRIGGER' | 'MULTIPLE_TRIGGERS' | 'TRIGGER_EVENT_NOT_ALLOWED' | 'WAIT_RANGE'
  | 'CONDITION_INVALID' | 'CLINICAL_REFERENCE' | 'TEMPLATE_NOT_ALLOWED' | 'CHANNEL_NOT_ALLOWED' | 'EDGE_INVALID' | 'BRANCH_INVALID' | 'UNREACHABLE' | 'NO_END' | 'DEAD_END'
  | 'CYCLE_WITHOUT_DAILY_WAIT' | 'SEND_CAP' | 'NO_SEND';
export interface ValidationError { code: ValidationCode; path: string; message: string }
export type ValidationResult = { valid: true; graph: JourneyGraph; errors: [] } | { valid: false; errors: ValidationError[] };

const ID = /^[a-z][a-z0-9_-]{0,31}$/;
const VARIANT = /^[a-z0-9_-]{1,32}$/;
const EXPERIMENT_KEY = /^[a-z0-9][a-z0-9-]{1,47}$/;

const NODE_KEYS: Record<string, readonly string[]> = {
  TRIGGER: ['id', 'type', 'label', 'event'], WAIT: ['id', 'type', 'label', 'minutes'], CONDITION: ['id', 'type', 'label', 'segment'], SEND: ['id', 'type', 'label', 'template', 'channels'],
  BRANCH_EXPERIMENT: ['id', 'type', 'label', 'experiment'], END: ['id', 'type', 'label'],
};

/** Walk every key and string of a value; report the first clinical hint with its path. */
function clinicalHit(v: unknown, path: string): { path: string; word: string } | null {
  if (typeof v === 'string') { const m = healthWordIn(v); return m ? { path, word: m } : null; }
  if (Array.isArray(v)) { for (const [i, x] of v.entries()) { const h = clinicalHit(x, `${path}/${i}`); if (h) return h; } return null; }
  if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (isClinicalSegmentKey(k) || healthWordIn(k)) return { path: `${path}/${k}`, word: k };
      const h = clinicalHit(x, `${path}/${k}`); if (h) return h;
    }
  }
  return null;
}

export const templateClass = (t: string): MessageClass => messageClassOf(t);
export const defaultChannels = (t: SendTemplate): AutomationChannel[] => (templateClass(t) === 'MARKETING' ? ['PUSH', 'WHATSAPP', 'SMS', 'EMAIL'] : ['PUSH', 'INAPP']);
export const allowedChannels = (t: SendTemplate): readonly AutomationChannel[] => (templateClass(t) === 'MARKETING' ? ['PUSH', 'WHATSAPP', 'SMS', 'EMAIL'] : CHANNELS);

/**
 * The journey validator (GRW-P3-E). Fails CLOSED: an unknown field, node type, event, template, channel or attribute is an error, never ignored. It checks shape, then each node, then the
 * wiring (edges, reachability, dead ends, cycles), then the per-person send cap. Returns every error it finds (the builder shows them all), each with a stable code and a JSON pointer.
 * PURE except for the read-only template catalogue.
 */
export function validateGraph(input: unknown): ValidationResult {
  const errors: ValidationError[] = [];
  const err = (code: ValidationCode, path: string, message: string) => errors.push({ code, path, message });
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { valid: false, errors: [{ code: 'SCHEMA', path: '/', message: 'a journey graph is an object { schema, nodes, edges }' }] };
  const g = input as Record<string, unknown>;
  for (const k of Object.keys(g)) if (!['schema', 'nodes', 'edges'].includes(k)) err('UNKNOWN_FIELD', `/${k}`, `"${k}" is not a graph field (exit conditions, gates and caps are not editable)`);
  if (g.schema !== 1) err('SCHEMA', '/schema', 'schema must be 1');
  if (!Array.isArray(g.nodes) || !Array.isArray(g.edges)) { err('SCHEMA', '/', 'nodes and edges must be lists'); return { valid: false, errors }; }
  if (g.nodes.length > P.maxNodes) err('TOO_MANY_NODES', '/nodes', `a journey has at most ${P.maxNodes} nodes (got ${g.nodes.length})`);
  if (g.nodes.length === 0) err('NO_TRIGGER', '/nodes', 'a journey needs a TRIGGER node');
  if (g.edges.length > P.maxNodes * 3) err('SCHEMA', '/edges', 'too many edges');

  const ids = new Set<string>();
  g.nodes.forEach((raw, i) => {
    const p = `/nodes/${i}`;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { err('SCHEMA', p, 'a node is an object'); return; }
    const n = raw as Record<string, unknown>;
    if (typeof n.id !== 'string' || !ID.test(n.id)) err('SCHEMA', `${p}/id`, 'id must match [a-z][a-z0-9_-]{0,31}');
    else if (ids.has(n.id)) err('DUPLICATE_ID', `${p}/id`, `duplicate node id "${n.id}"`); else ids.add(n.id);
    if (typeof n.type !== 'string' || !(NODE_TYPES as readonly string[]).includes(n.type)) { err('UNKNOWN_NODE_TYPE', `${p}/type`, `node type "${String(n.type)}" does not exist (allowed: ${NODE_TYPES.join(', ')}); the consent and gate node is inserted by the compiler and cannot be drawn`); return; }
    for (const k of Object.keys(n)) if (!NODE_KEYS[n.type as string]!.includes(k)) err('UNKNOWN_FIELD', `${p}/${k}`, `"${k}" is not a field of ${n.type}`);
    if (n.label !== undefined && (typeof n.label !== 'string' || n.label.length > 80)) err('SCHEMA', `${p}/label`, 'label is text of at most 80 characters');
    switch (n.type) {
      case 'TRIGGER':
        if (typeof n.event !== 'string' || !(TRIGGER_EVENTS as readonly string[]).includes(n.event)) err('TRIGGER_EVENT_NOT_ALLOWED', `${p}/event`, `event must be one of ${TRIGGER_EVENTS.join(', ')}`);
        break;
      case 'WAIT':
        if (!Number.isInteger(n.minutes) || (n.minutes as number) < P.minWaitMinutes || (n.minutes as number) > P.maxWaitMinutes) err('WAIT_RANGE', `${p}/minutes`, `a wait is a whole number of minutes between ${P.minWaitMinutes} and ${P.maxWaitMinutes} (90 days)`);
        break;
      case 'CONDITION': {
        const r = validateSegmentRule(n.segment);
        if (!r.valid) for (const m of r.errors) err(/clinical/.test(m) ? 'CLINICAL_REFERENCE' : 'CONDITION_INVALID', `${p}/segment${m.split(':')[0]}`, m);
        else if (!Object.keys(r.value).length) err('CONDITION_INVALID', `${p}/segment`, 'a condition must say something');
        break;
      }
      case 'SEND': {
        if (typeof n.template !== 'string' || !(SEND_TEMPLATES as readonly string[]).includes(n.template) || !(n.template in TEMPLATES)) { err('TEMPLATE_NOT_ALLOWED', `${p}/template`, `template must be one of ${SEND_TEMPLATES.join(', ')} (status, security and booking templates cannot be used in a journey)`); break; }
        if (n.channels !== undefined) {
          const allowed = allowedChannels(n.template as SendTemplate);
          if (!Array.isArray(n.channels) || n.channels.length === 0 || n.channels.length > 5 || !n.channels.every((c) => typeof c === 'string' && (allowed as readonly string[]).includes(c)) || new Set(n.channels).size !== n.channels.length) err('CHANNEL_NOT_ALLOWED', `${p}/channels`, `channels must be a non-empty list without repeats from ${allowed.join(', ')}`);
        }
        break;
      }
      case 'BRANCH_EXPERIMENT':
        if (typeof n.experiment !== 'string' || !EXPERIMENT_KEY.test(n.experiment)) err('BRANCH_INVALID', `${p}/experiment`, 'experiment must be the key of an experiment on the win-back message surface');
        break;
      default: break;
    }
    const hit = clinicalHit(Object.fromEntries(Object.entries(n).filter(([k]) => k !== 'type' && k !== 'template' && k !== 'event')), p);
    if (hit) err('CLINICAL_REFERENCE', hit.path, `"${hit.word}" refers to clinical, provider or order data; a journey can only use non-clinical attributes`);
  });

  const nodes = (g.nodes as Array<Record<string, unknown>>).filter((n) => n && typeof n === 'object');
  const triggers = nodes.filter((n) => n.type === 'TRIGGER');
  if (triggers.length === 0 && nodes.length) err('NO_TRIGGER', '/nodes', 'a journey needs exactly one TRIGGER node');
  if (triggers.length > 1) err('MULTIPLE_TRIGGERS', '/nodes', 'a journey has exactly one TRIGGER node');
  const hasLoop = cycles({ schema: 1, nodes: nodes as never, edges: (g.edges as never[]).filter((e) => e && typeof e === 'object') }).length > 0;
  if (!hasLoop && !nodes.some((n) => n.type === 'END')) err('NO_END', '/nodes', 'a journey needs at least one END node (a loop is ended by the per-person send cap)');
  if (!nodes.some((n) => n.type === 'SEND')) err('NO_SEND', '/nodes', 'a journey needs at least one SEND node');

  g.edges.forEach((raw, i) => {
    const p = `/edges/${i}`;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { err('EDGE_INVALID', p, 'an edge is an object { from, to }'); return; }
    const e = raw as Record<string, unknown>;
    for (const k of Object.keys(e)) if (!['from', 'to', 'label'].includes(k)) err('UNKNOWN_FIELD', `${p}/${k}`, `"${k}" is not an edge field`);
    if (typeof e.from !== 'string' || !ids.has(e.from)) err('EDGE_INVALID', `${p}/from`, 'from must be the id of a node');
    if (typeof e.to !== 'string' || !ids.has(e.to)) err('EDGE_INVALID', `${p}/to`, 'to must be the id of a node');
    if (e.label !== undefined && (typeof e.label !== 'string' || !VARIANT.test(e.label))) err('EDGE_INVALID', `${p}/label`, 'a label is a variant key [a-z0-9_-]{1,32}');
  });
  if (errors.length) return { valid: false, errors };

  // wiring: from here every node and edge is well-formed
  const graph = g as unknown as JourneyGraph;
  const byId = nodeById(graph);
  const trigger = triggers[0]!.id as string;
  for (const n of graph.nodes) {
    const out = outgoing(graph, n.id); const inc = graph.edges.filter((e) => e.to === n.id);
    const at = `/nodes/${graph.nodes.indexOf(n)}`;
    if (n.type === 'TRIGGER' && inc.length) err('EDGE_INVALID', at, 'nothing may lead into the TRIGGER');
    if (n.type === 'END') { if (out.length) err('EDGE_INVALID', at, 'an END node has no outgoing edge'); continue; }
    if (n.type === 'BRANCH_EXPERIMENT') {
      const labels = out.map((e) => e.label);
      if (out.length < 2 || out.length > P.maxBranchArms) err('BRANCH_INVALID', at, `a branch has 2 to ${P.maxBranchArms} arms`);
      else if (labels.some((l) => !l) || new Set(labels).size !== labels.length || !labels.includes('control')) err('BRANCH_INVALID', at, 'every arm is labelled with a distinct variant key and one arm is "control"');
      continue;
    }
    if (out.length === 0) err('DEAD_END', at, `"${n.id}" leads nowhere: every path must reach an END node`);
    else if (out.length > 1) err('EDGE_INVALID', at, `"${n.id}" has ${out.length} outgoing edges; only a branch splits a path`);
    else if (out[0]!.label !== undefined) err('EDGE_INVALID', at, 'only branch arms carry a label');
  }
  const seen = reachable(graph, trigger);
  const looped = cycles(graph).length > 0; // in a loop the send cap and the exit conditions end the journey, so an END node may sit off the path
  for (const n of graph.nodes) if (!seen.has(n.id) && !(looped && n.type === 'END')) err('UNREACHABLE', `/nodes/${graph.nodes.indexOf(n)}`, `"${n.id}" cannot be reached from the TRIGGER`);
  if (errors.length) return { valid: false, errors };

  // cycles need a wait of at least one day inside the cycle
  for (const c of cycles(graph)) {
    const longWait = c.some((id) => { const n = byId.get(id)!; return n.type === 'WAIT' && n.minutes >= P.cycleMinWaitMinutes; });
    if (!longWait) err('CYCLE_WITHOUT_DAILY_WAIT', '/edges', `the loop ${c.join(' > ')} has no WAIT of at least one day`);
  }
  // a path may send at most maxSendsPerJourney distinct SEND nodes (loops are cut by the same cap in the compiler)
  const maxSends = (id: string, path: string[]): number => {
    if (path.includes(id)) return 0;
    const n = byId.get(id)!; const here = n.type === 'SEND' ? 1 : 0;
    const outs = outgoing(graph, id);
    return here + (outs.length ? Math.max(...outs.map((e) => maxSends(e.to, [...path, id]))) : 0);
  };
  const sends = maxSends(trigger, []);
  if (sends > P.maxSendsPerJourney) err('SEND_CAP', '/nodes', `a path may send at most ${P.maxSendsPerJourney} messages per person per journey (this one sends ${sends})`);
  return errors.length ? { valid: false, errors } : { valid: true, graph, errors: [] };
}
