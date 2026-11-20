// Mock-server fixtures. Used only when VITE_MOCK=1 (dev / Playwright mock mode) and in unit tests.
// Shapes follow the OpenAPI contract in src/api/schema.d.ts. Not imported by production code paths.
import type { Clinic, DoctorProfile, DoctorSummary, Review, Slot, Specialty, VisitType } from "@/api/types";

export const specialties: Specialty[] = [
  { code: "paediatrics", nameAr: "أطفال", nameEn: "Paediatrics" },
  { code: "dermatology", nameAr: "جلدية", nameEn: "Dermatology" },
  { code: "cardiology", nameAr: "قلب", nameEn: "Cardiology" },
  { code: "obgyn", nameAr: "نساء وتوليد", nameEn: "OB/GYN" },
  { code: "dentistry", nameAr: "أسنان", nameEn: "Dentistry" },
  { code: "orthopaedics", nameAr: "عظام", nameEn: "Orthopaedics" },
  { code: "ent", nameAr: "أنف وأذن وحنجرة", nameEn: "ENT" },
  { code: "internal-medicine", nameAr: "باطنة", nameEn: "Internal medicine" },
];

const clinic = (id: string, nameAr: string, nameEn: string, areaAr: string, areaEn: string): Clinic => ({
  id, nameAr, nameEn, addressAr: `${areaAr}، القاهرة`, addressEn: `${areaEn}, Cairo`, phone: "+20 2 5555 0100",
  lat: 30.05, lng: 31.34, paymentMethods: ["cash", "card", "instapay"],
  hoursAr: ["السبت – الخميس: ١٠ ص – ٨ م"], hoursEn: ["Sat – Thu: 10:00 – 20:00"],
});

export const clinics: Record<string, Clinic> = {
  c1: clinic("c1", "عيادات الندى", "Al-Nada Clinics", "مدينة نصر", "Nasr City"),
  c2: clinic("c2", "مركز الواحة الطبي", "Al-Waha Medical Centre", "المهندسين", "Mohandessin"),
  c3: clinic("c3", "عيادة التجمع", "Tagamoa Clinic", "التجمع الخامس", "Fifth Settlement"),
};

const vt = (id: string, nameAr: string, nameEn: string, feeEgp: number, deposit: number | null): VisitType => ({
  id, nameAr, nameEn, feeEgp, durationMin: 20, depositRequired: deposit !== null, depositEgp: deposit,
});

interface Seed { id: string; nameAr: string; nameEn: string; spec: string; clinic: string; areaAr: string; areaEn: string; fee: number; deposit: number | null; rating: number | null; count: number; gender: "F" | "M"; km: number; manual?: boolean }
export const seeds: Seed[] = [
  { id: "d1", nameAr: "د. ليلى حسن", nameEn: "Dr. Laila Hassan", spec: "paediatrics", clinic: "c1", areaAr: "مدينة نصر", areaEn: "Nasr City", fee: 350, deposit: null, rating: 4.8, count: 126, gender: "F", km: 2.4 },
  { id: "d2", nameAr: "د. كريم منصور", nameEn: "Dr. Karim Mansour", spec: "cardiology", clinic: "c2", areaAr: "المهندسين", areaEn: "Mohandessin", fee: 600, deposit: 150, rating: 4.6, count: 88, gender: "M", km: 7.9, manual: true },
  { id: "d3", nameAr: "د. هالة فؤاد", nameEn: "Dr. Hala Fouad", spec: "dermatology", clinic: "c3", areaAr: "التجمع الخامس", areaEn: "Fifth Settlement", fee: 450, deposit: null, rating: null, count: 0, gender: "F", km: 14.2 },
  { id: "d4", nameAr: "د. ياسر عبد الله", nameEn: "Dr. Yasser Abdallah", spec: "orthopaedics", clinic: "c1", areaAr: "مدينة نصر", areaEn: "Nasr City", fee: 500, deposit: 100, rating: 4.4, count: 41, gender: "M", km: 2.4 },
  { id: "d5", nameAr: "د. منى سالم", nameEn: "Dr. Mona Salem", spec: "obgyn", clinic: "c3", areaAr: "التجمع الخامس", areaEn: "Fifth Settlement", fee: 400, deposit: null, rating: 4.9, count: 203, gender: "F", km: 14.2 },
  { id: "d6", nameAr: "د. طارق إبراهيم", nameEn: "Dr. Tarek Ibrahim", spec: "dentistry", clinic: "c2", areaAr: "المهندسين", areaEn: "Mohandessin", fee: 300, deposit: null, rating: 4.2, count: 57, gender: "M", km: 7.9 },
];

