"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EMERGENCY_GUIDANCE = exports.EMERGENCY_NUMBER = void 0;
exports.detectEmergency = detectEmergency;
const text_1 = require("./text");
exports.EMERGENCY_NUMBER = '123';
const TERMS = {
    CHEST_PAIN: ['chest pain', 'heart attack', 'crushing chest', 'الم في الصدر', 'الم الصدر', 'نوبه قلبيه', 'جلطه في القلب', 'الم شديد في الصدر', 'وجع في الصدر', 'وجع الصدر', 'وجع شديد في الصدر', 'الم شديد في القلب'],
    BREATHING: ['cant breathe', "can't breathe", 'cannot breathe', 'difficulty breathing', 'shortness of breath', 'choking', 'not breathing', 'stopped breathing', 'isnt breathing', 'trouble breathing', 'struggling to breathe', 'hard to breathe', 'ضيق في التنفس', 'ضيق تنفس', 'مش قادر اتنفس', 'اختناق', 'مش قادر يتنفس', 'مش قادره تتنفس', 'مش بيتنفس', 'مش بتتنفس', 'توقف التنفس', 'صعوبه في التنفس', 'صعوبه تنفس'],
    STROKE: ['stroke', 'face drooping', 'slurred speech', 'سكته دماغيه', 'جلطه في المخ', 'شلل مفاجئ'],
    CONSCIOUSNESS: ['unconscious', 'passed out', 'not responding', 'فقدان الوعي', 'اغماء', 'مغمي عليه', 'فاقد الوعي'],
    BLEEDING: ['severe bleeding', 'bleeding heavily', 'cant stop bleeding', 'نزيف شديد', 'نزيف حاد'],
    SEIZURE: ['seizure', 'convulsion', 'تشنجات', 'نوبه صرع'],
    POISONING: ['overdose', 'poisoning', 'swallowed poison', 'تسمم', 'جرعه زايده'],
    SELF_HARM: ['suicide', 'kill myself', 'want to die', 'انتحار', 'اقتل نفسي', 'عايز اموت'],
    ANAPHYLAXIS: ['anaphylaxis', 'throat swelling', 'severe allergic reaction', 'حساسيه شديده', 'تورم الحلق'],
};
const NORMALIZED = Object.entries(TERMS).map(([code, list]) => [code, list.map(text_1.normalizeText)]);
function detectEmergency(text) {
    if (!text)
        return { emergency: false, categories: [] };
    const n = ` ${(0, text_1.normalizeText)(text).replace(/[.,!?؟،]/g, ' ').replace(/\s+/g, ' ')} `;
    const categories = NORMALIZED.filter(([, list]) => list.some((t) => n.includes(` ${t.replace(/[.,!?؟،]/g, ' ')} `) || n.includes(t))).map(([c]) => c);
    return { emergency: categories.length > 0, categories };
}
exports.EMERGENCY_GUIDANCE = {
    number: exports.EMERGENCY_NUMBER,
    service: 'ambulance',
    messageEn: 'NEEDS_HUMAN_APPROVAL: This may be an emergency. Call 123 (ambulance) now. Booking is not available for emergencies.',
    messageAr: 'NEEDS_HUMAN_APPROVAL: قد تكون هذه حالة طارئة. اتصل بالرقم 123 (الإسعاف) الآن. الحجز غير متاح للحالات الطارئة.',
    bookingBlocked: true,
};
//# sourceMappingURL=emergency.js.map