import { describe, expect, it } from 'vitest';
import { acceptFrom, parseToParent, parseToWidget } from '../src/shared/protocol';

describe('postMessage protocol validation (GRW-P1-G)', () => {
  it('accepts exactly the four widget-to-page messages with their shapes', () => {
    expect(parseToParent({ kx: 1, type: 'kx:ready' })).toEqual({ kx: 1, type: 'kx:ready' });
    expect(parseToParent({ kx: 1, type: 'kx:resize', height: 480.2 })).toEqual({ kx: 1, type: 'kx:resize', height: 481 });
    expect(parseToParent({ kx: 1, type: 'kx:booked', status: 'CONFIRMED', bookingRef: 'kx_bk_abc123' })).toEqual({ kx: 1, type: 'kx:booked', status: 'CONFIRMED', bookingRef: 'kx_bk_abc123' });
    expect(parseToParent({ kx: 1, type: 'kx:error', code: 'GROWTH_WIDGET_ORIGIN_NOT_ALLOWED' })).toEqual({ kx: 1, type: 'kx:error', code: 'GROWTH_WIDGET_ORIGIN_NOT_ALLOWED' });
  });
  it('drops everything else: wrong version, unknown type, bad numbers, bad characters, arrays, primitives, extra PHI-shaped fields are not copied', () => {
    const bad: unknown[] = [null, undefined, 1, 'x', [], {}, { kx: 2, type: 'kx:ready' }, { kx: 1 }, { kx: 1, type: 'kx:other' }, { kx: 1, type: 'kx:resize', height: -1 }, { kx: 1, type: 'kx:resize', height: 99999 }, { kx: 1, type: 'kx:resize', height: NaN }, { kx: 1, type: 'kx:resize', height: '480' },
      { kx: 1, type: 'kx:booked', status: 'confirmed', bookingRef: 'x' }, { kx: 1, type: 'kx:booked', status: 'CONFIRMED', bookingRef: '<script>' }, { kx: 1, type: 'kx:booked', status: 'CONFIRMED' }, { kx: 1, type: 'kx:error', code: 'lower case' }];
    for (const b of bad) expect(parseToParent(b)).toBeNull();
    const withExtra = parseToParent({ kx: 1, type: 'kx:booked', status: 'CONFIRMED', bookingRef: 'abc', patientName: 'Amira', phone: '+201000000001' });
    expect(withExtra).toEqual({ kx: 1, type: 'kx:booked', status: 'CONFIRMED', bookingRef: 'abc' });
  });
  it('init message: optional lt, ref, locale validated; anything malformed rejects the whole message', () => {
    expect(parseToWidget({ kx: 1, type: 'kx:init' })).toEqual({ kx: 1, type: 'kx:init' });
    expect(parseToWidget({ kx: 1, type: 'kx:init', lt: 'kx-lt1.abc_DEF-1.sig', ref: 'AB12cd', locale: 'ar' })).toMatchObject({ lt: 'kx-lt1.abc_DEF-1.sig', ref: 'AB12cd', locale: 'ar' });
    for (const b of [{ kx: 1, type: 'kx:init', lt: 'has space' }, { kx: 1, type: 'kx:init', lt: 'a'.repeat(600) }, { kx: 1, type: 'kx:init', locale: 'fr' }, { kx: 1, type: 'kx:init', ref: '<x>' }, { kx: 1, type: 'kx:ready' }]) expect(parseToWidget(b)).toBeNull();
  });
  it('acceptFrom needs the exact origin AND the exact source window: no wildcard, no suffix, no null origin', () => {
    const win = {}; const data = { a: 1 };
    expect(acceptFrom({ origin: 'https://book.kiorex.com', source: win, data }, 'https://book.kiorex.com', win)).toBe(data);
    for (const origin of ['https://evil.example', 'https://book.kiorex.com.evil.test', 'http://book.kiorex.com', 'null', '*', '']) expect(acceptFrom({ origin, source: win, data }, 'https://book.kiorex.com', win)).toBeUndefined();
    expect(acceptFrom({ origin: 'https://book.kiorex.com', source: {}, data }, 'https://book.kiorex.com', win)).toBeUndefined();
    expect(acceptFrom({ origin: 'https://book.kiorex.com', source: win, data }, null, win)).toBeUndefined();
    expect(acceptFrom({ origin: 'https://book.kiorex.com', source: null, data }, 'https://book.kiorex.com', null)).toBeUndefined();
  });
});
