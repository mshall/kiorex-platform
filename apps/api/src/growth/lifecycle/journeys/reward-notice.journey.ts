import type { JourneyDef } from '../journey.types';

/**
 * 7. Rewards notifications: issued, redeemed and reversed are TRANSACTIONAL status messages; the one expiry notice (14 days before) is TRANSACTIONAL while its text is plain.
 * The step that applies is chosen by `anchor.event`; the anchor is the reward id, the anchor time is the event time (or expiry minus 14 days).
 */
const is = (e: string) => (a: Record<string, unknown>) => a.event === e;
export const REWARD_NOTICE_JOURNEY: JourneyDef = {
  key: 'reward-notice', version: 1, trigger: 'REWARD_EVENT', anchored: true, params: { expiryNoticeDays: 14 },
  describe: { en: 'Status messages when a reward is issued, redeemed, reversed, and one plain notice 14 days before it expires.', ar: 'رسائل حالة عند إصدار المكافأة أو استخدامها أو عكسها، وإشعار واحد بسيط قبل انتهائها بـ14 يومًا.' },
  steps: [
    { step: 1, delayMinutes: 0, messageClass: 'TRANSACTIONAL', purpose: 'TRANSACTIONAL', channels: ['INAPP', 'PUSH', 'WHATSAPP'], kind: 'REWARD_ISSUED', stopOn: ['accountDeleted'], when: is('ISSUED') },
    { step: 2, delayMinutes: 0, messageClass: 'TRANSACTIONAL', purpose: 'TRANSACTIONAL', channels: ['INAPP', 'PUSH', 'WHATSAPP'], kind: 'REWARD_REDEEMED', stopOn: ['accountDeleted'], when: is('REDEEMED') },
    { step: 3, delayMinutes: 0, messageClass: 'TRANSACTIONAL', purpose: 'TRANSACTIONAL', channels: ['INAPP', 'PUSH', 'WHATSAPP'], kind: 'REWARD_REVERSED', stopOn: ['accountDeleted'], when: is('REVERSED') },
    { step: 4, delayMinutes: 0, messageClass: 'TRANSACTIONAL', purpose: 'TRANSACTIONAL', channels: ['INAPP', 'PUSH', 'WHATSAPP'], kind: 'REWARD_EXPIRING', stopOn: ['rewardClosed', 'accountDeleted'], when: is('EXPIRING') },
  ],
};
