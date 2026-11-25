import { DEFAULT_MARKET, marketCurrency, marketMinorUnits } from '../../market/market-core-public';
import { marketClock } from '../../common/market-time';
import { EMERGENCY_GUIDANCE, SPECIALTY_LABELS, type SpecialtyCode } from '../../safety/safety-public';
import type { ClarifySlot, Dialect, Lang, ReplyIntent } from './assistant.types';

/**
 * GRW-P2-D renderer: AR (Egyptian-neutral and Modern Standard) and EN FIXED templates. Every number, name, fee and time comes from tool output (never from the model, never from the patient).
 * Wording is DRAFT: consent, clinical and refund wording and Meta-approved template ids are NEEDS_HUMAN; the `TODO_NEEDS_HUMAN` markers stay in the text so nothing reads as approved.
 */
export interface Button { id: string; title: string }
export interface Rendered { key: string; body: string; buttons?: Button[] }

type V = { en: string; eg: string; msa?: string };
const pick = (d: Dialect, v: V) => (d === 'en' ? v.en : d === 'msa' ? v.msa ?? v.eg : v.eg);
export const langOf = (d: Dialect): Lang => (d === 'en' ? 'en' : 'ar');
/** Money in the market's own currency and minor units (ZY readiness): the default market unless a caller passes the conversation's market. */
const money = (minor: number | null | undefined, cur?: string, market: string = DEFAULT_MARKET) => (minor && minor > 0 ? `${Math.round(minor) / 10 ** marketMinorUnits(market)} ${cur ?? (marketCurrency(market) || 'EGP')}` : null);
const t = (iso: string, d: Dialect) => marketClock(iso, langOf(d));
const nameOf = (x: { nameAr?: string | null; nameEn?: string | null; name?: string }, d: Dialect) => (x.name ?? (d === 'en' ? x.nameEn ?? x.nameAr : x.nameAr ?? x.nameEn) ?? '').toString();
const specialtyLabel = (c: string, d: Dialect) => SPECIALTY_LABELS[c as SpecialtyCode]?.[langOf(d)] ?? c;
const list = (rows: string[]) => rows.map((r, i) => `${i + 1}. ${r}`).join('\n');

export const DISCLOSURE: V = {
  en: 'I am an automated assistant that helps with booking. A person is available any time: just say "agent".',
  eg: 'أنا مساعد آلي بساعدك في الحجز. وفي موظف موجود في أي وقت: قول "موظف".',
  msa: 'أنا مساعد آلي يساعدك في الحجز، ويتوفر موظف بشري في أي وقت: اكتب "موظف".',
};
export const SHOWN_SPECIALTY_CODES: readonly SpecialtyCode[] = ['dermatology', 'paediatrics', 'obgyn', 'orthopaedics', 'ent', 'internal_medicine'];

