"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.R = exports.SHOWN_SPECIALTY_CODES = exports.DISCLOSURE = exports.langOf = void 0;
exports.reply = reply;
const market_core_public_1 = require("../../market/market-core-public");
const market_time_1 = require("../../common/market-time");
const safety_public_1 = require("../../safety/safety-public");
const pick = (d, v) => (d === 'en' ? v.en : d === 'msa' ? v.msa ?? v.eg : v.eg);
const langOf = (d) => (d === 'en' ? 'en' : 'ar');
exports.langOf = langOf;
const money = (minor, cur, market = market_core_public_1.DEFAULT_MARKET) => (minor && minor > 0 ? `${Math.round(minor) / 10 ** (0, market_core_public_1.marketMinorUnits)(market)} ${cur ?? ((0, market_core_public_1.marketCurrency)(market) || 'EGP')}` : null);
const t = (iso, d) => (0, market_time_1.marketClock)(iso, (0, exports.langOf)(d));
const nameOf = (x, d) => (x.name ?? (d === 'en' ? x.nameEn ?? x.nameAr : x.nameAr ?? x.nameEn) ?? '').toString();
const specialtyLabel = (c, d) => safety_public_1.SPECIALTY_LABELS[c]?.[(0, exports.langOf)(d)] ?? c;
const list = (rows) => rows.map((r, i) => `${i + 1}. ${r}`).join('\n');
exports.DISCLOSURE = {
    en: 'I am an automated assistant that helps with booking. A person is available any time: just say "agent".',
    eg: 'أنا مساعد آلي بساعدك في الحجز. وفي موظف موجود في أي وقت: قول "موظف".',
    msa: 'أنا مساعد آلي يساعدك في الحجز، ويتوفر موظف بشري في أي وقت: اكتب "موظف".',
};
exports.SHOWN_SPECIALTY_CODES = ['dermatology', 'paediatrics', 'obgyn', 'orthopaedics', 'ent', 'internal_medicine'];
exports.R = {
    disclosure: (d) => pick(d, exports.DISCLOSURE),
    greet: (d) => ({ key: 'greet', body: pick(d, { en: 'Welcome to Kiorex. Tell me the specialty you need (for example dermatology) and, if you like, the area, the day or your budget.', eg: 'أهلاً بيك في كيوريكس. قولي التخصص اللي محتاجه (مثلاً جلدية) والمنطقة أو اليوم أو الميزانية لو حابب.', msa: 'أهلاً بك في كيوريكس. أخبرني بالتخصص الذي تحتاجه (مثلاً الجلدية) ويمكنك ذكر المنطقة أو اليوم أو الميزانية.' }) }),
    askSpecialty: (d, codes, intent = 'ask') => ({
        key: intent === 'symptom' ? 'symptom_choose_specialty' : 'ask_specialty',
        body: `${intent === 'symptom' ? pick(d, { en: 'I cannot assess symptoms. Please choose the specialty you want to book (or say "agent" to talk to a person):', eg: 'مقدرش أقيّم الأعراض. اختار التخصص اللي عايز تحجز فيه (أو قول "موظف" وهنكلمك):', msa: 'لا يمكنني تقييم الأعراض. اختر التخصص الذي تريد الحجز فيه (أو اكتب "موظف" للتحدث مع شخص):' }) : pick(d, { en: 'Which specialty do you need? Reply with a number:', eg: 'محتاج أنهي تخصص؟ ابعت رقم:', msa: 'أي تخصص تريد؟ أرسل رقماً:' })}\n${list(codes.map((c) => specialtyLabel(c, d)))}`,
    }),
    providers: (d, rows, o = {}) => ({
        key: 'providers',
        body: `${o.areaRelaxed ? pick(d, { en: 'Nothing matched that area, so here are the nearest options:', eg: 'مفيش حاجة في المنطقة دي، دي أقرب اختيارات:', msa: 'لا توجد نتائج في تلك المنطقة، وهذه أقرب الخيارات:' }) + '\n' : ''}${pick(d, { en: 'Pick a doctor by number:', eg: 'اختار الدكتور برقمه:', msa: 'اختر الطبيب برقمه:' })}\n${list(rows.map((r) => `${r.name}${money(r.feeMinor, r.currency) ? ` - ${money(r.feeMinor, r.currency)}` : ''}${r.nextSlotAt ? ` - ${t(r.nextSlotAt, d)}` : ''}`))}`,
    }),
    noProviders: (d) => ({ key: 'no_providers', body: pick(d, { en: 'I found no doctors for that request. Try another specialty, day or budget, or say "agent".', eg: 'ملقيتش دكاترة للطلب ده. جرّب تخصص أو يوم أو ميزانية تانية، أو قول "موظف".', msa: 'لم أجد أطباء لهذا الطلب. جرّب تخصصاً أو يوماً أو ميزانية أخرى، أو اكتب "موظف".' }) }),
    slots: (d, doctor, rows) => ({ key: 'slots', body: `${pick(d, { en: `Available times with ${doctor}. Pick one by number:`, eg: `المواعيد المتاحة مع ${doctor}. اختار موعد برقمه:`, msa: `المواعيد المتاحة مع ${doctor}. اختر موعداً برقمه:` })}\n${list(rows.map((r) => t(r.startsAt, d)))}` }),
    noSlots: (d, canWaitlist) => ({ key: 'no_slots', body: pick(d, { en: `No times are free in that range.${canWaitlist ? ' Say "waitlist" to join the waitlist, or ask for another day.' : ' Ask for another day or say "agent".'}`, eg: `مفيش مواعيد فاضية في الفترة دي.${canWaitlist ? ' قول "قائمة الانتظار" عشان تنضم، أو اطلب يوم تاني.' : ' اطلب يوم تاني أو قول "موظف".'}`, msa: `لا توجد مواعيد متاحة في هذه الفترة.${canWaitlist ? ' اكتب "قائمة الانتظار" للانضمام، أو اطلب يوماً آخر.' : ' اطلب يوماً آخر أو اكتب "موظف".'}` }) }),
    confirmPrompt: (d, x, confirmId, declineId) => ({
        key: 'confirm_prompt',
        body: pick(d, {
            en: `Held for 5 minutes: ${x.doctor}, ${t(x.startsAt, d)}${money(x.feeMinor, x.currency) ? `, fee ${money(x.feeMinor, x.currency)}` : ''}${money(x.depositMinor, x.currency) ? `, deposit ${money(x.depositMinor, x.currency)}` : ''}.\nTODO_NEEDS_HUMAN (consent wording): by confirming you agree to share your booking details with the clinic.\nPress Confirm to book.`,
            eg: `محجوز لك لمدة ٥ دقايق: ${x.doctor}، ${t(x.startsAt, d)}${money(x.feeMinor, x.currency) ? `، الكشف ${money(x.feeMinor, x.currency)}` : ''}${money(x.depositMinor, x.currency) ? `، عربون ${money(x.depositMinor, x.currency)}` : ''}.\nTODO_NEEDS_HUMAN (صياغة الموافقة): بالتأكيد بتوافق على مشاركة بيانات حجزك مع العيادة.\nاضغط تأكيد عشان تحجز.`,
            msa: `تم حجز الموعد مؤقتاً لمدة ٥ دقائق: ${x.doctor}، ${t(x.startsAt, d)}${money(x.feeMinor, x.currency) ? `، الرسوم ${money(x.feeMinor, x.currency)}` : ''}${money(x.depositMinor, x.currency) ? `، العربون ${money(x.depositMinor, x.currency)}` : ''}.\nTODO_NEEDS_HUMAN (صياغة الموافقة): بالتأكيد توافق على مشاركة بيانات حجزك مع العيادة.\nاضغط تأكيد لإتمام الحجز.`,
        }),
        buttons: [{ id: confirmId, title: pick(d, { en: 'Confirm', eg: 'تأكيد', msa: 'تأكيد' }) }, { id: declineId, title: pick(d, { en: 'Cancel', eg: 'إلغاء', msa: 'إلغاء' }) }],
    }),
    confirmed: (d, x) => ({
        key: 'confirmed',
        body: pick(d, {
            en: x.pendingClinic ? `Your request with ${x.doctor} (${t(x.startsAt, d)}) is awaiting clinic confirmation.` : `Booked: ${x.doctor}, ${t(x.startsAt, d)}.`,
            eg: x.pendingClinic ? `طلبك مع ${x.doctor} (${t(x.startsAt, d)}) مستني تأكيد العيادة.` : `تم الحجز: ${x.doctor}، ${t(x.startsAt, d)}.`,
            msa: x.pendingClinic ? `طلبك مع ${x.doctor} (${t(x.startsAt, d)}) بانتظار تأكيد العيادة.` : `تم الحجز: ${x.doctor}، ${t(x.startsAt, d)}.`,
        }) + (x.link ? '\n' + pick(d, { en: `A deposit is needed to complete it. Pay securely here (valid 15 minutes): ${x.link}`, eg: `محتاج عربون عشان يكتمل الحجز. ادفع من هنا بأمان (الرابط شغال ١٥ دقيقة): ${x.link}`, msa: `يلزم دفع عربون لإتمام الحجز. ادفع بأمان من هنا (الرابط صالح ١٥ دقيقة): ${x.link}` }) : ''),
    }),
    declined: (d) => ({ key: 'declined', body: pick(d, { en: 'Okay, I released the held time. Tell me if you want something else.', eg: 'تمام، فكيت الحجز المؤقت. قولي لو عايز حاجة تانية.', msa: 'حسناً، تم تحرير الموعد المؤقت. أخبرني إن أردت شيئاً آخر.' }) }),
    alreadyDone: (d, what) => ({ key: 'already_done', body: pick(d, { en: `That was already done (${what}). Nothing changed.`, eg: `ده اتعمل قبل كده (${what}). مفيش تغيير.`, msa: `تم ذلك سابقاً (${what}). لم يتغير شيء.` }) }),
    invalidConfirm: (d) => ({ key: 'invalid_confirm', body: pick(d, { en: 'That confirmation is not valid or has expired. Nothing was changed. You can start again.', eg: 'التأكيد ده مش صالح أو انتهى. مفيش حاجة اتغيرت. ممكن نبدأ من جديد.', msa: 'هذا التأكيد غير صالح أو منتهي. لم يتغير شيء. يمكنك البدء من جديد.' }) }),
    holdExpired: (d) => ({ key: 'hold_expired', body: pick(d, { en: 'The held time expired or was taken. Pick another time.', eg: 'الحجز المؤقت خلص أو الموعد اتحجز. اختار موعد تاني.', msa: 'انتهى الحجز المؤقت أو تم حجز الموعد. اختر موعداً آخر.' }) }),
    useButtons: (d) => ({ key: 'use_buttons', body: pick(d, { en: 'To confirm or cancel, please press the Confirm or Cancel button on the message above. I cannot confirm from typed text.', eg: 'عشان تأكد أو تلغي، اضغط زرار تأكيد أو إلغاء في الرسالة اللي فوق. مقدرش أأكد من النص المكتوب.', msa: 'للتأكيد أو الإلغاء، اضغط زر تأكيد أو إلغاء في الرسالة أعلاه. لا يمكنني التأكيد من النص المكتوب.' }) }),
    bookings: (d, rows, purpose) => ({
        key: 'bookings', body: `${pick(d, purpose === 'cancel' ? { en: 'Which booking do you want to cancel? Reply with a number:', eg: 'عايز تلغي أنهي حجز؟ ابعت رقمه:', msa: 'أي حجز تريد إلغاءه؟ أرسل رقمه:' } : purpose === 'reschedule' ? { en: 'Which booking do you want to move? Reply with a number:', eg: 'عايز تغيّر ميعاد أنهي حجز؟ ابعت رقمه:', msa: 'أي حجز تريد تغيير موعده؟ أرسل رقمه:' } : { en: 'Your upcoming bookings:', eg: 'حجوزاتك الجاية:', msa: 'حجوزاتك القادمة:' })}\n${list(rows.map((r) => `${r.doctor} - ${t(r.startsAt, d)} - ${statusLabel(r.status, d)}`))}`
    }),
    noBookings: (d) => ({ key: 'no_bookings', body: pick(d, { en: 'You have no upcoming bookings.', eg: 'معندكش حجوزات جاية.', msa: 'ليس لديك حجوزات قادمة.' }) }),
    cancelPrompt: (d, x, confirmId, declineId) => ({
        key: 'cancel_prompt',
        body: pick(d, {
            en: `Cancel your visit with ${x.doctor}, ${t(x.startsAt, d)}?\n${refundLine(d, x)}\nPress Confirm to cancel it.`,
            eg: `تلغي زيارتك مع ${x.doctor}، ${t(x.startsAt, d)}؟\n${refundLine(d, x)}\nاضغط تأكيد عشان تلغيها.`,
            msa: `هل تريد إلغاء زيارتك مع ${x.doctor}، ${t(x.startsAt, d)}؟\n${refundLine(d, x)}\nاضغط تأكيد للإلغاء.`,
        }),
        buttons: [{ id: confirmId, title: pick(d, { en: 'Confirm', eg: 'تأكيد', msa: 'تأكيد' }) }, { id: declineId, title: pick(d, { en: 'Keep booking', eg: 'خليه', msa: 'إبقاء الحجز' }) }],
    }),
    cancelled: (d) => ({ key: 'cancelled', body: pick(d, { en: 'Your booking is cancelled. Refunds follow the clinic cancellation policy shown above.', eg: 'الحجز اتلغى. الاسترداد حسب سياسة الإلغاء بتاعة العيادة اللي اتعرضت فوق.', msa: 'تم إلغاء الحجز. يتم الاسترداد وفق سياسة إلغاء العيادة الموضحة أعلاه.' }) }),
    reschedulePrompt: (d, x, confirmId, declineId) => ({
        key: 'reschedule_prompt',
        body: pick(d, { en: `Move your visit with ${x.doctor} from ${t(x.oldStartsAt, d)} to ${t(x.newStartsAt, d)}? Press Confirm to move it.`, eg: `تنقل زيارتك مع ${x.doctor} من ${t(x.oldStartsAt, d)} إلى ${t(x.newStartsAt, d)}؟ اضغط تأكيد عشان تنقلها.`, msa: `هل تريد نقل زيارتك مع ${x.doctor} من ${t(x.oldStartsAt, d)} إلى ${t(x.newStartsAt, d)}؟ اضغط تأكيد للنقل.` }),
        buttons: [{ id: confirmId, title: pick(d, { en: 'Confirm', eg: 'تأكيد', msa: 'تأكيد' }) }, { id: declineId, title: pick(d, { en: 'Keep time', eg: 'سيب الموعد', msa: 'إبقاء الموعد' }) }],
    }),
    rescheduled: (d, x) => ({ key: 'rescheduled', body: pick(d, { en: `Moved: ${x.doctor}, ${t(x.startsAt, d)}.`, eg: `اتنقل: ${x.doctor}، ${t(x.startsAt, d)}.`, msa: `تم النقل: ${x.doctor}، ${t(x.startsAt, d)}.` }) }),
    waitlisted: (d) => ({ key: 'waitlisted', body: pick(d, { en: 'You are on the waitlist. We will message you when a time opens.', eg: 'اتضفت لقائمة الانتظار. هنبعتلك لما يفضى ميعاد.', msa: 'تمت إضافتك إلى قائمة الانتظار. سنراسلك عند توفر موعد.' }) }),
    waitlistUnavailable: (d) => ({ key: 'waitlist_unavailable', body: pick(d, { en: 'The waitlist is not available right now. Try another day or say "agent".', eg: 'قائمة الانتظار مش متاحة دلوقتي. جرّب يوم تاني أو قول "موظف".', msa: 'قائمة الانتظار غير متاحة حالياً. جرّب يوماً آخر أو اكتب "موظف".' }) }),
    link: (d, url, why) => ({ key: `link_${why.toLowerCase()}`, body: pick(d, why === 'VERIFY' ? { en: `To book I need to verify your number first. Open this one-time link (valid 15 minutes): ${url}`, eg: `عشان أحجزلك لازم نتأكد من رقمك الأول. افتح الرابط ده (مرة واحدة وشغال ١٥ دقيقة): ${url}`, msa: `للحجز يجب التحقق من رقمك أولاً. افتح هذا الرابط (لمرة واحدة وصالح ١٥ دقيقة): ${url}` } : { en: `Continue securely here (one-time link, valid 15 minutes): ${url}`, eg: `كمّل من هنا بأمان (رابط لمرة واحدة وشغال ١٥ دقيقة): ${url}`, msa: `تابع من هنا بأمان (رابط لمرة واحدة وصالح ١٥ دقيقة): ${url}` }) }),
    consentInvite: (d, url) => ({ key: 'consent_invite', body: pick(d, { en: `To let our automated assistant help you with bookings, you can allow AI processing of your messages in your account. This is optional and you can withdraw it at any time. Open this one-time link (valid 15 minutes): ${url}`, eg: `لو عايز المساعد الآلي يساعدك في الحجز، تقدر تسمح بمعالجة رسايلك بالذكاء الاصطناعي من حسابك. ده اختياري وتقدر تلغيه في أي وقت. افتح اللينك ده (صالح ١٥ دقيقة): ${url}`, msa: `لتمكين المساعد الآلي من مساعدتك في الحجز يمكنك السماح بمعالجة رسائلك بالذكاء الاصطناعي من حسابك. هذا اختياري ويمكنك سحبه في أي وقت. افتح هذا الرابط (صالح ١٥ دقيقة): ${url}` }) }),
    handoff: (d, slaMinutes) => ({ key: 'handoff', body: pick(d, { en: `I passed your request to our team. A person will reply here, usually within ${slaMinutes} minutes during working hours. I will stay quiet until then.`, eg: `حوّلت طلبك لفريقنا. حد هيرد عليك هنا، غالباً خلال ${slaMinutes} دقيقة في ساعات العمل. هسكت لحد ما يردوا.`, msa: `تمت إحالة طلبك إلى فريقنا. سيرد عليك شخص هنا، عادةً خلال ${slaMinutes} دقيقة في ساعات العمل. سألتزم الصمت حتى ذلك الحين.` }) }),
    emergency: (d) => ({ key: 'emergency', body: (0, exports.langOf)(d) === 'ar' ? safety_public_1.EMERGENCY_GUIDANCE.messageAr : safety_public_1.EMERGENCY_GUIDANCE.messageEn }),
    medicalRedirect: (d) => ({ key: 'medical_redirect', body: pick(d, { en: 'I cannot give medical advice. A doctor can: I can help you pick a specialty and book. For anything urgent call 123. Say "agent" to talk to a person.', eg: 'مقدرش أدّي نصيحة طبية. الدكتور هو اللي يقدر: أقدر أساعدك تختار تخصص وتحجز. لو الموضوع مستعجل كلّم ١٢٣. قول "موظف" لو عايز تكلم حد.', msa: 'لا يمكنني تقديم نصيحة طبية؛ الطبيب هو من يقدر على ذلك. أستطيع مساعدتك في اختيار التخصص والحجز. في الحالات العاجلة اتصل بالرقم ١٢٣. اكتب "موظف" للتحدث مع شخص.' }) }),
    refuse: (d) => ({ key: 'refuse', body: pick(d, { en: 'I can only help with booking, changing or cancelling your own appointments. Tell me the specialty you need, or say "agent".', eg: 'أنا بساعد بس في حجز أو تغيير أو إلغاء مواعيدك إنت. قولي التخصص اللي محتاجه، أو قول "موظف".', msa: 'يمكنني فقط المساعدة في حجز مواعيدك أو تغييرها أو إلغائها. أخبرني بالتخصص الذي تحتاجه، أو اكتب "موظف".' }) }),
    clarify: (d, slot) => ({ key: `clarify_${slot}`, body: pick(d, slot === 'specialty' ? { en: 'Which specialty do you need? Reply with a number or a name.', eg: 'محتاج أنهي تخصص؟ ابعت رقم أو اسم.', msa: 'أي تخصص تحتاج؟ أرسل رقماً أو اسماً.' } : slot === 'date' ? { en: 'Which day suits you (today, tomorrow...)?', eg: 'أنهي يوم يناسبك (النهارده، بكرة...)؟', msa: 'أي يوم يناسبك (اليوم، غداً...)؟' } : { en: 'I did not catch that. Reply with a number from the list, or tell me what you need (book, change, cancel), or say "agent".', eg: 'مفهمتش. ابعت رقم من القايمة، أو قولي عايز إيه (حجز، تغيير، إلغاء)، أو قول "موظف".', msa: 'لم أفهم. أرسل رقماً من القائمة، أو أخبرني بما تريد (حجز، تغيير، إلغاء)، أو اكتب "موظف".' }) }),
    thanks: (d) => ({ key: 'thanks', body: pick(d, { en: 'You are welcome. Message me any time you want to book.', eg: 'العفو. ابعتلي أي وقت عايز تحجز.', msa: 'على الرحب والسعة. راسلني في أي وقت للحجز.' }) }),
    unverified: (d) => ({ key: 'unverified_notice', body: pick(d, { en: 'I can show you doctors and times, but to book or manage bookings your number must be verified first.', eg: 'أقدر أوريك الدكاترة والمواعيد، بس عشان تحجز أو تدير حجوزاتك لازم رقمك يتأكد الأول.', msa: 'يمكنني عرض الأطباء والمواعيد، لكن للحجز أو إدارة الحجوزات يجب التحقق من رقمك أولاً.' }) }),
    media: (d) => ({ key: 'media', body: pick(d, { en: 'I can only read text messages. Please type what you need.', eg: 'بقرا الرسايل النصية بس. اكتب اللي محتاجه.', msa: 'أستطيع قراءة الرسائل النصية فقط. اكتب ما تحتاجه من فضلك.' }) }),
    tooLong: (d) => ({ key: 'too_long', body: pick(d, { en: 'That message is too long. Please send a shorter one (under 1,000 characters).', eg: 'الرسالة طويلة. ابعت رسالة أقصر (أقل من ١٠٠٠ حرف).', msa: 'الرسالة طويلة جداً. أرسل رسالة أقصر (أقل من ١٠٠٠ حرف).' }) }),
    rateLimited: (d) => ({ key: 'rate_limited', body: pick(d, { en: 'You are sending messages very fast. Please wait a little and try again.', eg: 'بتبعت رسايل بسرعة. استنى شوية وجرّب تاني.', msa: 'ترسل رسائل بسرعة كبيرة. انتظر قليلاً ثم حاول مجدداً.' }) }),
    slotTaken: (d) => ({ key: 'slot_taken', body: pick(d, { en: 'Sorry, that time was just taken. Pick another one.', eg: 'للأسف الميعاد ده اتحجز. اختار ميعاد تاني.', msa: 'عذراً، تم حجز هذا الموعد للتو. اختر موعداً آخر.' }) }),
    busy: (d) => ({ key: 'busy', body: pick(d, { en: 'The clinic system is busy. Please try again shortly.', eg: 'نظام العيادة مشغول دلوقتي. جرّب كمان شوية.', msa: 'نظام العيادة مشغول حالياً. حاول بعد قليل.' }) }),
    generic: (d) => ({ key: 'generic', body: pick(d, { en: 'I could not complete that. Nothing was changed. Say "agent" and a person will help.', eg: 'معرفتش أكمل الطلب ده. مفيش حاجة اتغيرت. قول "موظف" وهنساعدك.', msa: 'تعذر إكمال الطلب. لم يتغير شيء. اكتب "موظف" وسيساعدك أحد.' }) }),
};
function reply(intent, d) {
    switch (intent) {
        case 'greet':
        case 'offer_help': return exports.R.greet(d);
        case 'ask_specialty': return exports.R.askSpecialty(d, exports.SHOWN_SPECIALTY_CODES);
        case 'symptom_choose_specialty': return exports.R.askSpecialty(d, exports.SHOWN_SPECIALTY_CODES, 'symptom');
        case 'use_buttons': return exports.R.useButtons(d);
        case 'thanks': return exports.R.thanks(d);
        case 'medical_redirect': return exports.R.medicalRedirect(d);
        case 'unverified_notice': return exports.R.unverified(d);
        default: return exports.R.clarify(d, 'any');
    }
}
const statusLabel = (s, d) => ({ CONFIRMED: { en: 'confirmed', eg: 'مؤكد', msa: 'مؤكد' }, PENDING_CLINIC: { en: 'awaiting clinic', eg: 'مستني العيادة', msa: 'بانتظار العيادة' } }[s] ? pick(d, { CONFIRMED: { en: 'confirmed', eg: 'مؤكد', msa: 'مؤكد' }, PENDING_CLINIC: { en: 'awaiting clinic', eg: 'مستني العيادة', msa: 'بانتظار العيادة' } }[s]) : s);
function refundLine(d, x) {
    const m = money(x.depositMinor, x.currency);
    if (!m)
        return pick(d, { en: 'No deposit was paid, so there is nothing to refund.', eg: 'مفيش عربون اتدفع، فمفيش حاجة تتسترد.', msa: 'لم يُدفع عربون، لذا لا يوجد مبلغ للاسترداد.' });
    if (x.depositRefundable === true)
        return pick(d, { en: `Your deposit of ${m} is refundable under the clinic cancellation policy.`, eg: `العربون ${m} قابل للاسترداد حسب سياسة العيادة.`, msa: `العربون البالغ ${m} قابل للاسترداد وفق سياسة العيادة.` });
    if (x.depositRefundable === false)
        return pick(d, { en: `Your deposit of ${m} is not refundable at this time under the clinic cancellation policy.`, eg: `العربون ${m} مش قابل للاسترداد دلوقتي حسب سياسة العيادة.`, msa: `العربون البالغ ${m} غير قابل للاسترداد حالياً وفق سياسة العيادة.` });
    return pick(d, { en: `Your deposit of ${m} is handled by the clinic cancellation policy.`, eg: `العربون ${m} بيتعامل حسب سياسة الإلغاء بتاعة العيادة.`, msa: `يُعامل العربون البالغ ${m} وفق سياسة إلغاء العيادة.` });
}
//# sourceMappingURL=assistant.render.js.map