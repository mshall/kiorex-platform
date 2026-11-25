import { createHash } from 'node:crypto';
import { AUTOMATION_POLICY_DEFAULTS } from '../policy/policy-defaults';
import { livePolicy } from '../policy/policy-registry';
import type { SegmentRule } from '../lifecycle/lifecycle-segments';

/**
 * The journey graph (GRW-P3-E). A CLOSED data structure: six node types, no free scripting, no expressions. The builder UI, the validator, the compiler and the dry run all read
 * this one shape. PURE: nothing here touches a clock, a database or a random source.
 */
export const NODE_TYPES = ['TRIGGER', 'WAIT', 'CONDITION', 'SEND', 'BRANCH_EXPERIMENT', 'END'] as const;
export type NodeType = (typeof NODE_TYPES)[number];

/** Events a journey may start from (allowlist). Every one is an id-only, non-clinical fact the platform already owns. */
export const TRIGGER_EVENTS = ['REGISTERED', 'BOOKING_STARTED', 'BOOKING_EXPIRED', 'VISIT_COMPLETED', 'REFERRAL_QUALIFIED', 'REWARD_EVENT', 'CONSENT_CHANGED', 'STAGE_DORMANT'] as const;
export type TriggerEvent = (typeof TRIGGER_EVENTS)[number];

export const CHANNELS = ['PUSH', 'WHATSAPP', 'SMS', 'EMAIL', 'INAPP'] as const;
export type AutomationChannel = (typeof CHANNELS)[number];

/** The templates a SEND node may name: lifecycle templates that are neither tied to a booking or money event nor a security notice. The class is the template's own (never chosen by the author). */
export const SEND_TEMPLATES = ['WELCOME', 'BOOKING_RECOVERY', 'FEEDBACK_REMINDER', 'REENGAGE_DORMANT', 'REFERRAL_NUDGE', 'REFERRAL_INVITE_CARD', 'FAMILY_ONBOARDING', 'FAMILY_ONBOARDING_CARD'] as const;
export type SendTemplate = (typeof SEND_TEMPLATES)[number];

/** The only experiment surface a journey branch may use (P3-A closed registry). */
export const BRANCH_SURFACE = 'lifecycle.winback.subject_line';

/** Policy numbers: the code defaults plus the ACTIVE `AUTOMATION_POLICY` maker-checker version (policy registry); the validator and the runner both read this one object. */
export const AUTOMATION_POLICY = livePolicy('AUTOMATION_POLICY', AUTOMATION_POLICY_DEFAULTS); // live: the ACTIVE maker-checker AUTOMATION_POLICY version over these defaults

interface Base { id: string; label?: string }
export interface TriggerNode extends Base { type: 'TRIGGER'; event: TriggerEvent }
export interface WaitNode extends Base { type: 'WAIT'; minutes: number }
export interface ConditionNode extends Base { type: 'CONDITION'; segment: SegmentRule }
export interface SendNode extends Base { type: 'SEND'; template: SendTemplate; channels?: AutomationChannel[] }
export interface BranchNode extends Base { type: 'BRANCH_EXPERIMENT'; experiment: string }
export interface EndNode extends Base { type: 'END' }
export type GraphNode = TriggerNode | WaitNode | ConditionNode | SendNode | BranchNode | EndNode;
export interface GraphEdge { from: string; to: string; /** BRANCH_EXPERIMENT edges carry the variant key; every other edge has no label. */ label?: string }
export interface JourneyGraph { schema: 1; nodes: GraphNode[]; edges: GraphEdge[] }

/** Canonical JSON (sorted keys): the checksum of a graph is the same whatever order the editor wrote the keys in. */
export function canonical(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`;
}
export const checksumOf = (g: JourneyGraph): string => createHash('sha256').update(canonical(g), 'utf8').digest('hex');

export const nodeById = (g: JourneyGraph) => new Map(g.nodes.map((n) => [n.id, n] as const));
export const outgoing = (g: JourneyGraph, id: string): GraphEdge[] => g.edges.filter((e) => e.from === id);

/** Nodes reachable from `start` following edges. */
export function reachable(g: JourneyGraph, start: string): Set<string> {
  const seen = new Set<string>(); const stack = [start];
  while (stack.length) { const id = stack.pop()!; if (seen.has(id)) continue; seen.add(id); for (const e of outgoing(g, id)) stack.push(e.to); }
  return seen;
}

/** Every simple cycle's node-id set (Johnson-free: the graph has at most 12 nodes, DFS over simple paths is fine). */
export function cycles(g: JourneyGraph): string[][] {
  const found: string[][] = []; const keys = new Set<string>();
  const dfs = (start: string, id: string, path: string[]) => {
    for (const e of outgoing(g, id)) {
      if (e.to === start) { const cyc = [...path]; const k = [...cyc].sort().join('|'); if (!keys.has(k)) { keys.add(k); found.push(cyc); } continue; }
      if (path.includes(e.to)) continue;
      dfs(start, e.to, [...path, e.to]);
    }
  };
  for (const n of g.nodes) dfs(n.id, n.id, [n.id]);
  return found;
}