export const R = {
  disclosure: (d: Dialect): string => pick(d, DISCLOSURE),
  greet: (d: Dialect): Rendered => ({ key: 'greet', body: pick(d, { en: 'Welcome to Kiorex. Tell me the specialty you need (for example dermatology) and, if you like, the area, the day or your budget.', eg: 'أهلاً بيك في كيوريكس. قولي التخصص اللي محتاجه (مثلاً جلدية) والمنطقة أو اليوم أو الميزانية لو حابب.', msa: 'أهلاً بك في كيوريكس. أخبرني بالتخصص الذي تحتاجه (مثلاً الجلدية) ويمكنك ذكر المنطقة أو اليوم أو الميزانية.' }) }),
  askSpecialty: (d: Dialect, codes: readonly string[], intent: 'ask' | 'symptom' = 'ask'): Rendered => ({
    key: intent === 'symptom' ? 'symptom_choose_specialty' : 'ask_specialty',
    body: `${intent === 'symptom' ? pick(d, { en: 'I cannot assess symptoms. Please choose the specialty you want to book (or say "agent" to talk to a person):', eg: 'مقدرش أقيّم الأعراض. اختار التخصص اللي عايز تحجز فيه (أو قول "موظف" وهنكلمك):', msa: 'لا يمكنني تقييم الأعراض. اختر التخصص الذي تريد الحجز فيه (أو اكتب "موظف" للتحدث مع شخص):' }) : pick(d, { en: 'Which specialty do you need? Reply with a number:', eg: 'محتاج أنهي تخصص؟ ابعت رقم:', msa: 'أي تخصص تريد؟ أرسل رقماً:' })}\n${list(codes.map((c) => specialtyLabel(c, d)))}`,
  }),
  providers: (d: Dialect, rows: { name: string; feeMinor?: number | null; currency?: string; nextSlotAt?: string | null }[], o: { areaRelaxed?: boolean; specialty?: string } = {}): Rendered => ({
    key: 'providers',
    body: `${o.areaRelaxed ? pick(d, { en: 'Nothing matched that area, so here are the nearest options:', eg: 'مفيش حاجة في المنطقة دي، دي أقرب اختيارات:', msa: 'لا توجد نتائج في تلك المنطقة، وهذه أقرب الخيارات:' }) + '\n' : ''}${pick(d, { en: 'Pick a doctor by number:', eg: 'اختار الدكتور برقمه:', msa: 'اختر الطبيب برقمه:' })}\n${list(rows.map((r) => `${r.name}${money(r.feeMinor, r.currency) ? ` - ${money(r.feeMinor, r.currency)}` : ''}${r.nextSlotAt ? ` - ${t(r.nextSlotAt, d)}` : ''}`))}`,
  }),
  noProviders: (d: Dialect): Rendered => ({ key: 'no_providers', body: pick(d, { en: 'I found no doctors for that request. Try another specialty, day or budget, or say "agent".', eg: 'ملقيتش دكاترة للطلب ده. جرّب تخصص أو يوم أو ميزانية تانية، أو قول "موظف".', msa: 'لم أجد أطباء لهذا الطلب. جرّب تخصصاً أو يوماً أو ميزانية أخرى، أو اكتب "موظف".' }) }),
  slots: (d: Dialect, doctor: string, rows: { startsAt: string }[]): Rendered => ({ key: 'slots', body: `${pick(d, { en: `Available times with ${doctor}. Pick one by number:`, eg: `المواعيد المتاحة مع ${doctor}. اختار موعد برقمه:`, msa: `المواعيد المتاحة مع ${doctor}. اختر موعداً برقمه:` })}\n${list(rows.map((r) => t(r.startsAt, d)))}` }),
  noSlots: (d: Dialect, canWaitlist: boolean): Rendered => ({ key: 'no_slots', body: pick(d, { en: `No times are free in that range.${canWaitlist ? ' Say "waitlist" to join the waitlist, or ask for another day.' : ' Ask for another day or say "agent".'}`, eg: `مفيش مواعيد فاضية في الفترة دي.${canWaitlist ? ' قول "قائمة الانتظار" عشان تنضم، أو اطلب يوم تاني.' : ' اطلب يوم تاني أو قول "موظف".'}`, msa: `لا توجد مواعيد متاحة في هذه الفترة.${canWaitlist ? ' اكتب "قائمة الانتظار" للانضمام، أو اطلب يوماً آخر.' : ' اطلب يوماً آخر أو اكتب "موظف".'}` }) }),
  confirmPrompt: (d: Dialect, x: { doctor: string; startsAt: string; feeMinor?: number | null; currency?: string; depositMinor?: number | null }, confirmId: string, declineId: string): Rendered => ({
    key: 'confirm_prompt',
    body: pick(d, {
      en: `Held for 5 minutes: ${x.doctor}, ${t(x.startsAt, d)}${money(x.feeMinor, x.currency) ? `, fee ${money(x.feeMinor, x.currency)}` : ''}${money(x.depositMinor, x.currency) ? `, deposit ${money(x.depositMinor, x.currency)}` : ''}.\nTODO_NEEDS_HUMAN (consent wording): by confirming you agree to share your booking details with the clinic.\nPress Confirm to book.`,
      eg: `محجوز لك لمدة ٥ دقايق: ${x.doctor}، ${t(x.startsAt, d)}${money(x.feeMinor, x.currency) ? `، الكشف ${money(x.feeMinor, x.currency)}` : ''}${money(x.depositMinor, x.currency) ? `، عربون ${money(x.depositMinor, x.currency)}` : ''}.\nTODO_NEEDS_HUMAN (صياغة الموافقة): بالتأكيد بتوافق على مشاركة بيانات حجزك مع العيادة.\nاضغط تأكيد عشان تحجز.`,
      msa: `تم حجز الموعد مؤقتاً لمدة ٥ دقائق: ${x.doctor}، ${t(x.startsAt, d)}${money(x.feeMinor, x.currency) ? `، الرسوم ${money(x.feeMinor, x.currency)}` : ''}${money(x.depositMinor, x.currency) ? `، العربون ${money(x.depositMinor, x.currency)}` : ''}.\nTODO_NEEDS_HUMAN (صياغة الموافقة): بالتأكيد توافق على مشاركة بيانات حجزك مع العيادة.\nاضغط تأكيد لإتمام الحجز.`,
    }),
    buttons: [{ id: confirmId, title: pick(d, { en: 'Confirm', eg: 'تأكيد', msa: 'تأكيد' }) }, { id: declineId, title: pick(d, { en: 'Cancel', eg: 'إلغاء', msa: 'إلغاء' }) }],
  }),
  confirmed: (d: Dialect, x: { doctor: string; startsAt: string; pendingClinic: boolean; link?: string }): Rendered => ({
    key: 'confirmed',
    body: pick(d, {
      en: x.pendingClinic ? `Your request with ${x.doctor} (${t(x.startsAt, d)}) is awaiting clinic confirmation.` : `Booked: ${x.doctor}, ${t(x.startsAt, d)}.`,
      eg: x.pendingClinic ? `طلبك مع ${x.doctor} (${t(x.startsAt, d)}) مستني تأكيد العيادة.` : `تم الحجز: ${x.doctor}، ${t(x.startsAt, d)}.`,
      msa: x.pendingClinic ? `طلبك مع ${x.doctor} (${t(x.startsAt, d)}) بانتظار تأكيد العيادة.` : `تم الحجز: ${x.doctor}، ${t(x.startsAt, d)}.`,
    }) + (x.link ? '\n' + pick(d, { en: `A deposit is needed to complete it. Pay securely here (valid 15 minutes): ${x.link}`, eg: `محتاج عربون عشان يكتمل الحجز. ادفع من هنا بأمان (الرابط شغال ١٥ دقيقة): ${x.link}`, msa: `يلزم دفع عربون لإتمام الحجز. ادفع بأمان من هنا (الرابط صالح ١٥ دقيقة): ${x.link}` }) : ''),
  }),
  declined: (d: Dialect): Rendered => ({ key: 'declined', body: pick(d, { en: 'Okay, I released the held time. Tell me if you want something else.', eg: 'تمام، فكيت الحجز المؤقت. قولي لو عايز حاجة تانية.', msa: 'حسناً، تم تحرير الموعد المؤقت. أخبرني إن أردت شيئاً آخر.' }) }),
  alreadyDone: (d: Dialect, what: string): Rendered => ({ key: 'already_done', body: pick(d, { en: `That was already done (${what}). Nothing changed.`, eg: `ده اتعمل قبل كده (${what}). مفيش تغيير.`, msa: `تم ذلك سابقاً (${what}). لم يتغير شيء.` }) }),
  /** The Clinic refused the cancellation because the cancellation window of that visit has closed (found by the W9 ordered run: the assistant answered "I did not catch that"). Nothing was changed. */
  cancelWindowClosed: (d: Dialect): Rendered => ({ key: 'cancel_window_closed', body: pick(d, { en: 'This visit can no longer be cancelled here because its cancellation window has closed. Nothing was changed. Please contact the clinic, or say "agent" and a person will help.', eg: 'الزيارة دي مبقاش ينفع تتلغي من هنا لأن وقت الإلغاء خلص. مفيش حاجة اتغيرت. كلم العيادة، أو قول "agent" وحد هيساعدك.', msa: 'لا يمكن إلغاء هذه الزيارة من هنا لأن مهلة الإلغاء انتهت. لم يتغير شيء. يرجى التواصل مع العيادة، أو اكتب "agent" ليساعدك أحد الموظفين.' }) }),
  invalidConfirm: (d: Dialect): Rendered => ({ key: 'invalid_confirm', body: pick(d, { en: 'That confirmation is not valid or has expired. Nothing was changed. You can start again.', eg: 'التأكيد ده مش صالح أو انتهى. مفيش حاجة اتغيرت. ممكن نبدأ من جديد.', msa: 'هذا التأكيد غير صالح أو منتهي. لم يتغير شيء. يمكنك البدء من جديد.' }) }),
  holdExpired: (d: Dialect): Rendered => ({ key: 'hold_expired', body: pick(d, { en: 'The held time expired or was taken. Pick another time.', eg: 'الحجز المؤقت خلص أو الموعد اتحجز. اختار موعد تاني.', msa: 'انتهى الحجز المؤقت أو تم حجز الموعد. اختر موعداً آخر.' }) }),
  useButtons: (d: Dialect): Rendered => ({ key: 'use_buttons', body: pick(d, { en: 'To confirm or cancel, please press the Confirm or Cancel button on the message above. I cannot confirm from typed text.', eg: 'عشان تأكد أو تلغي، اضغط زرار تأكيد أو إلغاء في الرسالة اللي فوق. مقدرش أأكد من النص المكتوب.', msa: 'للتأكيد أو الإلغاء، اضغط زر تأكيد أو إلغاء في الرسالة أعلاه. لا يمكنني التأكيد من النص المكتوب.' }) }),
  bookings: (d: Dialect, rows: { doctor: string; startsAt: string; status: string }[], purpose: 'list' | 'cancel' | 'reschedule'): Rendered => ({
    key: 'bookings', body: `${pick(d, purpose === 'cancel' ? { en: 'Which booking do you want to cancel? Reply with a number:', eg: 'عايز تلغي أنهي حجز؟ ابعت رقمه:', msa: 'أي حجز تريد إلغاءه؟ أرسل رقمه:' } : purpose === 'reschedule' ? { en: 'Which booking do you want to move? Reply with a number:', eg: 'عايز تغيّر ميعاد أنهي حجز؟ ابعت رقمه:', msa: 'أي حجز تريد تغيير موعده؟ أرسل رقمه:' } : { en: 'Your upcoming bookings:', eg: 'حجوزاتك الجاية:', msa: 'حجوزاتك القادمة:' })}\n${list(rows.map((r) => `${r.doctor} - ${t(r.startsAt, d)} - ${statusLabel(r.status, d)}`))}` }),
  noBookings: (d: Dialect): Rendered => ({ key: 'no_bookings', body: pick(d, { en: 'You have no upcoming bookings.', eg: 'معندكش حجوزات جاية.', msa: 'ليس لديك حجوزات قادمة.' }) }),
  cancelPrompt: (d: Dialect, x: { doctor: string; startsAt: string; depositMinor?: number | null; currency?: string; depositRefundable?: boolean | null }, confirmId: string, declineId: string): Rendered => ({
    key: 'cancel_prompt',
    body: pick(d, {
      en: `Cancel your visit with ${x.doctor}, ${t(x.startsAt, d)}?\n${refundLine(d, x)}\nPress Confirm to cancel it.`,
      eg: `تلغي زيارتك مع ${x.doctor}، ${t(x.startsAt, d)}؟\n${refundLine(d, x)}\nاضغط تأكيد عشان تلغيها.`,
      msa: `هل تريد إلغاء زيارتك مع ${x.doctor}، ${t(x.startsAt, d)}؟\n${refundLine(d, x)}\nاضغط تأكيد للإلغاء.`,
    }),
    buttons: [{ id: confirmId, title: pick(d, { en: 'Confirm', eg: 'تأكيد', msa: 'تأكيد' }) }, { id: declineId, title: pick(d, { en: 'Keep booking', eg: 'خليه', msa: 'إبقاء الحجز' }) }],
  }),
  cancelled: (d: Dialect): Rendered => ({ key: 'cancelled', body: pick(d, { en: 'Your booking is cancelled. Refunds follow the clinic cancellation policy shown above.', eg: 'الحجز اتلغى. الاسترداد حسب سياسة الإلغاء بتاعة العيادة اللي اتعرضت فوق.', msa: 'تم إلغاء الحجز. يتم الاسترداد وفق سياسة إلغاء العيادة الموضحة أعلاه.' }) }),
  reschedulePrompt: (d: Dialect, x: { doctor: string; oldStartsAt: string; newStartsAt: string }, confirmId: string, declineId: string): Rendered => ({
    key: 'reschedule_prompt',
    body: pick(d, { en: `Move your visit with ${x.doctor} from ${t(x.oldStartsAt, d)} to ${t(x.newStartsAt, d)}? Press Confirm to move it.`, eg: `تنقل زيارتك مع ${x.doctor} من ${t(x.oldStartsAt, d)} إلى ${t(x.newStartsAt, d)}؟ اضغط تأكيد عشان تنقلها.`, msa: `هل تريد نقل زيارتك مع ${x.doctor} من ${t(x.oldStartsAt, d)} إلى ${t(x.newStartsAt, d)}؟ اضغط تأكيد للنقل.` }),
    buttons: [{ id: confirmId, title: pick(d, { en: 'Confirm', eg: 'تأكيد', msa: 'تأكيد' }) }, { id: declineId, title: pick(d, { en: 'Keep time', eg: 'سيب الموعد', msa: 'إبقاء الموعد' }) }],
  }),
  rescheduled: (d: Dialect, x: { doctor: string; startsAt: string }): Rendered => ({ key: 'rescheduled', body: pick(d, { en: `Moved: ${x.doctor}, ${t(x.startsAt, d)}.`, eg: `اتنقل: ${x.doctor}، ${t(x.startsAt, d)}.`, msa: `تم النقل: ${x.doctor}، ${t(x.startsAt, d)}.` }) }),
  waitlisted: (d: Dialect): Rendered => ({ key: 'waitlisted', body: pick(d, { en: 'You are on the waitlist. We will message you when a time opens.', eg: 'اتضفت لقائمة الانتظار. هنبعتلك لما يفضى ميعاد.', msa: 'تمت إضافتك إلى قائمة الانتظار. سنراسلك عند توفر موعد.' }) }),
  waitlistUnavailable: (d: Dialect): Rendered => ({ key: 'waitlist_unavailable', body: pick(d, { en: 'The waitlist is not available right now. Try another day or say "agent".', eg: 'قائمة الانتظار مش متاحة دلوقتي. جرّب يوم تاني أو قول "موظف".', msa: 'قائمة الانتظار غير متاحة حالياً. جرّب يوماً آخر أو اكتب "موظف".' }) }),
  link: (d: Dialect, url: string, why: 'BOOK' | 'VERIFY' | 'PAY'): Rendered => ({ key: `link_${why.toLowerCase()}`, body: pick(d, why === 'VERIFY' ? { en: `To book I need to verify your number first. Open this one-time link (valid 15 minutes): ${url}`, eg: `عشان أحجزلك لازم نتأكد من رقمك الأول. افتح الرابط ده (مرة واحدة وشغال ١٥ دقيقة): ${url}`, msa: `للحجز يجب التحقق من رقمك أولاً. افتح هذا الرابط (لمرة واحدة وصالح ١٥ دقيقة): ${url}` } : { en: `Continue securely here (one-time link, valid 15 minutes): ${url}`, eg: `كمّل من هنا بأمان (رابط لمرة واحدة وشغال ١٥ دقيقة): ${url}`, msa: `تابع من هنا بأمان (رابط لمرة واحدة وصالح ١٥ دقيقة): ${url}` }) }),
  /** Invite to give the AI_PROCESSING consent (wording is a counsel placeholder: TODO_NEEDS_HUMAN_v0, H-5). One-time link, 15 minutes; nothing is switched on by this message. */
  consentInvite: (d: Dialect, url: string): Rendered => ({ key: 'consent_invite', body: pick(d, { en: `To let our automated assistant help you with bookings, you can allow AI processing of your messages in your account. This is optional and you can withdraw it at any time. Open this one-time link (valid 15 minutes): ${url}`, eg: `لو عايز المساعد الآلي يساعدك في الحجز، تقدر تسمح بمعالجة رسايلك بالذكاء الاصطناعي من حسابك. ده اختياري وتقدر تلغيه في أي وقت. افتح اللينك ده (صالح ١٥ دقيقة): ${url}`, msa: `لتمكين المساعد الآلي من مساعدتك في الحجز يمكنك السماح بمعالجة رسائلك بالذكاء الاصطناعي من حسابك. هذا اختياري ويمكنك سحبه في أي وقت. افتح هذا الرابط (صالح ١٥ دقيقة): ${url}` }) }),
  handoff: (d: Dialect, slaMinutes: number): Rendered => ({ key: 'handoff', body: pick(d, { en: `I passed your request to our team. A person will reply here, usually within ${slaMinutes} minutes during working hours. I will stay quiet until then.`, eg: `حوّلت طلبك لفريقنا. حد هيرد عليك هنا، غالباً خلال ${slaMinutes} دقيقة في ساعات العمل. هسكت لحد ما يردوا.`, msa: `تمت إحالة طلبك إلى فريقنا. سيرد عليك شخص هنا، عادةً خلال ${slaMinutes} دقيقة في ساعات العمل. سألتزم الصمت حتى ذلك الحين.` }) }),
  emergency: (d: Dialect): Rendered => ({ key: 'emergency', body: langOf(d) === 'ar' ? EMERGENCY_GUIDANCE.messageAr : EMERGENCY_GUIDANCE.messageEn }),
  medicalRedirect: (d: Dialect): Rendered => ({ key: 'medical_redirect', body: pick(d, { en: 'I cannot give medical advice. A doctor can: I can help you pick a specialty and book. For anything urgent call 123. Say "agent" to talk to a person.', eg: 'مقدرش أدّي نصيحة طبية. الدكتور هو اللي يقدر: أقدر أساعدك تختار تخصص وتحجز. لو الموضوع مستعجل كلّم ١٢٣. قول "موظف" لو عايز تكلم حد.', msa: 'لا يمكنني تقديم نصيحة طبية؛ الطبيب هو من يقدر على ذلك. أستطيع مساعدتك في اختيار التخصص والحجز. في الحالات العاجلة اتصل بالرقم ١٢٣. اكتب "موظف" للتحدث مع شخص.' }) }),
  refuse: (d: Dialect): Rendered => ({ key: 'refuse', body: pick(d, { en: 'I can only help with booking, changing or cancelling your own appointments. Tell me the specialty you need, or say "agent".', eg: 'أنا بساعد بس في حجز أو تغيير أو إلغاء مواعيدك إنت. قولي التخصص اللي محتاجه، أو قول "موظف".', msa: 'يمكنني فقط المساعدة في حجز مواعيدك أو تغييرها أو إلغائها. أخبرني بالتخصص الذي تحتاجه، أو اكتب "موظف".' }) }),
  clarify: (d: Dialect, slot: ClarifySlot): Rendered => ({ key: `clarify_${slot}`, body: pick(d, slot === 'specialty' ? { en: 'Which specialty do you need? Reply with a number or a name.', eg: 'محتاج أنهي تخصص؟ ابعت رقم أو اسم.', msa: 'أي تخصص تحتاج؟ أرسل رقماً أو اسماً.' } : slot === 'date' ? { en: 'Which day suits you (today, tomorrow...)?', eg: 'أنهي يوم يناسبك (النهارده، بكرة...)؟', msa: 'أي يوم يناسبك (اليوم، غداً...)؟' } : { en: 'I did not catch that. Reply with a number from the list, or tell me what you need (book, change, cancel), or say "agent".', eg: 'مفهمتش. ابعت رقم من القايمة، أو قولي عايز إيه (حجز، تغيير، إلغاء)، أو قول "موظف".', msa: 'لم أفهم. أرسل رقماً من القائمة، أو أخبرني بما تريد (حجز، تغيير، إلغاء)، أو اكتب "موظف".' }) }),
  thanks: (d: Dialect): Rendered => ({ key: 'thanks', body: pick(d, { en: 'You are welcome. Message me any time you want to book.', eg: 'العفو. ابعتلي أي وقت عايز تحجز.', msa: 'على الرحب والسعة. راسلني في أي وقت للحجز.' }) }),
  unverified: (d: Dialect): Rendered => ({ key: 'unverified_notice', body: pick(d, { en: 'I can show you doctors and times, but to book or manage bookings your number must be verified first.', eg: 'أقدر أوريك الدكاترة والمواعيد، بس عشان تحجز أو تدير حجوزاتك لازم رقمك يتأكد الأول.', msa: 'يمكنني عرض الأطباء والمواعيد، لكن للحجز أو إدارة الحجوزات يجب التحقق من رقمك أولاً.' }) }),
  media: (d: Dialect): Rendered => ({ key: 'media', body: pick(d, { en: 'I can only read text messages. Please type what you need.', eg: 'بقرا الرسايل النصية بس. اكتب اللي محتاجه.', msa: 'أستطيع قراءة الرسائل النصية فقط. اكتب ما تحتاجه من فضلك.' }) }),
  tooLong: (d: Dialect): Rendered => ({ key: 'too_long', body: pick(d, { en: 'That message is too long. Please send a shorter one (under 1,000 characters).', eg: 'الرسالة طويلة. ابعت رسالة أقصر (أقل من ١٠٠٠ حرف).', msa: 'الرسالة طويلة جداً. أرسل رسالة أقصر (أقل من ١٠٠٠ حرف).' }) }),
  rateLimited: (d: Dialect): Rendered => ({ key: 'rate_limited', body: pick(d, { en: 'You are sending messages very fast. Please wait a little and try again.', eg: 'بتبعت رسايل بسرعة. استنى شوية وجرّب تاني.', msa: 'ترسل رسائل بسرعة كبيرة. انتظر قليلاً ثم حاول مجدداً.' }) }),
  slotTaken: (d: Dialect): Rendered => ({ key: 'slot_taken', body: pick(d, { en: 'Sorry, that time was just taken. Pick another one.', eg: 'للأسف الميعاد ده اتحجز. اختار ميعاد تاني.', msa: 'عذراً، تم حجز هذا الموعد للتو. اختر موعداً آخر.' }) }),
  busy: (d: Dialect): Rendered => ({ key: 'busy', body: pick(d, { en: 'The clinic system is busy. Please try again shortly.', eg: 'نظام العيادة مشغول دلوقتي. جرّب كمان شوية.', msa: 'نظام العيادة مشغول حالياً. حاول بعد قليل.' }) }),
  generic: (d: Dialect): Rendered => ({ key: 'generic', body: pick(d, { en: 'I could not complete that. Nothing was changed. Say "agent" and a person will help.', eg: 'معرفتش أكمل الطلب ده. مفيش حاجة اتغيرت. قول "موظف" وهنساعدك.', msa: 'تعذر إكمال الطلب. لم يتغير شيء. اكتب "موظف" وسيساعدك أحد.' }) }),
};
export function reply(intent: ReplyIntent, d: Dialect): Rendered {
  switch (intent) {
    case 'greet': case 'offer_help': return R.greet(d);
    case 'ask_specialty': return R.askSpecialty(d, SHOWN_SPECIALTY_CODES);
    case 'symptom_choose_specialty': return R.askSpecialty(d, SHOWN_SPECIALTY_CODES, 'symptom');
    case 'use_buttons': return R.useButtons(d);
    case 'thanks': return R.thanks(d);
    case 'medical_redirect': return R.medicalRedirect(d);
    case 'unverified_notice': return R.unverified(d);
    default: return R.clarify(d, 'any');
  }
}
const statusLabel = (s: string, d: Dialect) => ({ CONFIRMED: { en: 'confirmed', eg: 'مؤكد', msa: 'مؤكد' }, PENDING_CLINIC: { en: 'awaiting clinic', eg: 'مستني العيادة', msa: 'بانتظار العيادة' } } as Record<string, V>)[s] ? pick(d, ({ CONFIRMED: { en: 'confirmed', eg: 'مؤكد', msa: 'مؤكد' }, PENDING_CLINIC: { en: 'awaiting clinic', eg: 'مستني العيادة', msa: 'بانتظار العيادة' } } as Record<string, V>)[s]) : s;
function refundLine(d: Dialect, x: { depositMinor?: number | null; currency?: string; depositRefundable?: boolean | null }): string {
  const m = money(x.depositMinor, x.currency);
  if (!m) return pick(d, { en: 'No deposit was paid, so there is nothing to refund.', eg: 'مفيش عربون اتدفع، فمفيش حاجة تتسترد.', msa: 'لم يُدفع عربون، لذا لا يوجد مبلغ للاسترداد.' });
  if (x.depositRefundable === true) return pick(d, { en: `Your deposit of ${m} is refundable under the clinic cancellation policy.`, eg: `العربون ${m} قابل للاسترداد حسب سياسة العيادة.`, msa: `العربون البالغ ${m} قابل للاسترداد وفق سياسة العيادة.` });
  if (x.depositRefundable === false) return pick(d, { en: `Your deposit of ${m} is not refundable at this time under the clinic cancellation policy.`, eg: `العربون ${m} مش قابل للاسترداد دلوقتي حسب سياسة العيادة.`, msa: `العربون البالغ ${m} غير قابل للاسترداد حالياً وفق سياسة العيادة.` });
  return pick(d, { en: `Your deposit of ${m} is handled by the clinic cancellation policy.`, eg: `العربون ${m} بيتعامل حسب سياسة الإلغاء بتاعة العيادة.`, msa: `يُعامل العربون البالغ ${m} وفق سياسة إلغاء العيادة.` });
}
