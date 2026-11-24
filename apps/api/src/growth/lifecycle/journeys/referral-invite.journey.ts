import type { JourneyDef } from '../journey.types';

/** 6. Referral invitation: an in-app card after the first attended visit (no consent needed, nothing is sent); a push or WhatsApp nudge three days later is MARKETING. */
export const REFERRAL_INVITE_JOURNEY: JourneyDef = {
  key: 'referral-invite', version: 1, trigger: 'FIRST_ATTENDED', anchored: false, params: { nudgeAfterDays: 3 },
  describe: { en: 'In-app card after the first attended visit, then an optional nudge (marketing, consent needed).', ar: 'بطاقة داخل التطبيق بعد أول زيارة، ثم تنبيه اختياري (تسويقي ويحتاج موافقة).' },
  steps: [
    { step: 1, delayMinutes: 0, messageClass: 'TRANSACTIONAL', purpose: 'TRANSACTIONAL', channels: ['INAPP'], kind: 'REFERRAL_INVITE_CARD', stopOn: ['accountDeleted'] },
    { step: 2, delayMinutes: 3 * 24 * 60, messageClass: 'MARKETING', purpose: 'MARKETING', channels: ['PUSH', 'WHATSAPP'], kind: 'REFERRAL_NUDGE', stopOn: ['MARKETING_CONSENT_LOST', 'accountDeleted'] },
  ],
};
