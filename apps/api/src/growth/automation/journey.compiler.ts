import { TEMPLATES } from '../../engagement/engagement-public';
import type { JourneyDef, JourneyStep, LifecycleKind, StopFacts } from '../lifecycle/journey.types';
import type { SegmentRule } from '../lifecycle/lifecycle-segments';
import { AUTOMATION_POLICY as P, checksumOf, nodeById, outgoing, type AutomationChannel, type JourneyGraph, type SendNode, type SendTemplate } from './journey.graph';
import { defaultChannels, templateClass } from './journey.validator';

/** What the compiler puts in front of every MARKETING send. The author cannot draw, move or remove it; the real enforcement is the send gate every step passes in the runner. */
export const MARKETING_GATE_CHECKS = ['MARKETING_FLAG', 'HOLDOUT', 'CHANNEL_CONSENT', 'CHANNEL_OPT_OUT', 'SUPPRESSION', 'QUIET_HOURS', 'FREQUENCY_CAP', 'WHATSAPP_TEMPLATE', 'PHI_GUARD', 'DEDUPE'] as const;
export const GATE_CHECKS_OTHER = ['CONSENT', 'CHANNEL_OPT_OUT', 'QUIET_HOURS', 'PHI_GUARD', 'DEDUPE'] as const;

type Stop = JourneyStep['stopOn'][number];
/** Exit conditions every compiled step carries, whatever the graph says: booking made, account deleted, and for MARKETING the loss of marketing consent. (Suppression ends the journey in the runner.) */
export const mandatoryStops = (marketing: boolean, trigger: string): Stop[] => {
  const s: Stop[] = ['bookedAfterAnchor', 'accountDeleted'];
  if (marketing) s.push('MARKETING_CONSENT_LOST');
  if (trigger === 'STAGE_DORMANT') s.push('leftDormant');
  return s;
};

export interface CompiledStepInfo { step: number; nodeId: string; template: SendTemplate; messageClass: string; delayMinutes: number; channels: AutomationChannel[]; branch: Array<{ experiment: string; variant: string }>; conditions: number; gateInserted: boolean }
export interface CompiledJourney { def: JourneyDef; checksum: string; steps: CompiledStepInfo[]; gateNodes: Array<{ beforeStep: number; checks: readonly string[] }>; truncated: boolean; trigger: string }

interface Ctx { graph: JourneyGraph; trigger: string; steps: JourneyStep[]; info: CompiledStepInfo[]; counter: { n: number }; truncated: { v: boolean } }
interface PathState { delay: number; segments: SegmentRule[]; branch: Array<{ experiment: string; variant: string }>; sends: number; depth: number }

function walk(c: Ctx, id: string, st: PathState) {
  if (st.depth > 80) { c.truncated.v = true; return; }
  const node = nodeById(c.graph).get(id)!;
  const next = (ns: Partial<PathState> = {}) => { for (const e of outgoing(c.graph, id)) walk(c, e.to, { ...st, ...ns, depth: st.depth + 1 }); };
  switch (node.type) {
    case 'TRIGGER': return next();
    case 'END': return;
    case 'WAIT': return next({ delay: st.delay + node.minutes });
    case 'CONDITION': return next({ segments: [...st.segments, node.segment] });
    case 'BRANCH_EXPERIMENT':
      for (const e of outgoing(c.graph, id)) walk(c, e.to, { ...st, branch: [...st.branch, { experiment: node.experiment, variant: e.label! }], depth: st.depth + 1 });
      return;
    case 'SEND': {
      if (st.sends >= P.maxSendsPerJourney || c.steps.length >= P.maxCompiledSteps) { c.truncated.v = true; return; } // the per-person cap also bounds an unrolled loop
      const n = node as SendNode; const t = TEMPLATES[n.template as keyof typeof TEMPLATES];
      const cls = templateClass(n.template); const marketing = cls === 'MARKETING';
      const channels = (n.channels ?? defaultChannels(n.template)) as AutomationChannel[];
      const step: JourneyStep = {
        step: ++c.counter.n, delayMinutes: st.delay, messageClass: cls, channels, kind: n.template as LifecycleKind,
        purpose: marketing ? 'MARKETING' : t.reminder ? 'REMINDER' : 'TRANSACTIONAL', stopOn: mandatoryStops(marketing, c.trigger) as JourneyStep['stopOn'] extends ReadonlyArray<infer U> ? U[] : never,
        ...(st.segments.length ? { segments: st.segments } : {}), ...(st.branch.length ? { branch: st.branch } : {}),
        ...(marketing ? { gate: { inserted: true as const, checks: MARKETING_GATE_CHECKS } } : {}),
      };
      c.steps.push(step);
      c.info.push({ step: step.step, nodeId: n.id, template: n.template, messageClass: cls, delayMinutes: st.delay, channels, branch: [...st.branch], conditions: st.segments.length, gateInserted: marketing });
      return next({ delay: 0, segments: [], sends: st.sends + 1 });
    }
  }
}

/**
 * Compiles a VALID graph into the JourneyDef the P2-E runner executes (GRW-P3-E). Deterministic: the same graph always yields the same steps and checksum. A loop (allowed only with a wait of
 * a day or more) is unrolled until the per-person send cap or the step cap stops it. Every MARKETING send gets the consent-and-gate marker and the mandatory exit conditions; a CONDITION
 * becomes a segment check at send time (false ends the journey); a BRANCH_EXPERIMENT becomes arm-tagged steps.
 */
export function compileGraph(graph: JourneyGraph, meta: { definitionId: string; market: string; key: string; version: number; name?: string }): CompiledJourney {
  const trigger = graph.nodes.find((n) => n.type === 'TRIGGER')!;
  const event = trigger.type === 'TRIGGER' ? trigger.event : 'REGISTERED';
  const ctx: Ctx = { graph, trigger: event, steps: [], info: [], counter: { n: 0 }, truncated: { v: false } };
  walk(ctx, trigger.id, { delay: 0, segments: [], branch: [], sends: 0, depth: 0 });
  const checksum = checksumOf(graph);
  const def: JourneyDef = {
    key: `auto.${meta.market.toLowerCase()}.${meta.key}`, version: meta.version, trigger: 'AUTOMATION', anchored: true, steps: ctx.steps, params: { maxSends: P.maxSendsPerJourney, maxPer30Days: P.maxSendsPer30Days },
    describe: { en: meta.name || `Journey ${meta.key}`, ar: meta.name || `رحلة ${meta.key}` },
    custom: { definitionId: meta.definitionId, market: meta.market, definitionKey: meta.key, checksum, trigger: event, maxSends: P.maxSendsPerJourney },
  };
  const gateNodes = ctx.info.filter((i) => i.gateInserted).map((i) => ({ beforeStep: i.step, checks: MARKETING_GATE_CHECKS as readonly string[] }));
  return { def, checksum, steps: ctx.info, gateNodes, truncated: ctx.truncated.v, trigger: event };
}

/** StopFacts keys the compiler may emit; the unit test checks every compiled step only uses these. */
export const COMPILED_STOP_KEYS: ReadonlyArray<keyof StopFacts | 'MARKETING_CONSENT_LOST'> = ['bookedAfterAnchor', 'accountDeleted', 'MARKETING_CONSENT_LOST', 'leftDormant'];
