import type { ClinicData, DoctorData, HomeData, ListData, ProviderCard, PublicState } from "../types";

export const card = (o: Partial<ProviderCard> = {}): ProviderCard => ({
  id: "lst_a", slug: "sara-hassan", kind: "doctor", name: { en: "Dr Sara Hassan", ar: "د. سارة حسن" }, specialty: { code: "cardiology", label: { en: "Cardiology", ar: "القلب" } },
  clinicName: { en: "Nile Clinic", ar: "عيادة النيل" }, area: "Maadi", governorate: "Cairo", rating: { average: 4.6, count: 12 }, fee: { minMinor: 30000, maxMinor: 45000, currency: "EGP" },
  languages: ["ar", "en"], nextSlotAt: "2026-12-01T09:00:00.000Z", ...o,
});

export const doctor: DoctorData = {
  kind: "doctor", bookable: true, bookPath: "/doctors/lst_a?book=1", related: [{ label: { en: "Cardiology", ar: "القلب" }, path: "/en/eg/doctors/cardiology", count: 3 }],
  crumbs: [{ label: { en: "Kiorex", ar: "كيوركس" }, path: "/en/eg" }, { label: { en: "Cardiology", ar: "القلب" }, path: "/en/eg/doctors/cardiology" }, { label: { en: "Dr Sara Hassan", ar: "د. سارة حسن" }, path: null }],
  reviews: [{ rating: 5, text: "Very thorough", createdAt: "2026-11-01T00:00:00.000Z" }],
  provider: { ...card(), subSpecialties: [], gender: "FEMALE", photoUrl: null, title: { en: "Consultant", ar: "استشاري" }, acceptsDeposit: false, homeVisit: true, coverageDistricts: ["maadi"] },
};
export const list: ListData = {
  kind: "city", title: { en: "Cardiology doctors in Cairo", ar: "أطباء القلب في القاهرة" }, specialty: { code: "cardiology", label: { en: "Cardiology", ar: "القلب" } }, city: { en: "Cairo", ar: "القاهرة" }, district: null, careType: null,
  liveProviders: 30, page: 1, pageSize: 12, providers: [card(), card({ id: "lst_b", slug: null, name: { en: "Dr No Slug", ar: "د. بلا رابط" } })],
  facets: { feeRange: { minMinor: 30000, maxMinor: 45000, currency: "EGP" }, languages: ["ar", "en"], rating: { average: 4.4, count: 40 }, nextSlotAt: "2026-12-01T09:00:00.000Z" },
  related: [{ label: { en: "Maadi", ar: "المعادي" }, path: "/en/eg/doctors/cardiology/cairo/maadi", count: 9 }],
  crumbs: [{ label: { en: "Kiorex", ar: "كيوركس" }, path: "/en/eg" }, { label: { en: "Cardiology", ar: "القلب" }, path: "/en/eg/doctors/cardiology" }, { label: { en: "Cairo", ar: "القاهرة" }, path: null }],
};
export const home: HomeData = { kind: "home", liveProviders: 120, specialties: [{ label: { en: "Cardiology", ar: "القلب" }, path: "/en/eg/doctors/cardiology", count: 30 }], cities: [{ label: { en: "Cairo", ar: "القاهرة" }, path: "/en/eg/doctors/cardiology/cairo", count: 30 }], crumbs: [] };
export const clinic: ClinicData = { kind: "clinic", clinic: { id: "cl_a", slug: "nile-clinic", name: { en: "Nile Clinic", ar: "عيادة النيل" }, area: "Maadi", governorate: "Cairo" }, providers: [card()], liveProviders: 1, crumbs: [{ label: { en: "Kiorex", ar: "كيوركس" }, path: "/en/eg" }, { label: { en: "Nile Clinic", ar: "عيادة النيل" }, path: null }] };

export const state = (locale: "ar" | "en", type: PublicState["type"], path: string, data: PublicState["data"]): PublicState => ({
  locale, cc: "eg", type, path, query: { page: 1, sort: null }, data, site: { canonicalHost: "https://kiorex.test", reviewMarkup: true },
});

export const SAMPLES = (l: "ar" | "en") => [
  state(l, "home", `/${l}/eg`, home), state(l, "city", `/${l}/eg/doctors/cardiology/cairo`, list), state(l, "doctor", `/${l}/eg/doctor/sara-hassan`, doctor),
  state(l, "clinic", `/${l}/eg/clinic/nile-clinic`, clinic), state(l, "not-found", `/${l}/eg/account`, { kind: "not-found", reason: "ROUTE_NOT_FOUND" }),
];
