import { isBase64Text } from './records.service';

describe('isBase64Text (replaces a whole-string regex that overflowed the regexp stack on 3-5 MB uploads)', () => {
  it('accepts base64 with padding and whitespace, rejects everything else', () => {
    expect(isBase64Text('QUJD')).toBe(true);
    expect(isBase64Text('QUJD\nREVG ')).toBe(true);
    expect(isBase64Text('QQ==')).toBe(true);
    expect(isBase64Text('')).toBe(false);
    expect(isBase64Text(undefined)).toBe(false);
    expect(isBase64Text(5)).toBe(false);
    expect(isBase64Text('not base64!')).toBe(false);
    expect(isBase64Text('QUJD\u0000')).toBe(false);
    expect(isBase64Text('<script>')).toBe(false);
  });
  it('handles an 8 MB string without throwing (the old regex threw RangeError: Maximum call stack size exceeded)', () => {
    const big = Buffer.alloc(6 * 1024 * 1024, 7).toString('base64');
    expect(big.length).toBeGreaterThan(8_000_000);
    expect(isBase64Text(big)).toBe(true);
    expect(isBase64Text(big + '!')).toBe(false);
  });
});
