import type { JourneyDef } from '../journey.types';

/** 1. Welcome: one in-app card; a message only if registration itself asked for a confirmation (TRANSACTIONAL). Never marketing. */
export const WELCOME_JOURNEY: JourneyDef = {
  key: 'welcome', version: 1, trigger: 'REGISTERED', anchored: false, params: {},
  describe: { en: 'Welcome card after registration; a message only when registration asked for a confirmation.', ar: 'بطاقة ترحيب بعد التسجيل؛ ورسالة فقط إذا طلب التسجيل تأكيدًا.' },
  steps: [
    { step: 1, delayMinutes: 0, messageClass: 'TRANSACTIONAL', purpose: 'TRANSACTIONAL', channels: ['INAPP'], kind: 'WELCOME', stopOn: ['accountDeleted'] },
    { step: 2, delayMinutes: 0, messageClass: 'TRANSACTIONAL', purpose: 'TRANSACTIONAL', channels: ['WHATSAPP', 'SMS'], kind: 'WELCOME', stopOn: ['accountDeleted'], when: (a) => a.confirmationRequested === true },
  ],
};
