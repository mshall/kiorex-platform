"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isOptOut = exports.containsPhi = exports.SYSTEM_PROMPT_FRAGMENTS = exports.ASSISTANT_CANARY = void 0;
exports.sanitiseInbound = sanitiseInbound;
exports.injectionSignals = injectionSignals;
exports.wantsHuman = wantsHuman;
exports.screenInbound = screenInbound;
exports.redactForStorage = redactForStorage;
exports.redactForModel = redactForModel;
exports.scanOutbound = scanOutbound;
exports.wrapUserField = wrapUserField;
exports.asksMedicalAdvice = asksMedicalAdvice;
const safety_public_1 = require("../../safety/safety-public");
exports.ASSISTANT_CANARY = 'KXA-CANARY-9d3e1f62';
exports.SYSTEM_PROMPT_FRAGMENTS = ['you are the kiorex booking assistant', 'structured step', exports.ASSISTANT_CANARY.toLowerCase()];
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;
const BIDI_AND_INVISIBLE = /[؜​-‏‪-‮⁠-⁤⁦-⁩­﻿᠎]|[\u{E0000}-\u{E007F}]/gu;
const URL_RE = /(?:https?:\/\/|www\.)\S+|\b[a-z0-9][a-z0-9-]{0,40}\.(?:com|net|org|io|ly|me|app|link|eg|co|info|xyz|ru|cn|tk|gl|to|cc)\b(?:\/\S*)?/gi;
function sanitiseInbound(raw, maxChars = 1000) {
    const input = (raw ?? '').toString();
    const tooLong = input.length > maxChars;
    const head = tooLong ? input.slice(0, maxChars) : input;
    let strippedControls = 0;
    let t = head.normalize('NFKC').replace(CONTROL, () => { strippedControls++; return ''; }).replace(BIDI_AND_INVISIBLE, () => { strippedControls++; return ''; });
    let hadUrl = false;
    t = t.replace(URL_RE, () => { hadUrl = true; return ' '; });
    t = t.replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, ' ').trim();
    return { text: t, tooLong, hadUrl, strippedControls };
}
const INJECTION = [
    /ignore (?:all |any |the |your )?(?:previous|prior|above|earlier|system|safety)? ?(?:instructions|rules|prompts?|guidelines|messages)/,
    /disregard (?:all |any |the |your )?(?:previous|prior|above|earlier)?/,
    /forget (?:everything|all|your|the)(?: you| about)?(?: instructions| rules| above| previous)?/,
    /(?:system|developer|hidden|initial|original) (?:prompt|message|instructions?)/,
    /(?:reveal|show|print|repeat|display|leak|tell me|what (?:is|are)) (?:me )?(?:your|the) (?:prompt|instructions|rules|system|configuration|secret|canary)/,
    /(?:developer|debug|admin|god|sudo|dan|jailbreak|unrestricted) mode/,
    /you are now|from now on you|new (?:instructions|role|rules)|act as|pretend (?:to be|you)|role ?play|simulate being|imagine you are/,
    /<\/?(?:system|assistant|user|tool|instructions?)>|\[\/?(?:system|inst|assistant)\]|<\|im_(?:start|end)\|>|###\s*(?:system|instruction)/,
    /(?:tool|function)[_ ]?call|\bcall (?:the )?(?:tool|function)\b|\{\s*"?(?:tool|name|kind)"?\s*:/,
    /(?:another|other|someone else'?s?|different|all) (?:patient|user|person|customer|client)'?s? ?(?:booking|bookings|appointment|appointments|data|record|records|phone|number)/,
    /(?:bookings?|appointments?|records?|data) (?:of|for) (?:patient|user|number|phone|account|sub)\b/,
    /(?:bookings?|appointments?|records?|data|phone|number|details) (?:of|for|belonging to) (?:another|other|someone else|a different|the previous|the last) (?:patient|user|person|customer|caller|client)/,
    /(?:someone else'?s?|somebody else'?s?|other people'?s?|another person'?s?|others') (?:bookings?|appointments?|data|records?|phone|numbers?|details|info)/,
    /\b(?:show|give|send|tell|list|read) (?:me )?(?:the )?(?:bookings?|appointments?|records?|data|details|phone numbers?) .{0,30}(?:another|other|someone else|different) (?:patient|user|person|customer|caller|client)/,
    /(?:cancel|delete|list|show|dump|export) (?:all|every) (?:bookings?|appointments?|users?|patients?)/,
    /\b(?:sub|tenant|phone|account) ?(?:id)? ?[:=]/,
    /\b(?:cancel|delete|remove|الغي|احذف|امسح) .{0,14}(?:all|every|كل|جميع) .{0,14}(?:bookings?|appointments?|users?|patients?|الحجوزات|المواعيد|المرضي|المستخدمين)/,
    /\b(?:reveal|show|print|display|اعرض|اظهر|اكتب|كرر) .{0,16}(?:البرومبت|prompt|التعليمات|instructions)/,
    /(?:ignore|override|bypass|disable|skip) (?:the )?(?:safety|confirmation|confirm|button|nonce|policy|consent|limits?)/,
    /\b(?:base64|rot13|hex(?:adecimal)?) (?:decode|encoded)/,
    /\bhttps?:\/\/|\bcurl\b|\bwget\b|\bfetch\(/,
    /تجاهل (?:كل |جميع )?(?:التعليمات|الاوامر|القواعد|ما سبق)/,
    /(?:انس|انسي|انسى) (?:كل |جميع )?(?:التعليمات|الاوامر|القواعد|ما سبق|ما قيل)/,
    /(?:اظهر|اعرض|اكتب|كرر|قل|وريني|هاتلي) (?:لي |لى )?(?:التعليمات|البرومبت|الاوامر الداخليه|نظامك|التعليمات الداخليه|التعليمات السابقه)/,
    /(?:التعليمات|الاوامر) (?:السابقه|الداخليه|الاصليه)|برومبت النظام|رسالة النظام|رساله النظام/,
    /(?:انت|انتي) (?:الان|دلوقتي|بقيت)|من (?:الان|دلوقتي) (?:انت|انتي)|تصرف (?:ك|كانك|مثل)|تخيل (?:انك|انه)|العب دور|اعتبر نفسك/,
    /وضع (?:المطور|المبرمج|الادمن|المدير|بدون قيود)|بدون (?:قيود|قواعد|رقابه)/,
    /(?:حجز|حجوزات|مواعيد|بيانات|سجل) (?:مريض|شخص|مستخدم|عميل|رقم|حساب) (?:اخر|تاني|غيري|اخرين)|(?:مريض|شخص) (?:اخر|تاني) (?:حجز|حجوزات|مواعيد|بيانات)/,
    /(?:الغي|الغاء|احذف|امسح|اعرض) (?:كل|جميع|كافه) (?:الحجوزات|المواعيد|المرضى|المستخدمين)/,
    /(?:تخطي|تجاوز|عطل|الغي) (?:ال)?(?:تاكيد|زر|حمايه|موافقه|قيود|حدود)/,
    /(?:استدع|نفذ|شغل) (?:الاداه|الداله|الاجراء|الامر)/,
];
const INJECTION_NORMALISED = INJECTION;
function injectionSignals(text) {
    const n = (0, safety_public_1.normalizeText)(text.replace(/[​-‏‪-‮⁦-⁩]/g, ''));
    const hits = [];
    INJECTION_NORMALISED.forEach((re, i) => { if (re.test(n))
        hits.push(`INJ${i + 1}`); });
    return hits;
}
const HANDOFF_WORDS = ['agent', 'human', 'real person', 'live agent', 'customer service', 'support', 'talk to someone', 'speak to someone', 'موظف', 'خدمه العملاء', 'خدمة العملاء', 'عايز اكلم حد', 'عايز اكلم موظف', 'كلموني', 'كلمني حد', 'كلموني حد', 'اكلم حد', 'اتكلم مع حد', 'اتكلم مع موظف', 'شخص حقيقي', 'مش عايز بوت', 'بشري'].map(safety_public_1.normalizeText);
function wantsHuman(text) {
    const n = ` ${(0, safety_public_1.normalizeText)(text).replace(/[.,!?؟،]/g, ' ').replace(/\s+/g, ' ')} `;
    return HANDOFF_WORDS.some((w) => n.includes(` ${w} `));
}
function screenInbound(sanitisedText) {
    const em = (0, safety_public_1.detectEmergency)(sanitisedText);
    return { emergency: em.emergency, emergencyCategories: em.categories, handoff: wantsHuman(sanitisedText), injection: injectionSignals(sanitisedText), symptom: (0, safety_public_1.mapSymptomToSpecialties)(sanitisedText).length > 0 };
}
function redactForStorage(sanitisedText) {
    if (!sanitisedText)
        return '';
    if ((0, safety_public_1.detectEmergency)(sanitisedText).emergency || (0, safety_public_1.mapSymptomToSpecialties)(sanitisedText).length > 0 || asksMedicalAdvice(sanitisedText))
        return '[HEALTH_TEXT]';
    let t = (0, safety_public_1.redactPhi)(sanitisedText).text;
    t = t.replace(/\d{6,}/g, '[NUMBER]');
    return t.slice(0, 300);
}
function redactForModel(sanitisedText) {
    if ((0, safety_public_1.detectEmergency)(sanitisedText).emergency)
        return '[EMERGENCY_WITHHELD]';
    const t = (0, safety_public_1.redactPhi)(sanitisedText).text.replace(/\d{6,}/g, '[NUMBER]');
    return t.slice(0, 600);
}
const containsPhi = (text) => (0, safety_public_1.detectPhi)(text).length > 0;
exports.containsPhi = containsPhi;
const MED_EN = [/\bdiagnos\w*/, /\bprescrib\w*/, /\bdosag\w*|\bdoses?\b/, /\b\d+(?:\.\d+)?\s?(?:mg|mcg|ml|iu|tablets?|pills?|capsules?)\b/, /\byou (?:probably|likely|may|might|could) (?:have|suffer)\b/, /\byou (?:suffer|are suffering)\b/, /\byou have (?:an? )?(?:infection|disease|condition|illness|cancer|diabetes|virus|flu|cold|allergy|fever|inflammation)\b/, /\btake (?:this|these|some|one|two|\d+)\s+\w+/, /\b(?:antibiotics?|ibuprofen|paracetamol|panadol|aspirin|insulin|steroids?|painkillers?)\b/, /\b(?:you should|you must|you need to) (?:take|stop|start|use|eat|avoid)\b/, /\b(?:it'?s|it is) (?:probably|likely|just|nothing)\b/, /\btreatment plan|\bhome remed(?:y|ies)\b|\bsymptoms? (?:of|indicate|suggest)\b/];
const MED_AR = [/جرعه|جرعات/, /تشخيص|اشخص|شخصت/, /(?:اعتقد|ممكن|غالبا|يبدو|احتمال) (?:انك|انت|ان عندك)/, /(?:انت|حضرتك) (?:عندك|مصاب|تعاني)/, /(?:خد|خذ|تناول|اشرب|استخدم) (?:دواء|حبه|حبوب|قرص|اقراص|كبسول|مضاد|بنادول|ابوبروفين|الدواء)/, /\d+\s?(?:ملغ|مجم|مللي|ملجم|وحده)/, /مضاد حيوي|مسكن|بنادول|ابوبروفين|اسبرين|انسولين|كورتيزون/, /علاج (?:منزلي|بالاعشاب)|خطه علاج/];
function scanOutbound(body, allowedUrls = new Set()) {
    const low = body.toLowerCase();
    if (exports.SYSTEM_PROMPT_FRAGMENTS.some((f) => low.includes(f)))
        return { text: '', blocked: 'PROMPT_LEAK', urlsStripped: 0 };
    const n = (0, safety_public_1.normalizeText)(body);
    if (MED_EN.some((r) => r.test(low)) || MED_AR.some((r) => r.test(n)))
        return { text: '', blocked: 'MEDICAL_ADVICE', urlsStripped: 0 };
    let kept = body;
    const holders = [];
    for (const u of allowedUrls) {
        if (kept.includes(u)) {
            holders.push(u);
            kept = kept.split(u).join(`\u0000${holders.length - 1}\u0000`);
        }
    }
    let stripped = 0;
    kept = kept.replace(URL_RE, () => { stripped++; return ''; });
    kept = kept.replace(/\u0000(\d+)\u0000/g, (_m, i) => holders[Number(i)]).replace(/[ \t]{2,}/g, ' ').trim();
    return { text: kept, blocked: null, urlsStripped: stripped };
}
function wrapUserField(text) {
    const escaped = text.replace(/[<>&"`\\]/g, (c) => `&#${c.charCodeAt(0)};`).replace(/\{|\}/g, (c) => `&#${c.charCodeAt(0)};`);
    return `<patient_message encoding="escaped-data">${escaped}</patient_message>`;
}
const ASK_EN = [/\b(?:dose|dosage|diagnos\w*|prescri\w*|medicine|medication|pills?|tablets?|drugs?|antibiotics?|painkillers?|ibuprofen|paracetamol|panadol)\b/, /\bwhat (?:should|can|do) i (?:take|do|use)\b/, /\bis (?:it|this) (?:serious|dangerous|cancer|normal|contagious)\b/, /\bwhat (?:is|could|might) (?:this|it|wrong)\b/, /\bhow (?:much|many) (?:should|can) i\b/, /\bam i (?:sick|dying|pregnant|ill)\b/];
const ASK_AR = [/جرعه|جرعات/, /تشخيص|شخصلي|شخص حالتي/, /(?:ااخد|اخد|اتناول|استخدم|اشرب) (?:ايه|دواء|علاج|حبايه|حبوب|مضاد)/, /(?:ايه|اي) (?:الدواء|العلاج|الحبوب)/, /(?:ده|دا|هذا|ممكن يكون) (?:خطير|سرطان|معدي)/, /(?:ممكن|يمكن) يكون ايه|عندي ايه|حالتي ايه/, /بنادول|ابوبروفين|مضاد حيوي|مسكن|كورتيزون/];
function asksMedicalAdvice(text) {
    const low = text.toLowerCase();
    const n = (0, safety_public_1.normalizeText)(text);
    return ASK_EN.some((r) => r.test(low)) || ASK_AR.some((r) => r.test(n));
}
const STOP_WORDS = new Set(['stop', 'unsubscribe', 'وقف', 'ايقاف', 'إيقاف', 'الغاء الاشتراك', 'ايقاف الرسائل', 'وقف الرسائل'].map((w) => (0, safety_public_1.normalizeText)(w).replace(/[.!؟?,،]/g, '').trim()));
const isOptOut = (text) => STOP_WORDS.has((0, safety_public_1.normalizeText)(text ?? '').replace(/[.!؟?,،]/g, '').trim());
exports.isOptOut = isOptOut;
//# sourceMappingURL=assistant.safety.js.map