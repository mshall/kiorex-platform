/** District codes are slugs ("nasr-city"); show a localized name (the API only ever exchanges the code). Mirrors apps/mobile/src/lib/homecare.ts. */
const AR_DISTRICTS: Record<string, string> = {
  "nasr-city": "مدينة نصر", maadi: "المعادي", heliopolis: "مصر الجديدة", zamalek: "الزمالك", dokki: "الدقي", mohandessin: "المهندسين", "new-cairo": "القاهرة الجديدة",
  "sheikh-zayed": "الشيخ زايد", "6th-october": "السادس من أكتوبر", shubra: "شبرا", giza: "الجيزة", "5th-settlement": "التجمع الخامس", mansoura: "المنصورة",
};
export const districtLabel = (code: string | null | undefined, lang: string): string => {
  if (!code) return "";
  if (lang.startsWith("ar") && AR_DISTRICTS[code]) return AR_DISTRICTS[code];
  return code.split("-").map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(" ");
};
