import type { JourneyDef } from '../journey.types';

/** 4. Post-visit feedback: the review invitation (T+2h) stays TRANSACTIONAL in engagement.service.ts; this journey adds ONE reminder after 48 hours, only if no review was left. */
export const POST_VISIT_JOURNEY: JourneyDef = {
  key: 'post-visit', version: 1, trigger: 'VISIT_COMPLETED', anchored: true, params: { reminderAfterHours: 48 },
  describe: { en: 'One feedback reminder 48 hours after a visit if no review was left.', ar: 'تذكير واحد بالتقييم بعد 48 ساعة من الزيارة إذا لم يُترك تقييم.' },
  steps: [{ step: 1, delayMinutes: 48 * 60, messageClass: 'TRANSACTIONAL', purpose: 'REMINDER', channels: ['PUSH', 'WHATSAPP'], kind: 'FEEDBACK_REMINDER', stopOn: ['reviewedAnchor', 'accountDeleted'] }],
};
