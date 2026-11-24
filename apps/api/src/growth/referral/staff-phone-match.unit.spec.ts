import { ClinicStaffPhoneMatch, staffPhoneMatchHash } from './referral-identity.service';

// vectors of kiorex-contracts 1.13.0 fixtures/growth-v1.13/staff-phone-match-vectors.json
const V = {"note": "staffPhoneMatchHash vectors (contracts 1.13.0). Clinic and Kiorex keep their own copy and prove it against these.", "secret": "test-client-secret", "cases": [{"phone": "+201012345678", "hash": "T9e7BhRP1IaQR8d9lU2fETnWT1pB-2n5qEONQExcOQU"}, {"phone": "01012345678", "hash": "T9e7BhRP1IaQR8d9lU2fETnWT1pB-2n5qEONQExcOQU"}, {"phone": "0020 101 234 5678", "hash": "T9e7BhRP1IaQR8d9lU2fETnWT1pB-2n5qEONQExcOQU"}, {"phone": "+20 (10) 1234-5678", "hash": "T9e7BhRP1IaQR8d9lU2fETnWT1pB-2n5qEONQExcOQU"}, {"phone": "12345", "hash": "7CsPbi1_Ly0BYTzEvKDDVxAGf6oKTdDi8CFmLjK_M8Y"}]} as { secret: string; cases: { phone: string; hash: string }[] };

describe('staff phone match (RF_PROVIDER_COLLUSION)', () => {
  it('hash equals the contracts vectors', () => { for (const c of V.cases) expect(staffPhoneMatchHash(c.phone, V.secret)).toBe(c.hash); });
  it('asks the Clinic and returns its boolean', async () => {
    const calls: unknown[] = []; const k: any = { staffPhoneMatch: async (...a: unknown[]) => { calls.push(a); return { data: { match: true } }; } };
    expect(await new ClinicStaffPhoneMatch(k).matches('c1', ['a', 'a', 'b'])).toBe(true);
    expect(calls).toEqual([['c1', ['a', 'b']]]);
  });
  it('any failure or an empty list answers no match and never throws', async () => {
    const bad: any = { staffPhoneMatch: async () => { throw new Error('down'); } };
    expect(await new ClinicStaffPhoneMatch(bad).matches('c1', ['a'])).toBe(false);
    expect(await new ClinicStaffPhoneMatch(bad).matches('c1', [])).toBe(false);
    expect(await new ClinicStaffPhoneMatch(undefined).matches('c1', ['a'])).toBe(false);
  });
});
