import { evaluateFlag, SnapshotFlag } from './flag-evaluator';

/** G-COHORT hook in the pure evaluator: a cohort OFF applies only when the context carries that cohort; default is no effect. */
const flag = (extra: Partial<SnapshotFlag> = {}): Map<string, SnapshotFlag> =>
  new Map([['clinic.ai_scribe', { key: 'clinic.ai_scribe', class: 'MODULE', scopes: ['GLOBAL', 'MARKET', 'ORG'], dependsOn: [], launchLocked: false, gateSatisfied: true, values: { markets: {}, orgs: {} }, ...extra }]]);

describe('flag evaluation: release cohort hook', () => {
  it('no cohort values or no cohort in the context: unchanged (ON)', () => {
    expect(evaluateFlag(flag(), 'clinic.ai_scribe', { orgId: 'o1', cohort: 'pilot' })).toMatchObject({ effective: true, reason: 'ON' });
    expect(evaluateFlag(flag({ cohortOff: { pilot: 'OFF' } }), 'clinic.ai_scribe', { orgId: 'o1' })).toMatchObject({ effective: true, reason: 'ON' });
  });
  it('OFF for the cohort turns the flag off for that cohort only (case-insensitive)', () => {
    const m = flag({ cohortOff: { pilot: 'OFF' } });
    expect(evaluateFlag(m, 'clinic.ai_scribe', { orgId: 'o1', cohort: 'Pilot' })).toMatchObject({ effective: false, reason: 'OFF_COHORT', scope: 'COHORT' });
    expect(evaluateFlag(m, 'clinic.ai_scribe', { orgId: 'o1', cohort: 'ga' })).toMatchObject({ effective: true });
  });
  it('never re-enables: a global OFF stays OFF with a cohort in context', () => {
    const m = flag({ values: { global: 'OFF', markets: {}, orgs: {} }, cohortOff: { pilot: 'OFF' } });
    expect(evaluateFlag(m, 'clinic.ai_scribe', { cohort: 'ga' })).toMatchObject({ effective: false, reason: 'OFF_GLOBAL' });
  });
});
