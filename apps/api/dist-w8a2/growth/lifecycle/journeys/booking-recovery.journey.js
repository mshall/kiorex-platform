"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BOOKING_RECOVERY_JOURNEY = void 0;
exports.BOOKING_RECOVERY_JOURNEY = {
    key: 'booking-recovery', version: 1, trigger: 'HOLD_EXPIRED', anchored: true, params: { nudgeAfterMinutes: 45 },
    describe: { en: 'One reminder 45 minutes after a booking request expired unconfirmed. Stops when the person books.', ar: 'تذكير واحد بعد 45 دقيقة من انتهاء طلب حجز دون تأكيد. يتوقف عند الحجز.' },
    steps: [{ step: 1, delayMinutes: 45, messageClass: 'TRANSACTIONAL', purpose: 'REMINDER', channels: ['WHATSAPP', 'PUSH', 'SMS'], kind: 'BOOKING_RECOVERY', stopOn: ['bookedAfterAnchor', 'accountDeleted'] }],
};
//# sourceMappingURL=booking-recovery.journey.js.map