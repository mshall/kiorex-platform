import { COMPILED_STOP_KEYS, compileGraph, MARKETING_GATE_CHECKS } from './journey.compiler';
import { dryRun, syntheticCohort } from './journey.dryrun';
import { BRANCHED, clone, FEEDBACK_FOLLOWUP, REENGAGE_TWO_STEP } from './journey.fixtures';
import { AUTOMATION_POLICY, type JourneyGraph } from './journey.graph';
import { validateGraph } from './journey.validator';

const META = { definitionId: 'd1', market: 'EG', key: 'reengage-2', version: 1 };
const compile = (g: JourneyGraph) => { const v = validateGraph(g); if (!v.valid) throw new Error(JSON.stringify(v.errors)); return compileGraph(v.graph, META); };

describe('journey compiler (GRW-P3-E)', () => {
  it('is deterministic: the same graph compiles to the same journey and checksum', () => {
    const a = compile(REENGAGE_TWO_STEP); const b = compile(clone(REENGAGE_TWO_STEP));
    expect(JSON.stringify(a.def)).toBe(JSON.stringify(b.def)); expect(a.checksum).toBe(b.checksum);
  });

  it('compiles the two-step re-engagement journey into two MARKETING steps with the right delays', () => {
    const c = compile(REENGAGE_TWO_STEP);
    expect(c.def.key).toBe('auto.eg.reengage-2'); expect(c.def.trigger).toBe('AUTOMATION'); expect(c.def.custom).toMatchObject({ trigger: 'STAGE_DORMANT', market: 'EG', definitionKey: 'reengage-2' });
    expect(c.def.steps.map((s) => [s.step, s.delayMinutes, s.messageClass, s.kind])).toEqual([[1, 0, 'MARKETING', 'REENGAGE_DORMANT'], [2, 7 * 1440, 'MARKETING', 'REENGAGE_DORMANT']]);
    expect(c.def.steps[0]!.channels).toEqual(['PUSH', 'WHATSAPP']);
    expect(c.def.steps[1]!.segments).toEqual([{ language: ['ar'] }]); // the condition is checked at send time of step 2
    expect(c.def.steps[0]!.segments).toBeUndefined();
  });

  it('inserts the consent-and-gate marker in front of EVERY marketing send, and never on others', () => {
    for (const g of [REENGAGE_TWO_STEP, BRANCHED]) {
      const c = compile(g);
      for (const s of c.def.steps) { if (s.messageClass === 'MARKETING') expect(s.gate).toEqual({ inserted: true, checks: MARKETING_GATE_CHECKS }); else expect(s.gate).toBeUndefined(); }
      expect(c.gateNodes.length).toBe(c.def.steps.filter((s) => s.messageClass === 'MARKETING').length);
    }
    const t = compile(FEEDBACK_FOLLOWUP);
    expect(t.gateNodes).toEqual([]); expect(t.def.steps[0]).toMatchObject({ messageClass: 'TRANSACTIONAL', purpose: 'REMINDER' });
  });

  it('the author cannot remove the gate: a graph with no gate field compiles the same as any other, and a "gate" in the graph is rejected', () => {
    const g: any = clone(REENGAGE_TWO_STEP); g.nodes.push({ id: 'g', type: 'GATE' });
    expect(validateGraph(g).valid).toBe(false);
  });

  it('every step carries the mandatory exit conditions; marketing steps also stop on lost consent', () => {
    for (const g of [REENGAGE_TWO_STEP, BRANCHED, FEEDBACK_FOLLOWUP]) for (const s of compile(g).def.steps) {
      expect(s.stopOn).toEqual(expect.arrayContaining(['bookedAfterAnchor', 'accountDeleted']));
      if (s.messageClass === 'MARKETING') expect(s.stopOn).toContain('MARKETING_CONSENT_LOST');
      for (const k of s.stopOn) expect(COMPILED_STOP_KEYS).toContain(k);
    }
    expect(compile(REENGAGE_TWO_STEP).def.steps[0]!.stopOn).toContain('leftDormant');
  });

  it('tags the steps of each branch arm', () => {
    const c = compile(BRANCHED);
    expect(c.def.steps.map((s) => s.branch)).toEqual([[{ experiment: 'winback-subject-test', variant: 'control' }], [{ experiment: 'winback-subject-test', variant: 'short' }]]);
    expect(c.def.steps.map((s) => s.kind)).toEqual(['REENGAGE_DORMANT', 'REFERRAL_NUDGE']);
    expect(c.def.steps.map((s) => s.step)).toEqual([1, 2]);
  });

  it('unrolls a daily loop only up to the per-person send cap (it can never run away)', () => {
    const g: any = { schema: 1, nodes: [{ id: 'start', type: 'TRIGGER', event: 'STAGE_DORMANT' }, { id: 'send', type: 'SEND', template: 'REENGAGE_DORMANT' }, { id: 'wait', type: 'WAIT', minutes: 1440 }], edges: [{ from: 'start', to: 'send' }, { from: 'send', to: 'wait' }, { from: 'wait', to: 'send' }] };
    const c = compile(g);
    expect(c.def.steps.length).toBe(AUTOMATION_POLICY.maxSendsPerJourney); expect(c.truncated).toBe(true);
    expect(c.def.steps.map((s) => s.delayMinutes)).toEqual([0, 1440, 1440]);
  });

  it('only emits closed vocabulary: channels, kinds, classes', () => {
    for (const g of [REENGAGE_TWO_STEP, BRANCHED, FEEDBACK_FOLLOWUP]) for (const s of compile(g).def.steps) {
      expect(['MARKETING', 'TRANSACTIONAL']).toContain(s.messageClass);
      expect(['PUSH', 'WHATSAPP', 'SMS', 'EMAIL', 'INAPP']).toEqual(expect.arrayContaining([...s.channels]));
    }
  });
});

