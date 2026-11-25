"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WELCOME_JOURNEY = void 0;
exports.WELCOME_JOURNEY = {
    key: 'welcome', version: 1, trigger: 'REGISTERED', anchored: false, params: {},
    describe: { en: 'Welcome card after registration; a message only when registration asked for a confirmation.', ar: 'بطاقة ترحيب بعد التسجيل؛ ورسالة فقط إذا طلب التسجيل تأكيدًا.' },
    steps: [
        { step: 1, delayMinutes: 0, messageClass: 'TRANSACTIONAL', purpose: 'TRANSACTIONAL', channels: ['INAPP'], kind: 'WELCOME', stopOn: ['accountDeleted'] },
        { step: 2, delayMinutes: 0, messageClass: 'TRANSACTIONAL', purpose: 'TRANSACTIONAL', channels: ['WHATSAPP', 'SMS'], kind: 'WELCOME', stopOn: ['accountDeleted'], when: (a) => a.confirmationRequested === true },
    ],
};
//# sourceMappingURL=welcome.journey.js.map