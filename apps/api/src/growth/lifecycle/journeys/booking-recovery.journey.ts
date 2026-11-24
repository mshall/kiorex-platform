import type { JourneyDef } from '../journey.types';

/**
 * 2. Incomplete booking recovery: a hold expired without a confirmation. One nudge at +45 minutes, needs the REMINDERS consent, none after, stops the moment the person
 * books. The text says "your booking request" and never names a specialty or a doctor.
 */
export const BOOKING_RECOVERY_JOURNEY: JourneyDef = {
  key: 'booking-recovery', version: 1, trigger: 'HOLD_EXPIRED', anchored: true, params: { nudgeAfterMinutes: 45 },
  describe: { en: 'One reminder 45 minutes after a booking request expired unconfirmed. Stops when the person books.', ar: 'تذكير واحد بعد 45 دقيقة من انتهاء طلب حجز دون تأكيد. يتوقف عند الحجز.' },
  steps: [{ step: 1, delayMinutes: 45, messageClass: 'TRANSACTIONAL', purpose: 'REMINDER', channels: ['WHATSAPP', 'PUSH', 'SMS'], kind: 'BOOKING_RECOVERY', stopOn: ['bookedAfterAnchor', 'accountDeleted'] }],
};
