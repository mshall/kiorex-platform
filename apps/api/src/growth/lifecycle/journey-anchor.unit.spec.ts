import { anchorPrefix, decodeAnchor, encodeAnchor } from './journey-anchor';

describe('journey anchors', () => {
  it('round trips id, time and parameters; the same anchor is the same key (idempotency)', () => {
    const a = { id: 'kx_bk_1', at: 1_800_000_000_000, params: { event: 'ISSUED' } };
    const k = encodeAnchor('reward-notice', a);
    expect(k).toBe(encodeAnchor('reward-notice', a));
    expect(decodeAnchor(k)).toEqual({ key: 'reward-notice', anchor: a });
    expect(k.startsWith(anchorPrefix('reward-notice', 'kx_bk_1'))).toBe(true);
  });
  it('a plain journey key has no anchor; a broken anchor decodes to none, never throws', () => {
    expect(decodeAnchor('welcome')).toEqual({ key: 'welcome', anchor: null });
    expect(decodeAnchor('welcome#abc.!!!').anchor).toBeNull();
  });
  it('rejects ids that could smuggle separators or free text', () => {
    for (const id of ['a b', 'a#b', 'x'.repeat(81), '', 'Dr. Ahmed/cardiology']) expect(() => encodeAnchor('k', { id, at: 0, params: {} })).toThrow();
  });
});
