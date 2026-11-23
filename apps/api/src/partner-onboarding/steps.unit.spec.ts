import { AUTO_STEPS, computeSteps, goLiveBlockers, progressPct, type ChecksDoc, type StepInput } from './steps';

const ok = (): ChecksDoc => ({ items: Object.fromEntries(AUTO_STEPS.map((k) => [k, { status: 'PASSED', code: 'OK' }])) as any });
const base = (o: Partial<StepInput> = {}): StepInput => ({ kind: 'CLINIC', status: 'IN_REVIEW', checks: {}, human: {}, hasRegistration: false, ...o });
const human = { documents: { by: 'a', at: 't' }, licence: { by: 'a', at: 't', reference: 'LIC-1' }, fees: { by: 'a', at: 't', mode: 'STANDARD' as const } };

describe('partner onboarding steps', () => {
  it('starts with every automated check pending and human steps locked or actionable', () => {
    const s = computeSteps(base());
    expect(s.filter((x) => x.type === 'AUTO').every((x) => x.state === 'PENDING')).toBe(true);
    expect(s.find((x) => x.key === 'review_documents')?.state).toBe('LOCKED');
    expect(s.find((x) => x.key === 'verify_licence')?.state).toBe('ACTION');
    expect(s.find((x) => x.key === 'approval')?.state).toBe('LOCKED');
    expect(progressPct(s)).toBe(0);
  });
  it('documents review unlocks only once the automated documents check passed', () => {
    expect(computeSteps(base({ checks: ok() })).find((x) => x.key === 'review_documents')?.state).toBe('ACTION');
  });
  it('a launch-locked flag awaiting its gate adds a super-admin HUMAN gate step that is never auto-satisfied', () => {
    const c = ok(); c.items!.flags = { status: 'WARN', code: 'AWAITING_GATE', detail: { gates: [{ flag: 'kiorex.pharmacy_orders', gateIds: [], satisfied: false }] } };
    const s = computeSteps(base({ kind: 'PHARMACY', checks: c, human }));
    const g = s.find((x) => x.key === 'launch_gate')!;
    expect(g).toMatchObject({ type: 'HUMAN', state: 'ACTION', actor: 'super_admin' });
    expect(goLiveBlockers(base({ kind: 'PHARMACY', status: 'APPROVED', checks: c, human }))).toContain('STEP_LAUNCH_GATE');
  });
  it('approval opens when everything else is green and needs a second person while waiting', () => {
    expect(computeSteps(base({ checks: ok(), human })).find((x) => x.key === 'approval')?.state).toBe('ACTION');
    const w = computeSteps(base({ checks: ok(), human, status: 'AWAITING_APPROVAL', requestedBy: 'ops1' })).find((x) => x.key === 'approval')!;
    expect(w).toMatchObject({ state: 'ACTION', code: 'AWAITING_SECOND_PERSON' });
  });
  it('go live is blocked until approved and every gate is green, then reports 100 percent when LIVE', () => {
    expect(goLiveBlockers(base({ checks: ok(), human, status: 'IN_REVIEW' }))).toContain('STEP_APPROVAL');
    expect(goLiveBlockers(base({ checks: ok(), human, status: 'APPROVED', approvedBy: 'sa' }))).toEqual([]);
    const failed = ok(); failed.items!.handshake = { status: 'FAILED', code: 'SIGNATURE_REJECTED' };
    expect(goLiveBlockers(base({ checks: failed, human, status: 'APPROVED' }))).toEqual(['STEP_HANDSHAKE']);
    expect(progressPct(computeSteps(base({ checks: ok(), human, status: 'LIVE', approvedBy: 'sa' })))).toBe(100);
  });
  it('WARN results highlight but do not block', () => {
    const c = ok(); c.items!.duplicates = { status: 'WARN', code: 'SIMILAR_NAME' };
    expect(goLiveBlockers(base({ checks: c, human, status: 'APPROVED' }))).toEqual([]);
  });
});
