import type { JourneyDef } from '../journey.types';

/**
 * 3. Reminders. The existing appointment reminders (24 h, 2 h) keep their path in engagement.service.ts; the journey layer records them as decisions (one decision log)
 * and adds the day-before follow-up when the deposit is still pending. The anchor time is the day before the visit.
 */
export const REMINDERS_JOURNEY: JourneyDef = {
  key: 'reminders', version: 1, trigger: 'RESERVATION_PENDING_DEPOSIT', anchored: true, params: { daysBefore: 1 },
  describe: { en: 'Day-before follow-up when a deposit is still pending; existing 24 h and 2 h reminders are recorded in the same decision log.', ar: 'متابعة قبل يوم إذا ظل العربون معلقًا؛ وتُسجَّل التذكيرات الحالية (24 و2 ساعة) في سجل القرارات نفسه.' },
  steps: [{ step: 1, delayMinutes: 0, messageClass: 'TRANSACTIONAL', purpose: 'REMINDER', channels: ['WHATSAPP', 'PUSH', 'SMS'], kind: 'DEPOSIT_PENDING_FOLLOWUP', stopOn: ['depositSettled', 'accountDeleted'] }],
};
