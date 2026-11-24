import { KiorlyClient, KiorlyTransientError } from './kiorly.client';

jest.mock('../common/outbound-http', () => ({ outboundFetch: jest.fn() }));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { outboundFetch } = require('../common/outbound-http') as { outboundFetch: jest.Mock };
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** W8 integration: a promotion that is busy (503 PROMOTION_RESERVE_BUSY + Retry-After from the Clinic) is retryable but is not a sick clinic: it must never open the circuit that guards bookings. */
describe('Kiorly client and a busy promotion', () => {
  beforeEach(() => outboundFetch.mockReset());
  it('PROMOTION_RESERVE_BUSY is a transient error that does not count toward the breaker', async () => {
    const c = new KiorlyClient();
    outboundFetch.mockImplementation(async () => reply(503, { code: 'PROMOTION_RESERVE_BUSY', message: 'busy' }));
    for (let i = 0; i < 12; i++) await expect(c.request({ method: 'POST', path: '/promotions/p/reserve', clinicId: 'c1', body: {} })).rejects.toBeInstanceOf(KiorlyTransientError);
    expect(c.isCircuitOpen('c1')).toBe(false);
  });
  it('any other 503 still counts and opens the circuit after five', async () => {
    const c = new KiorlyClient();
    outboundFetch.mockImplementation(async () => reply(503, { code: 'SOMETHING_ELSE' }));
    for (let i = 0; i < 5; i++) await expect(c.request({ method: 'POST', path: '/holds', clinicId: 'c2', body: {} })).rejects.toBeInstanceOf(KiorlyTransientError);
    expect(c.isCircuitOpen('c2')).toBe(true);
  });
});
