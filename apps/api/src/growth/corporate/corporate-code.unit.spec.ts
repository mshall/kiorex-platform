import { CODE_ALPHABET, emailDomain, formatCode, generateCode, hashCode, hrKeyHash, memberHashOf, normaliseCode } from './corporate-code';

describe('corporate codes (GRW-P4-C)', () => {
  it('generates only Crockford characters, of the configured length, with display grouping', () => {
    for (let i = 0; i < 200; i++) {
      const c = generateCode({ length: 10, groupSize: 5 });
      expect(c).toMatch(/^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/);
      expect(normaliseCode(c)).toHaveLength(10);
    }
    expect(generateCode({ length: 12, groupSize: 0 })).toMatch(/^[0-9A-HJKMNP-TV-Z]{12}$/);
    expect(CODE_ALPHABET).not.toMatch(/[ILOU]/);
    expect(() => generateCode({ length: 7, groupSize: 0 })).toThrow(RangeError);
    expect(() => generateCode({ length: 17, groupSize: 0 })).toThrow(RangeError);
  });
  it('is deterministic under an injected random source and never repeats in 5,000 draws', () => {
    let n = 0; const rnd = (m: number) => (n++ * 7) % m;
    expect(generateCode({ length: 8, groupSize: 4 }, rnd)).toBe('0789-ABCD'.replace('0789-ABCD', formatCode(Array.from({ length: 8 }, (_, i) => CODE_ALPHABET[(i * 7) % 32]).join(''), 4)));
    const seen = new Set<string>(); for (let i = 0; i < 5000; i++) seen.add(generateCode({ length: 10, groupSize: 0 }));
    expect(seen.size).toBe(5000);
  });
  it('every spelling of one code maps to one hash (case, hyphens, spaces, look-alikes) and a different code never does', () => {
    const base = 'A7KQ2-M9X0T';
    const h = hashCode(normaliseCode(base)!);
    for (const v of ['a7kq2-m9x0t', 'A7KQ2M9X0T', ' A7KQ2 M9X0T ', 'a7kq2_m9xot', 'A7KQ2-M9XOT', 'A7KQ2.M9X0T']) expect(hashCode(normaliseCode(v)!)).toBe(h);
    expect(hashCode(normaliseCode('A7KQ2-M9X0V')!)).not.toBe(h);
    expect(h).not.toContain('A7KQ2');
  });
  it('rejects anything that cannot be a code', () => {
    for (const v of [undefined, null, 5, '', 'short', 'A7KQ2-M9X0T-EXTRA-LONG-THING', 'A7KQ2-M9X0U', 'A7KQ2-M9X0$', 'كود-الشركة-١٢٣٤٥']) expect(normaliseCode(v as never)).toBeNull();
  });
  it('hashes live under separate labels: the same text hashes differently as a code, a member and an HR key', () => {
    const t = 'ABCDEFGH12';
    expect(new Set([hashCode(t), memberHashOf(t), hrKeyHash(t)]).size).toBe(3);
  });
  it('HR keys ignore case, spaces and brackets of a phone number or e-mail', () => {
    expect(hrKeyHash('+20 (100) 000-0001')).toBe(hrKeyHash('+201000000001'));
    expect(hrKeyHash(' Sara@Acme.COM ')).toBe(hrKeyHash('sara@acme.com'));
  });
  it('emailDomain extracts a lower-case domain or null', () => {
    expect(emailDomain('Sara@Acme.com')).toBe('acme.com'); expect(emailDomain('x')).toBeNull(); expect(emailDomain(undefined)).toBeNull(); expect(emailDomain('a@b')).toBeNull();
  });
});
