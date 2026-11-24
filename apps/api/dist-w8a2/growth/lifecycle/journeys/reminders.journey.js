"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.REMINDERS_JOURNEY = void 0;
exports.REMINDERS_JOURNEY = {
    key: 'reminders', version: 1, trigger: 'RESERVATION_PENDING_DEPOSIT', anchored: true, params: { daysBefore: 1 },
    describe: { en: 'Day-before follow-up when a deposit is still pending; existing 24 h and 2 h reminders are recorded in the same decision log.', ar: 'متابعة قبل يوم إذا ظل العربون معلقًا؛ وتُسجَّل التذكيرات الحالية (24 و2 ساعة) في سجل القرارات نفسه.' },
    steps: [{ step: 1, delayMinutes: 0, messageClass: 'TRANSACTIONAL', purpose: 'REMINDER', channels: ['WHATSAPP', 'PUSH', 'SMS'], kind: 'DEPOSIT_PENDING_FOLLOWUP', stopOn: ['depositSettled', 'accountDeleted'] }],
};
//# sourceMappingURL=reminders.journey.js.map