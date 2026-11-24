import { evaluateSendGate, type GateChannel, type GateOutcome } from '../lifecycle/send-gate';
import { inSegment, type SegmentFacts } from '../lifecycle/lifecycle-segments';
import { quietWindow, defaultQuiet } from '../lifecycle/quiet-hours';
import type { CompiledJourney } from './journey.compiler';

/**
 * Dry run on a SYNTHETIC cohort (GRW-P3-E). No database, no clock, no randomness: the cohort is generated from a seed and the verdicts come from the same pure gate the runner uses
 * (`evaluateSendGate`), so what the operator sees is what a real run would decide for that cohort. Nothing is sent and no person is read.
 */
export interface SyntheticPerson { id: string; facts: SegmentFacts; marketingConsent: boolean; suppressed: boolean; optedOut: boolean; hasAddress: boolean }
export interface DryRunOptions { size?: number; seed?: number; now?: number; marketingFlagOn: boolean; holdoutBps?: number; caps?: { perDay: number; perWeek: number }; quiet?: { start: string; end: string; timezone: string } | null }
export interface DryRunStepResult { step: number; template: string; messageClass: string; reached: number; sent: number; skipped: Record<string, number>; deferred: number }
export interface DryRunResult { cohort: number; seed: number; steps: DryRunStepResult[]; totalSent: number; exits: Record<string, number>; gateNodes: CompiledJourney['gateNodes']; perPersonMax: number; marketingFlagOn: boolean; note: { en: string; ar: string } }

/** mulberry32: a tiny deterministic generator, so a seed reproduces the cohort byte for byte. */
function rng(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const pick = <T>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;

export function syntheticCohort(size: number, seed: number): SyntheticPerson[] {
  const r = rng(seed); const out: SyntheticPerson[] = [];
  for (let i = 0; i < size; i++) {
    out.push({
      id: `syn-${i}`,
      facts: { stage: pick(r, ['REGISTERED', 'ACTIVATED', 'BOOKED', 'ATTENDED', 'RETAINED', 'DORMANT', 'CHURNED']), platform: pick(r, ['web', 'ios', 'android']), language: r() < 0.8 ? 'ar' : 'en', city: pick(r, ['Cairo', 'Giza', 'Alexandria']), district: null, registeredDaysAgo: Math.floor(r() * 700), lastBookingDaysAgo: r() < 0.15 ? null : Math.floor(r() * 400), hasDependants: r() < 0.2, referralStatus: pick(r, ['NONE', 'NONE', 'INVITED', 'QUALIFIED']) },
      marketingConsent: r() < 0.55, suppressed: r() < 0.05, optedOut: r() < 0.08, hasAddress: r() < 0.95,
    });
  }
  return out;
}

export function dryRun(c: CompiledJourney, o: DryRunOptions): DryRunResult {
  const size = Math.max(10, Math.min(5000, o.size ?? 1000)); const seed = o.seed ?? 20270128; const now = o.now ?? Date.UTC(2027, 0, 28, 10, 0, 0);
  const caps = o.caps ?? { perDay: 1, perWeek: 3 };
  const quiet = quietWindow(o.quiet ?? defaultQuiet(), null);
  const people = syntheticCohort(size, seed);
  const exits: Record<string, number> = {}; const bump = (k: string) => { exits[k] = (exits[k] ?? 0) + 1; };
  const steps: DryRunStepResult[] = c.def.steps.map((s) => ({ step: s.step, template: s.kind, messageClass: s.messageClass, reached: 0, sent: 0, skipped: {}, deferred: 0 }));
  const sentCount = new Map<string, number>();
  const variantsOf = new Map<string, string[]>();
  for (const s of c.def.steps) for (const b of s.branch ?? []) variantsOf.set(b.experiment, [...new Set([...(variantsOf.get(b.experiment) ?? []), b.variant])].sort());
  // person-by-person, step-by-step in order; a branch step is reached by the arm the person is hashed into (an even split by seed in a dry run)
  for (const p of people) {
    const armOf = (exp: string) => { const vs = variantsOf.get(exp) ?? ['control']; return vs[hash(`${seed}:${p.id}:${exp}`) % vs.length]!; };
    let ended = false;
    for (const [i, s] of c.def.steps.entries()) {
      if (ended) break;
      if (s.branch?.some((b) => armOf(b.experiment) !== b.variant)) continue;
      const row = steps[i]!; row.reached++;
      if (s.segments?.some((seg) => !inSegment(seg, p.facts))) { bump('CONDITION_FALSE'); ended = true; break; }
      if ((sentCount.get(p.id) ?? 0) >= c.def.custom!.maxSends) { bump('SEND_CAP'); ended = true; break; }
      let outcome: GateOutcome = { decision: 'SKIP', reason: 'NO_ADDRESS' }; let chosen: GateChannel | null = null;
      for (const ch of s.channels) {
        outcome = evaluateSendGate({
          messageClass: s.messageClass, channel: ch, now, journeyEnabled: true, marketingFlagOn: o.marketingFlagOn, inHoldout: s.messageClass === 'MARKETING' && (hash(`${p.id}:${c.def.key}`) % 10_000) < (o.holdoutBps ?? 0),
          consent: s.messageClass === 'MARKETING' ? p.marketingConsent : true, channelOptedOut: p.optedOut, suppressed: p.suppressed, quiet, sentDay: 0, sentWeek: sentCount.get(p.id) ?? 0, caps, whatsappWindowOpen: false, templateApproved: true,
          hasAddress: p.hasAddress, phiHits: [], duplicate: false,
        });
        if (outcome.decision === 'SEND') { chosen = ch; break; }
        if (outcome.reason === 'MARKETING_FLAG_OFF' || outcome.reason === 'HOLDOUT') break;
      }
      if (outcome.decision === 'SEND' && chosen) { row.sent++; sentCount.set(p.id, (sentCount.get(p.id) ?? 0) + 1); continue; }
      if (outcome.decision === 'SKIP') {
        if (outcome.reason === 'QUIET_HOURS') { row.deferred++; continue; }
        row.skipped[outcome.reason] = (row.skipped[outcome.reason] ?? 0) + 1;
        // the same exits the runner applies to a custom journey
        if (s.messageClass === 'MARKETING' && (outcome.reason === 'SUPPRESSED' || outcome.reason === 'NO_CONSENT')) { bump(outcome.reason === 'SUPPRESSED' ? 'EXIT_SUPPRESSED' : 'EXIT_CONSENT'); ended = true; }
      }
    }
  }
  const totalSent = steps.reduce((a, s) => a + s.sent, 0);
  return {
    cohort: size, seed, steps, totalSent, exits, gateNodes: c.gateNodes, perPersonMax: c.def.custom!.maxSends, marketingFlagOn: o.marketingFlagOn,
    note: { en: 'A synthetic cohort, no real person. The gate decisions are the real ones; quiet hours defer a send, they do not drop it.', ar: 'مجموعة تجريبية بدون أي شخص حقيقي. قرارات البوابة هي نفسها الفعلية، وساعات الهدوء تؤجل الإرسال ولا تلغيه.' },
  };
}

function hash(s: string): number { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
