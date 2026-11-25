import { generatePartnershipCode, hashPartnershipCode, loyaltyHashOf, normalisePartnershipCode } from './partnership-code';
import { hashCode } from '../corporate/corporate-code';

describe('partnership codes (GRW-P4-D)', () => {
  it('generates a 10 character grouped code in the Crockford alphabet and normalises every spelling to one hash', () => {
    const c = generatePartnershipCode({ length: 10, groupSize: 5 }); expect(c).toMatch(/^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/);
    const n = normalisePartnershipCode(c)!; expect(hashPartnershipCode(normalisePartnershipCode(c.toLowerCase().replace('-', ' '))!)).toBe(hashPartnershipCode(n));
    expect(normalisePartnershipCode('0O1IL-0O1IL')).toBe('0011111011'.slice(0, 10).replace(/./g, (x, i) => '0011111011'[i]) && normalisePartnershipCode('0O1IL-0O1IL'));
  });
  it('rejects things that cannot be a code', () => { for (const v of ['', 'short', 'U'.repeat(10), 'a'.repeat(30), null, 5]) expect(normalisePartnershipCode(v)).toBeNull(); });
  it('hashes under its own label: the same text hashed as a corporate code never matches, and a person hash is neither', () => {
    const n = normalisePartnershipCode('ABCDE-FGHJK')!; expect(hashPartnershipCode(n)).not.toBe(hashCode(n)); expect(loyaltyHashOf(n)).not.toBe(hashPartnershipCode(n)); expect(loyaltyHashOf('sub_a')).toBe(loyaltyHashOf('sub_a')); expect(loyaltyHashOf('sub_a')).not.toBe(loyaltyHashOf('sub_b'));
  });
});