const baseDay = () => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); return d; };

/** Deterministic slot grid: next 10 days, 07:00–13:40 UTC, 20-min steps skipping some for realism. */
export function slotsFor(doctorId: string, visitTypeId: string): Slot[] {
  const out: Slot[] = [];
  const start = baseDay();
  const seedN = doctorId.charCodeAt(1);
  for (let day = 1; day <= 10; day++) {
    for (let i = 0; i < 12; i++) {
      if ((i + day + seedN) % 3 === 0) continue;
      const s = new Date(start.getTime() + day * 86_400_000 + (7 * 60 + i * 20) * 60_000);
      const e = new Date(s.getTime() + 20 * 60_000);
      out.push({ slotId: s.toISOString(), startsAt: s.toISOString(), endsAt: e.toISOString(), visitTypeId });
    }
  }
  return out;
}

export function visitTypesFor(s: Seed): VisitType[] {
  return [vt(`${s.id}-first`, "كشف", "Consultation", s.fee, s.deposit), vt(`${s.id}-follow`, "إعادة", "Follow-up", Math.round(s.fee * 0.6), null)];
}

export function summaryFor(s: Seed): DoctorSummary {
  const types = visitTypesFor(s);
  return {
    id: s.id, nameAr: s.nameAr, nameEn: s.nameEn, specialtyCode: s.spec, photoUrl: null, verified: true, sponsored: false, bookable: true, clinicPhone: null,
    ratingAvg: s.rating, ratingCount: s.count, feeFromEgp: Math.min(...types.map((t) => t.feeEgp)), depositRequired: s.deposit !== null,
    clinicNameAr: clinics[s.clinic].nameAr, clinicNameEn: clinics[s.clinic].nameEn, areaAr: s.areaAr, areaEn: s.areaEn,
    distanceKm: s.km, languages: ["ar", "en"], gender: s.gender, nextSlots: slotsFor(s.id, types[0].id).slice(0, 3),
  };
}

export function profileFor(s: Seed): DoctorProfile {
  return {
    summary: summaryFor(s), careType: "DOCTORS", serviceLocations: ["IN_CLINIC"], categoryEnabled: true, home: { enabled: false, coverageDistricts: [], surchargeEgp: 0 }, bookable: true, bioAr: null, bioEn: null, subSpecialtiesAr: [], subSpecialtiesEn: [],
    visitTypes: visitTypesFor(s), clinic: clinics[s.clinic],
    cancellationPolicy: {
      freeCancelHoursBefore: 12, depositRefundable: true,
      textAr: "يمكنك الإلغاء مجانًا حتى ١٢ ساعة قبل الموعد، ويُرد العربون كاملًا.",
      textEn: "Cancel free up to 12 hours before the visit; any deposit is refunded in full.",
    },
  };
}

export const reviewsFor = (s: Seed): Review[] =>
  s.count === 0 ? [] : [
    { id: `${s.id}-r1`, rating: 5, text: "التزام بالموعد وشرح واضح.", createdAt: new Date(Date.now() - 6 * 86_400_000).toISOString(), clinicReply: { text: "شكرًا لثقتكم.", createdAt: new Date(Date.now() - 5 * 86_400_000).toISOString() } },
    { id: `${s.id}-r2`, rating: 4, text: "Clear and on time.", createdAt: new Date(Date.now() - 20 * 86_400_000).toISOString(), clinicReply: null },
  ];

