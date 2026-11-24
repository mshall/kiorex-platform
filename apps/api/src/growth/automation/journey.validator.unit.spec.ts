import { BRANCHED, clone, FEEDBACK_FOLLOWUP, REENGAGE_TWO_STEP } from './journey.fixtures';
import { checksumOf, canonical, cycles } from './journey.graph';
import { validateGraph, type ValidationCode } from './journey.validator';

const codes = (g: unknown): ValidationCode[] => { const r = validateGraph(g); return r.valid ? [] : r.errors.map((e) => e.code); };
const mut = (f: (g: any) => void, base: any = REENGAGE_TWO_STEP) => { const g = clone(base); f(g); return g; };

describe('journey validator (GRW-P3-E): fails closed on every forbidden construct', () => {
  it('accepts the acceptance journeys', () => {
    for (const g of [REENGAGE_TWO_STEP, BRANCHED, FEEDBACK_FOLLOWUP]) expect(validateGraph(g)).toMatchObject({ valid: true, errors: [] });
  });

  const table: Array<[string, (g: any) => void, ValidationCode]> = [
    ['unknown top-level field (caps / exit conditions are not editable)', (g) => { g.exitConditions = []; }, 'UNKNOWN_FIELD'],
    ['a "gate" field on the graph', (g) => { g.gate = false; }, 'UNKNOWN_FIELD'],
    ['wrong schema version', (g) => { g.schema = 2; }, 'SCHEMA'],
    ['a GATE node cannot be drawn', (g) => { g.nodes.push({ id: 'gate', type: 'GATE' }); }, 'UNKNOWN_NODE_TYPE'],
    ['a SCRIPT node (free scripting) does not exist', (g) => { g.nodes.push({ id: 'js', type: 'SCRIPT', code: 'x' }); }, 'UNKNOWN_NODE_TYPE'],
    ['an unknown field on a node', (g) => { g.nodes[1].bypassConsent = true; }, 'UNKNOWN_FIELD'],
    ['more than 12 nodes', (g) => { for (let i = 0; i < 8; i++) g.nodes.push({ id: `x${i}`, type: 'END' }); }, 'TOO_MANY_NODES'],
    ['duplicate id', (g) => { g.nodes[2].id = 'send1'; }, 'DUPLICATE_ID'],
    ['two triggers', (g) => { g.nodes.push({ id: 't2', type: 'TRIGGER', event: 'REGISTERED' }); }, 'MULTIPLE_TRIGGERS'],
    ['no trigger', (g) => { g.nodes = g.nodes.filter((n: any) => n.type !== 'TRIGGER'); g.edges = g.edges.filter((e: any) => e.from !== 'start'); }, 'NO_TRIGGER'],
    ['trigger event outside the allowlist', (g) => { g.nodes[0].event = 'DIAGNOSIS_RECORDED'; }, 'TRIGGER_EVENT_NOT_ALLOWED'],
    ['wait below 15 minutes', (g) => { g.nodes[2].minutes = 14; }, 'WAIT_RANGE'],
    ['wait above 90 days', (g) => { g.nodes[2].minutes = 90 * 24 * 60 + 1; }, 'WAIT_RANGE'],
    ['wait that is not a whole number', (g) => { g.nodes[2].minutes = 20.5; }, 'WAIT_RANGE'],
    ['condition on specialty', (g) => { g.nodes[3].segment = { specialty: ['CARDIOLOGY'] }; }, 'CLINICAL_REFERENCE'],
    ['condition on a doctor', (g) => { g.nodes[3].segment = { doctor: ['x'] }; }, 'CLINICAL_REFERENCE'],
    ['condition on a provider', (g) => { g.nodes[3].segment = { providerId: ['x'] }; }, 'CLINICAL_REFERENCE'],
    ['condition on order data', (g) => { g.nodes[3].segment = { prescription: true }; }, 'CLINICAL_REFERENCE'],
    ['condition on an attribute that is simply unknown', (g) => { g.nodes[3].segment = { favouriteColour: ['red'] }; }, 'CONDITION_INVALID'],
    ['empty condition', (g) => { g.nodes[3].segment = {}; }, 'CONDITION_INVALID'],
    ['a clinical word in a label', (g) => { g.nodes[1].label = 'Remind cardiology patients'; }, 'CLINICAL_REFERENCE'],
    ['a clinical word in a node id', (g) => { g.nodes[1].id = 'doctor-nudge'; g.edges[0].to = 'doctor-nudge'; g.edges[1].from = 'doctor-nudge'; }, 'CLINICAL_REFERENCE'],
    ['a status template (money event)', (g) => { g.nodes[1].template = 'REWARD_ISSUED'; }, 'TEMPLATE_NOT_ALLOWED'],
    ['a security template', (g) => { g.nodes[1].template = 'NEW_DEVICE_NOTICE'; }, 'TEMPLATE_NOT_ALLOWED'],
    ['a booking template', (g) => { g.nodes[1].template = 'BOOKING_CONFIRMED'; }, 'TEMPLATE_NOT_ALLOWED'],
    ['an invented template', (g) => { g.nodes[1].template = 'MY_OWN_TEXT'; }, 'TEMPLATE_NOT_ALLOWED'],
    ['free text as a template', (g) => { g.nodes[1].template = 'Hello there, 20% off'; }, 'TEMPLATE_NOT_ALLOWED'],
    ['an unknown channel', (g) => { g.nodes[1].channels = ['FAX']; }, 'CHANNEL_NOT_ALLOWED'],
    ['in-app inbox for a MARKETING template', (g) => { g.nodes[1].channels = ['INAPP']; }, 'CHANNEL_NOT_ALLOWED'],
    ['a repeated channel', (g) => { g.nodes[1].channels = ['PUSH', 'PUSH']; }, 'CHANNEL_NOT_ALLOWED'],
    ['an edge to nowhere', (g) => { g.edges.push({ from: 'send2', to: 'ghost' }); }, 'EDGE_INVALID'],
    ['an unknown field on an edge', (g) => { g.edges[0].weight = 1; }, 'UNKNOWN_FIELD'],
    ['a node that cannot be reached', (g) => { g.nodes.push({ id: 'lost', type: 'END' }); }, 'UNREACHABLE'],
    ['a dead end (no path to END)', (g) => { g.edges = g.edges.filter((e: any) => e.from !== 'send2'); }, 'DEAD_END'],
    ['no END node', (g) => { g.nodes = g.nodes.filter((n: any) => n.type !== 'END'); g.edges = g.edges.filter((e: any) => e.to !== 'done'); }, 'NO_END'],
    ['no SEND node', (g) => { g.nodes = g.nodes.filter((n: any) => n.type !== 'SEND'); g.edges = [{ from: 'start', to: 'wait1' }, { from: 'wait1', to: 'only-ar' }, { from: 'only-ar', to: 'done' }]; }, 'NO_SEND'],
    ['two edges out of a plain node (hidden fork)', (g) => { g.edges.push({ from: 'send1', to: 'done' }); }, 'EDGE_INVALID'],
    ['an edge into the trigger', (g) => { g.edges.push({ from: 'send2', to: 'start' }); g.edges = g.edges.filter((e: any) => !(e.from === 'send2' && e.to === 'done')); }, 'EDGE_INVALID'],
    ['a loop without a daily wait', (g) => { g.nodes.push({ id: 'short', type: 'WAIT', minutes: 60 }); g.edges = g.edges.filter((e: any) => e.from !== 'send2'); g.edges.push({ from: 'send2', to: 'short' }, { from: 'short', to: 'send1' }, { from: 'start', to: 'send1' }); g.edges = g.edges.filter((e: any) => !(e.from === 'start' && e.to === 'send1') || true); g.nodes.push({ id: 'x', type: 'END' }); }, 'EDGE_INVALID'],
    ['four sends on one path (per-person cap)', (g) => { g.nodes.push({ id: 's3', type: 'SEND', template: 'REFERRAL_NUDGE' }, { id: 's4', type: 'SEND', template: 'FAMILY_ONBOARDING' }); g.edges = g.edges.filter((e: any) => e.from !== 'send2'); g.edges.push({ from: 'send2', to: 's3' }, { from: 's3', to: 's4' }, { from: 's4', to: 'done' }); }, 'SEND_CAP'],
    ['a branch with one arm', (g) => { g.edges = g.edges.filter((e: any) => e.label !== 'short'); }, 'BRANCH_INVALID'],
    ['a branch without a control arm', (g) => { g.edges.find((e: any) => e.label === 'control').label = 'other'; }, 'BRANCH_INVALID'],
    ['a branch arm without a label', (g) => { delete g.edges.find((e: any) => e.label === 'short').label; }, 'BRANCH_INVALID'],
    ['a label on a plain edge', (g) => { g.edges[0].label = 'yes'; }, 'EDGE_INVALID'],
  ];
  it.each(table.filter(([n]) => !n.startsWith('a loop without')))('rejects: %s', (_n, f, code) => {
    const base = /branch/.test(_n) ? BRANCHED : REENGAGE_TWO_STEP;
    const r = codes(mut(f, base));
    expect(r).toContain(code);
  });

  it('rejects every non-object input', () => { for (const x of [null, undefined, 3, 'x', [], true]) expect(codes(x)).toEqual(['SCHEMA']); });

  describe('cycles', () => {
    const loop = (minutes: number) => ({
      schema: 1,
      nodes: [{ id: 'start', type: 'TRIGGER', event: 'STAGE_DORMANT' }, { id: 'send', type: 'SEND', template: 'REENGAGE_DORMANT' }, { id: 'wait', type: 'WAIT', minutes }, { id: 'cond', type: 'CONDITION', segment: { stage: ['DORMANT'] } }, { id: 'end', type: 'END' }],
      edges: [{ from: 'start', to: 'send' }, { from: 'send', to: 'wait' }, { from: 'wait', to: 'cond' }, { from: 'cond', to: 'send' }],
    });
    it('detects a loop', () => expect(cycles(loop(60) as any).length).toBe(1));
    it('a loop with a 60 minute wait is refused', () => { const r = codes(loop(60)); expect(r).toContain('CYCLE_WITHOUT_DAILY_WAIT'); });
    it('a loop with a one day wait is accepted (the send cap and the exit conditions end it)', () => { expect(codes(loop(24 * 60))).toEqual([]); });
  });

  it('every error has a stable code and a JSON pointer path', () => {
    const r = validateGraph(mut((g) => { g.nodes[3].segment = { specialty: ['x'] }; g.nodes[2].minutes = 1; }));
    expect(r.valid).toBe(false);
    for (const e of r.errors) { expect(e.code).toMatch(/^[A-Z_]+$/); expect(e.path.startsWith('/')).toBe(true); expect(e.message.length).toBeGreaterThan(5); }
  });

  it('checksum ignores key order and is stable', () => {
    const a = REENGAGE_TWO_STEP; const b = JSON.parse(JSON.stringify(a), (_k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).reverse()) : v));
    expect(canonical(a)).toBe(canonical(b)); expect(checksumOf(a)).toBe(checksumOf(b)); expect(checksumOf(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(checksumOf(clone(mut((g) => { g.nodes[2].minutes = 30; })))).not.toBe(checksumOf(a));
  });
});
