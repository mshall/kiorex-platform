import { containsNul, RejectNulBytesPipe } from './reject-nul-bytes.pipe';

/** EDGE 48: U+0000 can never be stored by PostgreSQL text columns; it is refused with a 400 before it reaches the database. */
describe('NUL bytes never reach PostgreSQL', () => {
  it('finds U+0000 in strings, nested objects, arrays and keys, and nothing else', () => {
    expect(containsNul('a\u0000b')).toBe(true);
    expect(containsNul({ a: [{ b: 'x\u0000' }] })).toBe(true);
    expect(containsNul({ 'k\u0000': 1 })).toBe(true);
    for (const ok of ['', 'abc', '🙂​‮', 'ملاحظة ١٢٣', 5, null, undefined, [1, 'a'], { a: { b: [true] } }, Buffer.from([0, 1])]) expect(containsNul(ok)).toBe(false);
  });
  it('the pipe answers 400 INVALID_CHARACTER for query, param and body, and ignores custom decorators', () => {
    const pipe = new RejectNulBytesPipe();
    for (const type of ['query', 'param', 'body'] as const) expect(() => pipe.transform('x\u0000', { type })).toThrow(expect.objectContaining({ status: 400 }));
    expect(pipe.transform('clean', { type: 'query' })).toBe('clean');
    expect(pipe.transform('x\u0000', { type: 'custom' })).toBe('x\u0000');
  });
});
