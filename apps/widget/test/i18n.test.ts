import { describe, expect, it } from 'vitest';
import { dayKey, fmtClock, fmtMoney, fmtTime } from '../src/app/format';
import { STRINGS, t } from '../src/app/i18n';

describe('widget strings and formatting', () => {
  it('Arabic and English have exactly the same keys and no empty value', () => {
    expect(Object.keys(STRINGS.ar).sort()).toEqual(Object.keys(STRINGS.en).sort());
    for (const l of ['ar', 'en'] as const) for (const [k, v] of Object.entries(STRINGS[l])) expect(v.trim().length, `${l}.${k}`).toBeGreaterThan(0);
    expect(t('ar', 'nope')).toBe('nope');
  });
  it('Arabic strings contain Arabic script, English strings do not', () => {
    for (const k of ['title', 'confirm', 'noSlots']) { expect(STRINGS.ar[k]).toMatch(/[؀-ۿ]/); expect(STRINGS.en[k]).not.toMatch(/[؀-ۿ]/); }
  });
  it('slots are grouped and shown in the clinic time zone, not the browser zone', () => {
    const iso = '2026-12-01T22:30:00.000Z'; // 00:30 on 2 Dec in Cairo (UTC+2)
    expect(dayKey(iso, 'Africa/Cairo')).toBe('2026-12-02');
    expect(dayKey(iso, 'UTC')).toBe('2026-12-01');
    expect(fmtTime(iso, 'en', 'Africa/Cairo')).toBe('00:30');
  });
  it('money is whole major units with the currency; the countdown is mm:ss', () => {
    expect(fmtMoney(30000, 'EGP', 'en')).toBe('300 EGP');
    expect(fmtMoney(30000, 'EGP', 'ar')).toContain('ج.م');
    expect(fmtClock(299)).toBe('04:59'); expect(fmtClock(0)).toBe('00:00');
  });
});
