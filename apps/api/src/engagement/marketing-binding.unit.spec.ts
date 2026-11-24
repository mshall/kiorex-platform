import { createPlatformRegistry, consentPurposeOf, PlatformPreferenceStore, platformTemplate, templateClassView } from './notification.layer';
import { MESSAGE_CLASSES } from './message-class';
import { messageClassOf, TEMPLATES, type NotifyKind } from './templates';

/** GRW-P1-I: a template is bound to exactly one purpose at definition time; marketing can never ride another purpose, and the consent gate cannot be skipped. */
describe('template to purpose binding', () => {
  it('every shipped template is bound to ONE purpose; only the three lifecycle marketing templates are MARKETING, all with copy review PENDING (copy and licence are NEEDS_HUMAN)', () => {
    const r = createPlatformRegistry();
    const marketing: string[] = [];
    for (const [kind, t] of Object.entries(TEMPLATES) as [NotifyKind, (typeof TEMPLATES)[NotifyKind]][]) {
      expect(r.get(kind)!.purpose).toBe(t.marketing ? 'MARKETING' : t.reminder ? 'REMINDER' : 'TRANSACTIONAL');
      if (t.marketing) { marketing.push(kind); expect(t.copyReview).toBe('PENDING'); }
    }
    expect(marketing.sort()).toEqual(['FAMILY_ONBOARDING', 'REENGAGE_DORMANT', 'REFERRAL_NUDGE']);
  });
  it('AD-6 class view: exactly four classes; the class of a template agrees with its purpose (MARKETING <=> marketing purpose); a non-marketing template never carries promotional content', () => {
    expect([...MESSAGE_CLASSES]).toEqual(['TRANSACTIONAL', 'SECURITY', 'CLINICAL', 'MARKETING']);
    for (const v of templateClassView()) {
      expect(MESSAGE_CLASSES).toContain(v.messageClass);
      expect(v.messageClass === 'MARKETING').toBe(v.purpose === 'MARKETING');
      if (v.messageClass !== 'MARKETING') expect(v.promotional).toBe(false);
      if (v.messageClass === 'SECURITY' || v.messageClass === 'CLINICAL') expect(v.purpose).not.toBe('MARKETING');
    }
    expect(messageClassOf('NEW_DEVICE_NOTICE')).toBe('SECURITY');
    expect(messageClassOf('LAB_RESULT_RELEASED')).toBe('CLINICAL');
    expect(messageClassOf('BOOKING_CONFIRMED')).toBe('TRANSACTIONAL');
    expect(messageClassOf('REMINDER_24H')).toBe('TRANSACTIONAL'); // the REMINDER purpose maps to the TRANSACTIONAL class
    expect(messageClassOf('REWARD_EXPIRING')).toBe('TRANSACTIONAL'); // plain text, no promotion
    expect(messageClassOf('REENGAGE_DORMANT')).toBe('MARKETING');
  });
  it('a TRANSACTIONAL template cannot carry the promotional flag, and a MARKETING template without the flag is a definition error', () => {
    for (const [kind, t] of Object.entries(TEMPLATES) as [NotifyKind, (typeof TEMPLATES)[NotifyKind]][]) {
      if (messageClassOf(kind) !== 'MARKETING') expect(t.promotional ?? false).toBe(false);
      else expect(t.promotional).toBe(true);
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