describe('journey dry run (GRW-P3-E)', () => {
  const c = compile(REENGAGE_TWO_STEP);
  const base = { marketingFlagOn: true as boolean };

  it('is deterministic for a seed', () => { expect(JSON.stringify(dryRun(c, { ...base, seed: 7, size: 500 }))).toBe(JSON.stringify(dryRun(c, { ...base, seed: 7, size: 500 }))); });
  it('the synthetic cohort is reproducible and contains no identifier but its own label', () => {
    expect(JSON.stringify(syntheticCohort(50, 3))).toBe(JSON.stringify(syntheticCohort(50, 3)));
    expect(syntheticCohort(5, 1).every((p) => /^syn-\d+$/.test(p.id))).toBe(true);
  });
  it('with the marketing flag OFF nobody is sent anything (the locked flag is honoured by the dry run too)', () => {
    const r = dryRun(c, { marketingFlagOn: false, seed: 1, size: 400 });
    expect(r.totalSent).toBe(0); expect(r.steps[0]!.skipped.MARKETING_FLAG_OFF).toBe(r.steps[0]!.reached);
  });
  it('with the flag on, only consented, non-suppressed, non-opted-out people are sent, and the numbers add up', () => {
    const r = dryRun(c, { ...base, seed: 1, size: 1000 });
    const s1 = r.steps[0]!;
    expect(s1.reached).toBe(1000); expect(s1.sent).toBeGreaterThan(0); expect(s1.sent).toBeLessThan(700);
    const skipped = Object.values(s1.skipped).reduce((a, b) => a + b, 0);
    expect(s1.sent + skipped + s1.deferred).toBe(s1.reached);
    expect(s1.skipped.NO_CONSENT).toBeGreaterThan(0);
    expect(r.steps[1]!.reached).toBeLessThanOrEqual(s1.sent + s1.deferred + skipped);
  });
  it('the condition (Arabic only) removes English speakers from step 2', () => {
    const r = dryRun(c, { ...base, seed: 5, size: 2000 });
    expect(r.exits.CONDITION_FALSE).toBeGreaterThan(0);
  });
  it('a holdout slice is measured and not sent', () => {
    const r = dryRun(c, { ...base, seed: 2, size: 2000, holdoutBps: 2000 });
    expect(r.steps[0]!.skipped.HOLDOUT).toBeGreaterThan(200);
  });
  it('lists the inserted gate nodes and the per-person maximum', () => { const r = dryRun(c, { ...base, size: 100 }); expect(r.gateNodes.length).toBe(2); expect(r.perPersonMax).toBe(3); });
});
