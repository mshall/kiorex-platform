"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.REENGAGEMENT_JOURNEY = void 0;
exports.REENGAGEMENT_JOURNEY = {
    key: 'reengagement', version: 1, trigger: 'STAGE_DORMANT', anchored: true, params: { maxPer90Days: 2, windowDays: 90 },
    describe: { en: 'A generic "we miss you" message to dormant people who agreed to marketing. At most 2 per 90 days, with a measurement holdout.', ar: 'رسالة عامة للأشخاص غير النشطين الذين وافقوا على الرسائل التسويقية. حدّ أقصى رسالتان كل 90 يومًا مع شريحة قياس.' },
    steps: [
        { step: 1, delayMinutes: 0, messageClass: 'MARKETING', purpose: 'MARKETING', channels: ['PUSH', 'WHATSAPP', 'SMS', 'EMAIL'], kind: 'REENGAGE_DORMANT', stopOn: ['bookedAfterAnchor', 'leftDormant', 'MARKETING_CONSENT_LOST', 'accountDeleted'] },
        { step: 2, delayMinutes: 30 * 24 * 60, messageClass: 'MARKETING', purpose: 'MARKETING', channels: ['PUSH', 'WHATSAPP', 'SMS', 'EMAIL'], kind: 'REENGAGE_DORMANT', stopOn: ['bookedAfterAnchor', 'leftDormant', 'MARKETING_CONSENT_LOST', 'accountDeleted'] },
    ],
};
//# sourceMappingURL=reengagement.journey.js.map