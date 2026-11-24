"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.copy = exports.fmtTime = exports.T = void 0;
const config_1 = require("../common/config");
const market_time_1 = require("../common/market-time");
const safety_public_1 = require("../safety/safety-public");
const T = (id) => `TODO_NEEDS_HUMAN_wa_booking_${id}`;
exports.T = T;
const num = (i) => `${i + 1}`;
const fmtTime = (iso, lang) => (0, market_time_1.marketClock)(iso, lang);
exports.fmtTime = fmtTime;
exports.copy = {
    appLink: (lang) => (lang === 'ar' ? `يمكنك الحجز من تطبيق كيوريكس: ${(0, config_1.cfg)().appLinkBase}` : `You can book in the Kiorex app: ${(0, config_1.cfg)().appLinkBase}`),
    notRegistered: (lang) => (lang === 'ar' ? `لم نجد حسابًا بهذا الرقم. أنشئ حسابك أولًا من التطبيق ثم عد إلينا: ${(0, config_1.cfg)().appLinkBase}` : `We could not find an account for this number. Create your account first, then come back: ${(0, config_1.cfg)().appLinkBase}`),
    emergency: (lang) => (lang === 'ar' ? 'NEEDS_HUMAN_APPROVAL: قد تكون هذه حالة طارئة. اتصل بالرقم 123 (الإسعاف) الآن. الحجز غير متاح للحالات الطارئة.' : 'NEEDS_HUMAN_APPROVAL: This may be an emergency. Call 123 (ambulance) now. Booking is not available for emergencies.'),
    chooseSpecialty: (lang, codes) => (lang === 'ar' ? 'أهلًا بك في كيوريكس. اختر التخصص بالرقم (أو اكتب الأعراض):\n' : 'Welcome to Kiorex. Pick a specialty by number (or describe what you need):\n') + codes.map((c, i) => `${num(i)}. ${safety_public_1.SPECIALTY_LABELS[c][lang]}`).join('\n') + (lang === 'ar' ? '\n0. إلغاء' : '\n0. Cancel'),
    noDoctors: (lang) => (lang === 'ar' ? 'لا يوجد أطباء متاحون لهذا التخصص الآن. اختر تخصصًا آخر أو أرسل 0 للإلغاء.' : 'No doctors are available for that specialty right now. Pick another or send 0 to cancel.'),
    chooseDoctor: (lang, docs) => (lang === 'ar' ? 'اختر الطبيب بالرقم:\n' : 'Pick a doctor by number:\n') + docs.map((d, i) => `${num(i)}. ${d.name}${d.fee ? ` — ${d.fee / 100} ${d.currency ?? 'EGP'}` : ''}`).join('\n'),
    chooseSlot: (lang, slots) => (lang === 'ar' ? 'اختر الموعد بالرقم:\n' : 'Pick a time by number:\n') + slots.map((s, i) => `${num(i)}. ${(0, exports.fmtTime)(s.startsAt, lang)}`).join('\n'),
    noSlots: (lang) => (lang === 'ar' ? 'لا توجد مواعيد متاحة حاليًا. أرسل نعم للانضمام إلى قائمة الانتظار أو 0 للإلغاء.' : 'No slots are available right now. Reply YES to join the waitlist or 0 to cancel.'),
    slotTaken: (lang) => (lang === 'ar' ? 'للأسف تم حجز هذا الموعد. هذه مواعيد بديلة:' : 'Sorry, that slot was just taken. Alternatives:'),
    heldConfirm: (lang, doctor, startsAt) => lang === 'ar'
        ? `حجزنا لك مؤقتًا موعدًا مع ${doctor} في ${(0, exports.fmtTime)(startsAt, lang)} لمدة ٥ دقائق.\nTODO_NEEDS_HUMAN (صياغة الموافقة): بالرد بـ نعم توافق على مشاركة بيانات حجزك مع العيادة.\nأرسل نعم للتأكيد أو لا للإلغاء.`
        : `We are holding ${doctor} at ${(0, exports.fmtTime)(startsAt, lang)} for 5 minutes.\nTODO_NEEDS_HUMAN (consent wording): by replying YES you agree to share your booking details with the clinic.\nReply YES to confirm or NO to cancel.`,
    confirmed: (lang, doctor, startsAt, pending) => lang === 'ar'
        ? pending ? `تم إرسال طلبك مع ${doctor} (${(0, exports.fmtTime)(startsAt, lang)}) وهو في انتظار تأكيد العيادة.` : `تم تأكيد موعدك مع ${doctor} في ${(0, exports.fmtTime)(startsAt, lang)}.`
        : pending ? `Your request with ${doctor} (${(0, exports.fmtTime)(startsAt, lang)}) is awaiting clinic confirmation.` : `Your visit with ${doctor} is confirmed for ${(0, exports.fmtTime)(startsAt, lang)}.`,
    deposit: (lang, url) => (lang === 'ar' ? `يلزم دفع عربون لإتمام الحجز: ${url}` : `A deposit is required to complete this booking: ${url}`),
    holdExpired: (lang) => (lang === 'ar' ? 'انتهت مهلة الحجز المؤقت. اختر موعدًا جديدًا:' : 'The hold expired. Please pick a new time:'),
    cancelled: (lang) => (lang === 'ar' ? 'تم الإلغاء. أرسل أي رسالة للبدء من جديد.' : 'Cancelled. Send any message to start again.'),
    busy: (lang) => (lang === 'ar' ? 'نظام العيادة مشغول الآن. حاول بعد قليل.' : 'The clinic system is busy. Please try again shortly.'),
    waitlisted: (lang) => (lang === 'ar' ? 'تمت إضافتك إلى قائمة الانتظار. سنرسل لك عند توفر موعد.' : 'You are on the waitlist. We will message you when a slot opens.'),
    stopped: (lang) => (lang === 'ar' ? 'تم إيقاف رسائل واتساب من كيوريكس. يمكنك إعادة تفعيلها من التطبيق.' : 'WhatsApp messages from Kiorex are turned off. You can turn them back on in the app.'),
    invalid: (lang) => (lang === 'ar' ? 'لم أفهم اختيارك. أرسل رقمًا من القائمة أو 0 للإلغاء.' : 'I did not understand. Send a number from the list, or 0 to cancel.'),
    generic: (lang) => (lang === 'ar' ? 'تعذر إكمال الطلب. يمكنك المتابعة من التطبيق: ' + (0, config_1.cfg)().appLinkBase : 'We could not complete that. You can continue in the app: ' + (0, config_1.cfg)().appLinkBase),
};
//# sourceMappingURL=whatsapp-copy.js.map