import type { JourneyDef } from '../journey.types';

/** 8. Family onboarding: after a first attended visit an in-app card invites the person to add dependants; the follow-up message is MARKETING and consent-gated. Guardian evidence stays in Passport. */
export const FAMILY_ONBOARDING_JOURNEY: JourneyDef = {
  key: 'family-onboarding', version: 1, trigger: 'FIRST_ATTENDED', anchored: false, params: { followUpAfterDays: 7 },
  describe: { en: 'In-app prompt to add family members after a first visit, then an optional message (marketing, consent needed).', ar: 'دعوة داخل التطبيق لإضافة أفراد العائلة بعد أول زيارة، ثم رسالة اختيارية (تسويقية وتحتاج موافقة).' },
  steps: [
    { step: 1, delayMinutes: 0, messageClass: 'TRANSACTIONAL', purpose: 'TRANSACTIONAL', channels: ['INAPP'], kind: 'FAMILY_ONBOARDING_CARD', stopOn: ['dependantAdded', 'accountDeleted'] },
    { step: 2, delayMinutes: 7 * 24 * 60, messageClass: 'MARKETING', purpose: 'MARKETING', channels: ['PUSH', 'WHATSAPP'], kind: 'FAMILY_ONBOARDING', stopOn: ['dependantAdded', 'MARKETING_CONSENT_LOST', 'accountDeleted'] },
  ],
};
