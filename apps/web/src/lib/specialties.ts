// Specialty code -> AR/EN label. GET /specialties is the preferred source (see useSpecialtyLabel); this complete map covers every code
// the platform can emit (Kiorly clinical specialties + the Kiorex catalogue + spelling aliases) so a raw code is never shown.
import type { Specialty } from "@/api/types";

export const SPECIALTY_LABELS: Record<string, { en: string; ar: string }> = {
  polyclinic: { en: "Polyclinic", ar: "عيادات متعددة التخصصات" },
  general_medicine: { en: "General medicine", ar: "الطب العام" },
  pain_management: { en: "Pain management", ar: "علاج الألم" },
  orthopedics: { en: "Orthopaedics", ar: "العظام" },
  pediatrics: { en: "Paediatrics", ar: "الأطفال" },
  dermatology: { en: "Dermatology", ar: "الجلدية" },
  dentistry: { en: "Dentistry", ar: "الأسنان" },
  physio_therapy: { en: "Physiotherapy", ar: "العلاج الطبيعي" },
  aesthetics: { en: "Aesthetics", ar: "التجميل" },
  cardiology: { en: "Cardiology", ar: "القلب" },
  obstetrics_gynecology: { en: "Obstetrics & Gynaecology", ar: "النساء والتوليد" },
  ent: { en: "ENT", ar: "الأنف والأذن والحنجرة" },
  ophthalmology: { en: "Ophthalmology", ar: "العيون" },
  psychiatry: { en: "Psychiatry", ar: "الطب النفسي" },
  radiology: { en: "Radiology", ar: "الأشعة" },
  laboratory: { en: "Laboratory", ar: "المعمل" },
  internal_medicine: { en: "Internal medicine", ar: "الباطنة" },
  family_medicine: { en: "Family medicine", ar: "طب الأسرة" },
  urology: { en: "Urology", ar: "المسالك البولية" },
  nursing: { en: "Home nursing", ar: "التمريض المنزلي" },
  home_nursing: { en: "Home nursing", ar: "التمريض المنزلي" },
  other: { en: "Other", ar: "أخرى" },
};

/** Spelling aliases the API/catalogue uses (paediatrics, orthopaedics, obgyn, ...). */
const ALIASES: Record<string, string> = {
  paediatrics: "pediatrics", paediatric: "pediatrics", orthopaedics: "orthopedics", obgyn: "obstetrics_gynecology", ob_gyn: "obstetrics_gynecology",
  obstetrics_gynaecology: "obstetrics_gynecology", physiotherapy: "physio_therapy", physical_therapy: "physio_therapy", ear_nose_throat: "ent",
  general_practice: "general_medicine", gp: "general_medicine", dental: "dentistry", internal: "internal_medicine",
};

export const normalizeSpecialty = (code: string) => {
  const k = code.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return ALIASES[k] ?? k;
};
export const isKnownSpecialty = (code: string) => normalizeSpecialty(code) in SPECIALTY_LABELS;

/** Last resort for a code nobody mapped yet: humanised ("sports_medicine" -> "Sports medicine"), never the raw snake_case code. */
const humanise = (code: string) => { const s = code.replace(/[_-]+/g, " ").trim().toLowerCase(); return s.charAt(0).toUpperCase() + s.slice(1); };

export function specialtyLabel(code: string | null | undefined, lang: string, catalogue?: Specialty[]): string {
  if (!code) return "";
  const ar = lang.startsWith("ar");
  const hit = catalogue?.find((s) => s.code === code && (ar ? s.nameAr : s.nameEn) && (ar ? s.nameAr : s.nameEn) !== code);
  if (hit) return ar ? hit.nameAr : hit.nameEn;
  const m = SPECIALTY_LABELS[normalizeSpecialty(code)];
  if (m) return ar ? m.ar : m.en;
  return humanise(code);
}
