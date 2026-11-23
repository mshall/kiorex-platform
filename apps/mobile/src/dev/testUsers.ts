/** DEV ONLY synthetic patients (kiorex-account/config/seed-users.json, DEMO_DATA.md). Passport dev OTP is always 000000. */
export const DEV_OTP = "000000";
export const DEV_PATIENTS: { phone: string; name: string; note: { en: string; ar: string } }[] = [
  { phone: "+201000001001", name: "Hoda Mahmoud", note: { en: "richest history, 2 dependants", ar: "أغنى سجل، تابعان" } },
  { phone: "+201000001002", name: "Samir Ali Nassar", note: { en: "co-guardian, telemedicine waiting", ar: "وصي مشارك، استشارة بانتظار" } },
  { phone: "+201000001003", name: "Karim Mostafa", note: { en: "guardian of a 15 y teen", ar: "وصي على مراهق" } },
  { phone: "+201000001004", name: "Nourhan Fathy", note: { en: "pharmacy order READY, lab unpaid", ar: "طلب صيدلية جاهز" } },
  { phone: "+201000001005", name: "Mahmoud El-Sayed", note: { en: "cardiology, physio series", ar: "قلب، علاج طبيعي" } },
  { phone: "+201000001006", name: "Mariam Adel", note: { en: "confirmed booking, video visit", ar: "حجز مؤكد وزيارة فيديو" } },
  { phone: "+201000001007", name: "Omar Hegazy", note: { en: "ortho, lab collected", ar: "عظام، عينة مسحوبة" } },
  { phone: "+201000001008", name: "Dalia Ibrahim", note: { en: "no-show, lab result released", ar: "تغيب، نتيجة جاهزة" } },
  { phone: "+201000001009", name: "Tarek Zaki", note: { en: "checked in today", ar: "وصل اليوم" } },
  { phone: "+201000001010", name: "Heba Salah", note: { en: "cancelled and refunded", ar: "إلغاء واسترداد" } },
  { phone: "+201000001011", name: "Youssef Ramadan", note: { en: "dentistry, lab cancelled", ar: "أسنان" } },
  { phone: "+201000001012", name: "Rana Khaled", note: { en: "refunded, agency client", ar: "استرداد، عميلة وكالة" } },
  { phone: "+201000001013", name: "Nabila Hamdy", note: { en: "home-care plan (10 visits)", ar: "خطة رعاية منزلية" } },
];
