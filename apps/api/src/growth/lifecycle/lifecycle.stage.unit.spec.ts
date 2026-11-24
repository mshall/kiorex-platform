import { DEFAULT_STAGE_THRESHOLDS, deriveStage, stageChange, stageRank, type StageFacts } from './lifecycle.stage';

const NOW = new Date('2027-03-01T12:00:00Z');
const ago = (d: number) => new Date(NOW.getTime() - d * 86_400_000);
const base: StageFacts = { registeredAt: ago(2), lastBookingAt: null, lastAttendedAt: null, intentCount: 0, bookedCount: 0, attendedInWindow: 0, attendedTotal: 0, hasUpcoming: false };
const f = (o: Partial<StageFacts>): StageFacts => ({ ...base, ...o });

describe('lifecycle stage derivation (non-clinical)', () => {
  it.each([
    ['just registered', f({}), 'REGISTERED'],
    ['started a booking that never confirmed', f({ intentCount: 1, lastBookingAt: ago(1) }), 'ACTIVATED'],
    ['a booking reached the clinic', f({ intentCount: 1, bookedCount: 1, lastBookingAt: ago(1) }), 'BOOKED'],
    ['attended once', f({ intentCount: 1, bookedCount: 1, attendedTotal: 1, attendedInWindow: 1, lastBookingAt: ago(10), lastAttendedAt: ago(9), registeredAt: ago(40) }), 'ATTENDED'],
    ['attended twice in 12 months', f({ intentCount: 2, bookedCount: 2, attendedTotal: 2, attendedInWindow: 2, lastBookingAt: ago(10), lastAttendedAt: ago(9), registeredAt: ago(300) }), 'RETAINED'],
    ['two visits but one is older than 12 months', f({ intentCount: 2, bookedCount: 2, attendedTotal: 2, attendedInWindow: 1, lastBookingAt: ago(10), lastAttendedAt: ago(9), registeredAt: ago(900) }), 'ATTENDED'],
    ['registered 180 days ago, never booked', f({ registeredAt: ago(180) }), 'DORMANT'],
    ['registered 179 days ago, never booked', f({ registeredAt: ago(179) }), 'REGISTERED'],
    ['registered 365 days ago, never booked', f({ registeredAt: ago(365) }), 'CHURNED'],
    ['last booking 181 days ago', f({ intentCount: 1, bookedCount: 1, attendedTotal: 1, attendedInWindow: 1, lastBookingAt: ago(181), lastAttendedAt: ago(181), registeredAt: ago(400) }), 'DORMANT'],
    ['last booking 366 days ago', f({ intentCount: 1, bookedCount: 1, attendedTotal: 1, attendedInWindow: 0, lastBookingAt: ago(366), lastAttendedAt: ago(366), registeredAt: ago(500) }), 'CHURNED'],
    ['an upcoming booking keeps a long-idle person out of dormant', f({ intentCount: 1, bookedCount: 1, hasUpcoming: true, lastBookingAt: ago(200), registeredAt: ago(400) }), 'BOOKED'],
  ] as const)('%s -> %s', (_n, facts, stage) => { expect(deriveStage(facts, NOW)).toBe(stage); });

  it('the thresholds come from policy', () => {
    const t = { ...DEFAULT_STAGE_THRESHOLDS, dormantDays: 30 };
    expect(deriveStage(f({ registeredAt: ago(31) }), NOW, t)).toBe('DORMANT');
  });
  it('is pure: the same facts give the same stage, a change is reported once', () => {
    expect(deriveStage(f({}), NOW)).toBe(deriveStage(f({}), NOW));
    expect(stageChange('BOOKED', 'ATTENDED')).toEqual({ from: 'BOOKED', to: 'ATTENDED', changed: true });
    expect(stageChange('BOOKED', 'BOOKED').changed).toBe(false);
    expect(stageRank('CHURNED')).toBeGreaterThan(stageRank('REGISTERED'));
  });
  it('uses no clinical field: the facts type carries only dates and counts', () => {
    expect(Object.keys(base).sort()).toEqual(['attendedInWindow', 'attendedTotal', 'bookedCount', 'hasUpcoming', 'intentCount', 'lastAttendedAt', 'lastBookingAt', 'registeredAt']);
  });
});
