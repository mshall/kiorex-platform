import { cfg } from '../common/config';
import { marketClock } from '../common/market-time';
import { SPECIALTY_LABELS, SpecialtyCode } from '../safety/safety-public';

/**
 * WhatsApp conversation copy. Replies inside the 24 h customer-service window are free-form, but the wording is DRAFT:
 * consent text, clinical wording and Meta-approved templates are NEEDS_HUMAN (Docs/NEEDS_HUMAN.md #5, #11). Template ids are
 * `TODO_NEEDS_HUMAN_*` placeholders; nothing here is a final approved template.
 */
export type Lang = 'ar' | 'en';
export const T = (id: string) => `TODO_NEEDS_HUMAN_wa_booking_${id}`;

const num = (i: number) => `${i + 1}`;
export const fmtTime = (iso: string, lang: Lang) => marketClock(iso, lang); // Africa/Cairo with DST: the old fixed +2 h offset showed every summer time one hour early

export const copy = {
  appLink: (lang: Lang) => (lang === 'ar' ? `يمكنك الحجز من تطبيق كيوريكس: ${cfg().appLinkBase}` : `You can book in the Kiorex app: ${cfg().appLinkBase}`),
  notRegistered: (lang: Lang) => (lang === 'ar' ? `لم نجد حسابًا بهذا الرقم. أنشئ حسابك أولًا من التطبيق ثم عد إلينا: ${cfg().appLinkBase}` : `We could not find an account for this number. Create your account first, then come back: ${cfg().appLinkBase}`),
  emergency: (lang: Lang) => (lang === 'ar' ? 'NEEDS_HUMAN_APPROVAL: قد تكون هذه حالة طارئة. اتصل بالرقم 123 (الإسعاف) الآن. الحجز غير متاح للحالات الطارئة.' : 'NEEDS_HUMAN_APPROVAL: This may be an emergency. Call 123 (ambulance) now. Booking is not available for emergencies.'),
  chooseSpecialty: (lang: Lang, codes: SpecialtyCode[]) =>
    (lang === 'ar' ? 'أهلًا بك في كيوريكس. اختر التخصص بالرقم (أو اكتب الأعراض):\n' : 'Welcome to Kiorex. Pick a specialty by number (or describe what you need):\n') + codes.map((c, i) => `${num(i)}. ${SPECIALTY_LABELS[c][lang]}`).join('\n') + (lang === 'ar' ? '\n0. إلغاء' : '\n0. Cancel'),
  noDoctors: (lang: Lang) => (lang === 'ar' ? 'لا يوجد أطباء متاحون لهذا التخصص الآن. اختر تخصصًا آخر أو أرسل 0 للإلغاء.' : 'No doctors are available for that specialty right now. Pick another or send 0 to cancel.'),
  chooseDoctor: (lang: Lang, docs: { name: string; fee?: number | null; currency?: string }[]) =>
    (lang === 'ar' ? 'اختر الطبيب بالرقم:\n' : 'Pick a doctor by number:\n') + docs.map((d, i) => `${num(i)}. ${d.name}${d.fee ? ` — ${d.fee / 100} ${d.currency ?? 'EGP'}` : ''}`).join('\n'),
  chooseSlot: (lang: Lang, slots: { startsAt: string }[]) => (lang === 'ar' ? 'اختر الموعد بالرقم:\n' : 'Pick a time by number:\n') + slots.map((s, i) => `${num(i)}. ${fmtTime(s.startsAt, lang)}`).join('\n'),
  noSlots: (lang: Lang) => (lang === 'ar' ? 'لا توجد مواعيد متاحة حاليًا. أرسل نعم للانضمام إلى قائمة الانتظار أو 0 للإلغاء.' : 'No slots are available right now. Reply YES to join the waitlist or 0 to cancel.'),
  slotTaken: (lang: Lang) => (lang === 'ar' ? 'للأسف تم حجز هذا الموعد. هذه مواعيد بديلة:' : 'Sorry, that slot was just taken. Alternatives:'),
  heldConfirm: (lang: Lang, doctor: string, startsAt: string) =>
    lang === 'ar'
      ? `حجزنا لك مؤقتًا موعدًا مع ${doctor} في ${fmtTime(startsAt, lang)} لمدة ٥ دقائق.\nTODO_NEEDS_HUMAN (صياغة الموافقة): بالرد بـ نعم توافق على مشاركة بيانات حجزك مع العيادة.\nأرسل نعم للتأكيد أو لا للإلغاء.`
      : `We are holding ${doctor} at ${fmtTime(startsAt, lang)} for 5 minutes.\nTODO_NEEDS_HUMAN (consent wording): by replying YES you agree to share your booking details with the clinic.\nReply YES to confirm or NO to cancel.`,
  confirmed: (lang: Lang, doctor: string, startsAt: string, pending: boolean) =>
    lang === 'ar'
      ? pending ? `تم إرسال طلبك مع ${doctor} (${fmtTime(startsAt, lang)}) وهو في انتظار تأكيد العيادة.` : `تم تأكيد موعدك مع ${doctor} في ${fmtTime(startsAt, lang)}.`
      : pending ? `Your request with ${doctor} (${fmtTime(startsAt, lang)}) is awaiting clinic confirmation.` : `Your visit with ${doctor} is confirmed for ${fmtTime(startsAt, lang)}.`,
  deposit: (lang: Lang, url: string) => (lang === 'ar' ? `يلزم دفع عربون لإتمام الحجز: ${url}` : `A deposit is required to complete this booking: ${url}`),
  holdExpired: (lang: Lang) => (lang === 'ar' ? 'انتهت مهلة الحجز المؤقت. اختر موعدًا جديدًا:' : 'The hold expired. Please pick a new time:'),
  cancelled: (lang: Lang) => (lang === 'ar' ? 'تم الإلغاء. أرسل أي رسالة للبدء من جديد.' : 'Cancelled. Send any message to start again.'),
  busy: (lang: Lang) => (lang === 'ar' ? 'نظام العيادة مشغول الآن. حاول بعد قليل.' : 'The clinic system is busy. Please try again shortly.'),
  waitlisted: (lang: Lang) => (lang === 'ar' ? 'تمت إضافتك إلى قائمة الانتظار. سنرسل لك عند توفر موعد.' : 'You are on the waitlist. We will message you when a slot opens.'),
  stopped: (lang: Lang) => (lang === 'ar' ? 'تم إيقاف رسائل واتساب من كيوريكس. يمكنك إعادة تفعيلها من التطبيق.' : 'WhatsApp messages from Kiorex are turned off. You can turn them back on in the app.'),
  invalid: (lang: Lang) => (lang === 'ar' ? 'لم أفهم اختيارك. أرسل رقمًا من القائمة أو 0 للإلغاء.' : 'I did not understand. Send a number from the list, or 0 to cancel.'),
  generic: (lang: Lang) => (lang === 'ar' ? 'تعذر إكمال الطلب. يمكنك المتابعة من التطبيق: ' + cfg().appLinkBase : 'We could not complete that. You can continue in the app: ' + cfg().appLinkBase),
};
