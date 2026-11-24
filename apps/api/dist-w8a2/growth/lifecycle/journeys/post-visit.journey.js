"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.POST_VISIT_JOURNEY = void 0;
exports.POST_VISIT_JOURNEY = {
    key: 'post-visit', version: 1, trigger: 'VISIT_COMPLETED', anchored: true, params: { reminderAfterHours: 48 },
    describe: { en: 'One feedback reminder 48 hours after a visit if no review was left.', ar: 'تذكير واحد بالتقييم بعد 48 ساعة من الزيارة إذا لم يُترك تقييم.' },
    steps: [{ step: 1, delayMinutes: 48 * 60, messageClass: 'TRANSACTIONAL', purpose: 'REMINDER', channels: ['PUSH', 'WHATSAPP'], kind: 'FEEDBACK_REMINDER', stopOn: ['reviewedAnchor', 'accountDeleted'] }],
};
//# sourceMappingURL=post-visit.journey.js.map