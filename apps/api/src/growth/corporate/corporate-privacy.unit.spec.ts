import { effectiveK, K_FLOOR, looksPersonal, maskBreakdown, maskCount, maskTotal } from './corporate-privacy';

describe('corporate privacy rules (GRW-P4-C)', () => {
  it('the aggregate floor is 10 and cannot be configured below it', () => { expect(K_FLOOR).toBe(10); expect(effectiveK(3)).toBe(10); expect(effectiveK(undefined)).toBe(10); expect(effectiveK(25)).toBe(25); });
  it('counts below k are masked, zero stays zero, k itself is shown', () => {
    expect(maskCount(9)).toBeNull(); expect(maskCount(1)).toBeNull(); expect(maskCount(0)).toBe(0); expect(maskCount(10)).toBe(10); expect(maskCount(24, 25)).toBeNull(); expect(maskCount(25, 25)).toBe(25);
  });
  it('a configured k below 10 is ignored: 9 is never shown', () => expect(maskCount(9, 5)).toBeNull());
  it('a money total is shown only when the group that made it reaches k', () => { expect(maskTotal(5000, 9)).toBeNull(); expect(maskTotal(5000, 10)).toBe(5000); expect(maskTotal(0, 0)).toBe(0); });
  it('a breakdown with exactly one hidden cell also hides the smallest visible one (no subtraction)', () => {
    expect(maskBreakdown({ A: 40, B: 12, C: 4 })).toEqual({ A: 40, B: null, C: null });
    expect(maskBreakdown({ A: 40, B: 12, C: 0 })).toEqual({ A: 40, B: 12, C: 0 });
    expect(maskBreakdown({ A: 40, B: 3, C: 2 })).toEqual({ A: 40, B: null, C: null });
    expect(maskBreakdown({ A: 5, B: 5, C: 5 })).toEqual({ A: null, B: null, C: null });
  });
  it('property: no visible number is ever below 10 and no single hidden cell is recoverable', () => {
    let s = 99; const r = (n: number) => { s = (s * 48271) % 2147483647; return s % n; };
    for (let i = 0; i < 1000; i++) {
      const cells = { A: r(40), B: r(40), C: r(40) } as Record<'A' | 'B' | 'C', number>;
      const m = maskBreakdown(cells); const hidden = Object.values(m).filter((v, ix) => v === null && Object.values(cells)[ix] > 0).length;
      for (const [k, v] of Object.entries(m)) if (v !== null) { expect(v === 0 || v >= 10).toBe(true); expect(v).toBe(cells[k as 'A']); }
      // exactly one hidden cell is only acceptable when it is the ONLY positive cell (its sum is then below k and itself masked by the caller)
      if (hidden === 1) expect(Object.values(cells).filter((v) => v > 0).length).toBe(1);
    }
  });
  it('company text that looks like a person contact is refused (e-mail, phone, national id, Arabic-Indic digits)', () => {
    for (const t of ['write to sara@acme.com', 'call +20 100 000 0001', '01000000001', '29004020101234', 'اتصل ٠١٠٠٠٠٠٠٠٠١', 'ph 0100-000-0001']) expect(looksPersonal(t)).toBe(true);
    for (const t of ['Nile Logistics', 'Acme 2027 renewal, 200 staff', 'شركة النيل للخدمات', 'Floor 4, 120 employees']) expect(looksPersonal(t)).toBe(false);
  });
});
