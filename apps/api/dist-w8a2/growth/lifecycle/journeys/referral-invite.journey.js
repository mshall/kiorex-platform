"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.REFERRAL_INVITE_JOURNEY = void 0;
exports.REFERRAL_INVITE_JOURNEY = {
    key: 'referral-invite', version: 1, trigger: 'FIRST_ATTENDED', anchored: false, params: { nudgeAfterDays: 3 },
    describe: { en: 'In-app card after the first attended visit, then an optional nudge (marketing, consent needed).', ar: 'بطاقة داخل التطبيق بعد أول زيارة، ثم تنبيه اختياري (تسويقي ويحتاج موافقة).' },
    steps: [
        { step: 1, delayMinutes: 0, messageClass: 'TRANSACTIONAL', purpose: 'TRANSACTIONAL', channels: ['INAPP'], kind: 'REFERRAL_INVITE_CARD', stopOn: ['accountDeleted'] },
        { step: 2, delayMinutes: 3 * 24 * 60, messageClass: 'MARKETING', purpose: 'MARKETING', channels: ['PUSH', 'WHATSAPP'], kind: 'REFERRAL_NUDGE', stopOn: ['MARKETING_CONSENT_LOST', 'accountDeleted'] },
    ],
};
//# sourceMappingURL=referral-invite.journey.js.map