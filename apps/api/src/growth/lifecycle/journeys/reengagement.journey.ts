import type { JourneyDef } from '../journey.types';

/**
 * 5. Re-engagement: MARKETING. Needs the channel's marketing consent, the DORMANT stage, at most 2 per rolling 90 days, a holdout slice for measurement (default 500 bps in
 * policy terms is 5 percent; the shipped default is 0 until the founder sets it), generic content (no specialty, no provider) and `growth.marketing_messaging` ON.
 */
export const REENGAGEMENT_JOURNEY: JourneyDef = {
  key: 'reengagement', version: 1, trigger: 'STAGE_DORMANT', anchored: true, params: { maxPer90Days: 2, windowDays: 90 },
  describe: { en: 'A generic "we miss you" message to dormant people who agreed to marketing. At most 2 per 90 days, with a measurement holdout.', ar: 'رسالة عامة للأشخاص غير النشطين الذين وافقوا على الرسائل التسويقية. حدّ أقصى رسالتان كل 90 يومًا مع شريحة قياس.' },
  steps: [
    { step: 1, delayMinutes: 0, messageClass: 'MARKETING', purpose: 'MARKETING', channels: ['PUSH', 'WHATSAPP', 'SMS', 'EMAIL'], kind: 'REENGAGE_DORMANT', stopOn: ['bookedAfterAnchor', 'leftDormant', 'MARKETING_CONSENT_LOST', 'accountDeleted'] },
    { step: 2, delayMinutes: 30 * 24 * 60, messageClass: 'MARKETING', purpose: 'MARKETING', channels: ['PUSH', 'WHATSAPP', 'SMS', 'EMAIL'], kind: 'REENGAGE_DORMANT', stopOn: ['bookedAfterAnchor', 'leftDormant', 'MARKETING_CONSENT_LOST', 'accountDeleted'] },
  ],
};
