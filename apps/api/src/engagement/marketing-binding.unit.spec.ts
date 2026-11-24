import { createPlatformRegistry, consentPurposeOf, PlatformPreferenceStore, platformTemplate } from './notification.layer';
import { TEMPLATES, type NotifyKind } from './templates';

/** GRW-P1-I: a template is bound to exactly one purpose at definition time; marketing can never ride another purpose, and the consent gate cannot be skipped. */
describe('template to purpose binding', () => {
  it('every shipped template is bound to TRANSACTIONAL or REMINDER; none is MARKETING (copy and licence are NEEDS_HUMAN)', () => {
    const r = createPlatformRegistry();
    for (const [kind, t] of Object.entries(TEMPLATES) as [NotifyKind, (typeof TEMPLATES)[NotifyKind]][]) {
      expect(r.get(kind)!.purpose).toBe(t.reminder ? 'REMINDER' : 'TRANSACTIONAL');
      expect(t.marketing ?? false).toBe(false);
    }
  });
  it('a marketing template is bound to MARKETING and to nothing else, whatever its reminder flag says', () => {
    const t = { templateId: 'TODO_NEEDS_HUMAN_x', reminder: true, marketing: true, en: 'Offer {x}', ar: 'عرض {x}' };
    expect(platformTemplate('PROMO_X' as NotifyKind, t).purpose).toBe('MARKETING');
    expect(platformTemplate('PROMO_X' as NotifyKind, { ...t, marketing: false }).purpose).toBe('REMINDER');
  });
  it('consent keys: reminders need REMINDERS, service messages MARKETPLACE_PROCESSING, marketing its own per-channel consent (in-app rides push)', () => {
    expect(consentPurposeOf('REMINDER')).toBe('REMINDERS');
    expect(consentPurposeOf('TRANSACTIONAL')).toBe('MARKETPLACE_PROCESSING');
    expect(consentPurposeOf('MARKETING', 'WHATSAPP')).toBe('MARKETING_WHATSAPP');
    expect(consentPurposeOf('MARKETING', 'SMS')).toBe('MARKETING_SMS');
    expect(consentPurposeOf('MARKETING', 'INAPP')).toBe('MARKETING_PUSH');
    expect(consentPurposeOf('SECURITY')).toBe('MARKETPLACE_PROCESSING');
  });
});

describe('PlatformPreferenceStore marketing denial', () => {
  const base = { hasConsent: async () => true, preference: async () => null };
  it('marketing is denied when the marketing dependency is absent, even with every consent granted', async () => {
    expect(await new PlatformPreferenceStore(base).get('s', { channel: 'WHATSAPP', purpose: 'MARKETING' })).toMatchObject({ consent: false });
  });
  it('denied when the flag is off; opted-out when suppressed; allowed only with flag, consent and no suppression', async () => {
    const mk = (m: Partial<{ enabled: boolean; suppressed: boolean; consent: boolean }>) => new PlatformPreferenceStore({ ...base, hasConsent: async () => m.consent ?? true, marketing: { enabled: async () => m.enabled ?? true, suppressed: async () => m.suppressed ?? false, defaultQuiet: async () => ({ startHour: 21, endHour: 9, tzOffsetMinutes: 120 }) } });
    const ctx = { channel: 'SMS', purpose: 'MARKETING' } as const;
    expect(await mk({ enabled: false }).get('s', ctx)).toMatchObject({ consent: false });
    expect(await mk({ suppressed: true }).get('s', ctx)).toMatchObject({ consent: true, optedOut: true });
    expect(await mk({ consent: false }).get('s', ctx)).toMatchObject({ consent: false });
    expect(await mk({}).get('s', ctx)).toMatchObject({ consent: true, optedOut: false, quiet: { startHour: 21, endHour: 9 } });
  });
  it('service messages never consult the marketing dependency', async () => {
    let asked = 0;
    const s = new PlatformPreferenceStore({ ...base, marketing: { enabled: async () => { asked++; return false; }, suppressed: async () => { asked++; return true; }, defaultQuiet: async () => { asked++; return { startHour: 0, endHour: 1, tzOffsetMinutes: 0 }; } } });
    expect(await s.get('s', { channel: 'WHATSAPP', purpose: 'TRANSACTIONAL' })).toMatchObject({ consent: true, optedOut: false });
    expect(await s.get('s', { channel: 'SMS', purpose: 'REMINDER' })).toMatchObject({ consent: true });
    expect(asked).toBe(0);
  });
});
