export type Lang = 'ar' | 'en';
type Dict = Record<string, string>;

/** Widget strings (AR/EN). Consent wording is a draft until counsel signs it (NEEDS_HUMAN, same status as the patient app). */
const en: Dict = {
  title: 'Book an appointment', loading: 'Loading availability', retry: 'Try again', back: 'Back', next: 'Continue',
  steps: 'Booking steps', step1: 'Doctor and visit', step2: 'Time', step3: 'Confirm', step4: 'Done',
  chooseDoctor: 'Choose a doctor', chooseVisit: 'Choose a visit type', chooseSpecialty: 'Specialty', allSpecialties: 'All specialties',
  fee: 'Fee', reviews: 'reviews', noDoctors: 'No doctors are available for online booking here yet.', noDoctorsHelp: 'Please contact the clinic directly.',
  chooseDay: 'Choose a day', chooseTime: 'Choose a time', noSlots: 'No free times in the next two weeks.', moreDates: 'Look further ahead', slotsFailed: 'Could not load times.',
  free: 'free times', signInTitle: 'Confirm with your phone', signInBody: 'Sign in with your phone number to confirm. We send a one-time code; no password needed.', signIn: 'Continue with phone number',
  signingIn: 'Waiting for sign-in', signInCancelled: 'Sign-in was closed. You can try again.', signInBlocked: 'The sign-in window was blocked. Allow pop-ups for this page and try again.', signedIn: 'Signed in',
  holding: 'We are holding this time for you', timeLeft: 'Time left', expired: 'The hold expired. Please choose a time again.', summary: 'Your visit', when: 'When', who: 'Doctor', visit: 'Visit',
  consent: 'I agree that Kiorex shares my name and phone number with the clinic to make this booking.', consentDraft: 'Draft wording, pending legal review.', reminders: 'Send me appointment reminders (optional)',
  analytics: 'Help improve online booking with anonymous statistics (optional)', confirm: 'Confirm booking', confirming: 'Confirming',
  slotTaken: 'Someone just took that time.', pickAnother: 'Pick another time', alternatives: 'Nearby times',
  doneTitle: 'Your booking is in', doneConfirmed: 'Confirmed', donePending: 'Waiting for the clinic to confirm', doneText: 'You will get updates by SMS or in the Kiorex app.',
  openApp: 'Open in the Kiorex app', openAppHint: 'No app yet? The link takes you to the store.', deposit: 'Pay the deposit', depositNote: 'A deposit is needed to keep this time.', bookAnother: 'Book another time',
  offline: 'You are offline. Reconnect to continue.', errTitle: 'Something went wrong', errGeneric: 'We could not complete that. Please try again.', errRate: 'Too many attempts. Please wait a minute.',
  errOrigin: 'This website is not allowed to show the booking form.', errFlag: 'Online booking is paused right now.', errNotFound: 'This booking form could not be found.', errSession: 'Your session expired. Reload the page.',
  errHold: 'You already hold the maximum number of times. Finish or release one first.', errUnavailable: 'The clinic system is busy. Try again in a moment.', brandLine: 'Booking by Kiorex', logoAlt: 'Clinic logo',
  currency: 'EGP', required: 'Please accept to continue.', nameLabel: 'Your full name', nameHelp: 'As it should appear on your booking. Your phone number comes from your sign-in.', saveContinue: 'Save and continue', nameRequired: 'Please enter your name.',
};
const ar: Dict = {
  title: 'احجز موعدك', loading: 'جارٍ تحميل المواعيد', retry: 'حاول مرة أخرى', back: 'رجوع', next: 'متابعة',
  steps: 'خطوات الحجز', step1: 'الطبيب والزيارة', step2: 'الموعد', step3: 'التأكيد', step4: 'تم',
  chooseDoctor: 'اختر الطبيب', chooseVisit: 'اختر نوع الزيارة', chooseSpecialty: 'التخصص', allSpecialties: 'كل التخصصات',
  fee: 'الرسوم', reviews: 'تقييم', noDoctors: 'لا يوجد أطباء متاحون للحجز الإلكتروني هنا حتى الآن.', noDoctorsHelp: 'من فضلك تواصل مع العيادة مباشرة.',
  chooseDay: 'اختر اليوم', chooseTime: 'اختر الوقت', noSlots: 'لا توجد مواعيد متاحة خلال الأسبوعين القادمين.', moreDates: 'عرض مواعيد أبعد', slotsFailed: 'تعذر تحميل المواعيد.',
  free: 'موعد متاح', signInTitle: 'أكّد برقم هاتفك', signInBody: 'سجّل الدخول برقم هاتفك للتأكيد. سنرسل رمزًا لمرة واحدة بدون كلمة مرور.', signIn: 'المتابعة برقم الهاتف',
  signingIn: 'في انتظار تسجيل الدخول', signInCancelled: 'تم إغلاق نافذة تسجيل الدخول. يمكنك المحاولة مرة أخرى.', signInBlocked: 'تم حظر نافذة تسجيل الدخول. اسمح بالنوافذ المنبثقة لهذه الصفحة وحاول مرة أخرى.', signedIn: 'تم تسجيل الدخول',
  holding: 'نحجز هذا الموعد لك', timeLeft: 'الوقت المتبقي', expired: 'انتهت مدة الحجز المؤقت. اختر موعدًا مرة أخرى.', summary: 'زيارتك', when: 'الموعد', who: 'الطبيب', visit: 'الزيارة',
  consent: 'أوافق على أن تشارك كيوريكس اسمي ورقم هاتفي مع العيادة لإتمام هذا الحجز.', consentDraft: 'صيغة مبدئية بانتظار المراجعة القانونية.', reminders: 'أرسلوا لي تذكيرات بالموعد (اختياري)',
  analytics: 'ساعد في تحسين الحجز الإلكتروني بإحصاءات مجهولة (اختياري)', confirm: 'تأكيد الحجز', confirming: 'جارٍ التأكيد',
  slotTaken: 'حجز شخص آخر هذا الموعد للتو.', pickAnother: 'اختر موعدًا آخر', alternatives: 'مواعيد قريبة',
  doneTitle: 'تم استلام حجزك', doneConfirmed: 'مؤكد', donePending: 'في انتظار تأكيد العيادة', doneText: 'ستصلك التحديثات برسالة نصية أو داخل تطبيق كيوريكس.',
  openApp: 'افتح في تطبيق كيوريكس', openAppHint: 'ليس لديك التطبيق؟ سيأخذك الرابط إلى المتجر.', deposit: 'ادفع العربون', depositNote: 'يلزم دفع عربون للاحتفاظ بهذا الموعد.', bookAnother: 'احجز موعدًا آخر',
  offline: 'أنت غير متصل. أعد الاتصال للمتابعة.', errTitle: 'حدث خطأ', errGeneric: 'تعذر إتمام ذلك. حاول مرة أخرى.', errRate: 'محاولات كثيرة. انتظر دقيقة.',
  errOrigin: 'هذا الموقع غير مسموح له بعرض نموذج الحجز.', errFlag: 'الحجز الإلكتروني متوقف مؤقتًا.', errNotFound: 'لم نعثر على نموذج الحجز هذا.', errSession: 'انتهت الجلسة. أعد تحميل الصفحة.',
  errHold: 'لديك بالفعل الحد الأقصى من المواعيد المحجوزة. أنهِ أحدها أو أفرج عنه أولًا.', errUnavailable: 'نظام العيادة مشغول. حاول بعد قليل.', brandLine: 'الحجز عبر كيوريكس', logoAlt: 'شعار العيادة',
  currency: 'ج.م', required: 'من فضلك وافق للمتابعة.', nameLabel: 'اسمك الكامل', nameHelp: 'كما سيظهر في حجزك. رقم هاتفك يأتي من تسجيل الدخول.', saveContinue: 'حفظ ومتابعة', nameRequired: 'من فضلك أدخل اسمك.',
};
export const STRINGS: Record<Lang, Dict> = { en, ar };
export const t = (lang: Lang, key: string): string => STRINGS[lang][key] ?? STRINGS.en[key] ?? key;
