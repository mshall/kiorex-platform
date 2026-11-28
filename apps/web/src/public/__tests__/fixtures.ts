import type { ClinicData, DoctorData, HomeData, ListData, PartnerData, ProviderCard, PublicState } from "../types";

export const card = (o: Partial<ProviderCard> = {}): ProviderCard => ({
  id: "lst_a", slug: "sara-hassan", kind: "doctor", name: { en: "Dr Sara Hassan", ar: "د. سارة حسن" }, specialty: { code: "cardiology", label: { en: "Cardiology", ar: "القلب" } },
  clinicName: { en: "Nile Clinic", ar: "عيادة النيل" }, area: "Maadi", governorate: "Cairo", rating: { average: 4.6, count: 12 }, fee: { minMinor: 30000, maxMinor: 45000, currency: "EGP" },
  languages: ["ar", "en"], nextSlotAt: "2026-12-01T09:00:00.000Z", ...o,
});

export const doctor: DoctorData = {
  kind: "doctor", bookable: true, bookPath: "/doctors/lst_a?book=1", related: [{ label: { en: "Cardiology", ar: "القلب" }, path: "/en/eg/doctors/cardiology", count: 3 }],
  crumbs: [{ label: { en: "Kiorex", ar: "كيوريكس" }, path: "/en/eg" }, { label: { en: "Cardiology", ar: "القلب" }, path: "/en/eg/doctors/cardiology" }, { label: { en: "Dr Sara Hassan", ar: "د. سارة حسن" }, path: null }],
  reviews: [{ rating: 5, text: "Very thorough", createdAt: "2026-11-01T00:00:00.000Z" }],
  similar: [card({ id: "lst_b", slug: "omar-nabil", name: { en: "Dr Omar Nabil", ar: "د. عمر نبيل" } })], ratingMarkup: true, homonym: null,
  provider: { ...card(), subSpecialties: [], gender: "FEMALE", photoUrl: null, title: { en: "Consultant", ar: "استشاري" }, acceptsDeposit: false, homeVisit: true, coverageDistricts: ["maadi"] },
};
export const list: ListData = {
  kind: "city", title: { en: "Cardiology doctors in Cairo", ar: "أطباء القلب في القاهرة" }, specialty: { code: "cardiology", label: { en: "Cardiology", ar: "القلب" } }, city: { en: "Cairo", ar: "القاهرة" }, district: null, careType: null,
  liveProviders: 30, page: 1, pageSize: 12, providers: [card(), card({ id: "lst_b", slug: null, name: { en: "Dr No Slug", ar: "د. بلا رابط" } })],
  facets: { feeRange: { minMinor: 30000, maxMinor: 45000, currency: "EGP" }, languages: ["ar", "en"], rating: { average: 4.4, count: 40 }, nextSlotAt: "2026-12-01T09:00:00.000Z" },
  related: [{ label: { en: "Maadi", ar: "المعادي" }, path: "/en/eg/doctors/cardiology/cairo/maadi", count: 9 }],
  links: { districts: [{ label: { en: "Maadi", ar: "المعادي" }, path: "/en/eg/doctors/cardiology/cairo/maadi", count: 9 }], cities: [{ label: { en: "Giza", ar: "الجيزة" }, path: "/en/eg/doctors/cardiology/giza", count: 5 }], relatedSpecialties: [{ label: { en: "Dermatology", ar: "الجلدية" }, path: "/en/eg/doctors/dermatology/cairo", count: 6 }], availability: [{ label: { en: "Cardiology doctors available today", ar: "أطباء القلب متاحون اليوم" }, path: "/en/eg/same-day/cardiology", count: 4 }], parents: [{ label: { en: "Cardiology", ar: "القلب" }, path: "/en/eg/doctors/cardiology", count: 30 }] },
  ratingDistribution: [{ stars: 5, count: 30 }, { stars: 4, count: 8 }, { stars: 3, count: 2 }, { stars: 2, count: 0 }, { stars: 1, count: 0 }], sameDayCount: 4, specialtyMix: [],
  pagination: { page: 1, pages: 3, prevPath: null, nextPath: "/en/eg/doctors/cardiology/cairo?page=2" },
  crumbs: [{ label: { en: "Kiorex", ar: "كيوريكس" }, path: "/en/eg" }, { label: { en: "Cardiology", ar: "القلب" }, path: "/en/eg/doctors/cardiology" }, { label: { en: "Cairo", ar: "القاهرة" }, path: null }],
};
export const home: HomeData = {
  kind: "home", liveProviders: 120, specialties: [{ label: { en: "Cardiology", ar: "القلب" }, path: "/en/eg/doctors/cardiology", count: 30 }], cities: [{ label: { en: "Cairo", ar: "القاهرة" }, path: "/en/eg/doctors/cardiology/cairo", count: 30 }], crumbs: [],
  cityHubs: [{ label: { en: "Cairo", ar: "القاهرة" }, path: "/en/eg/locations/cairo", count: 90 }], availability: [{ label: { en: "Cardiology doctors available today", ar: "أطباء القلب متاحون اليوم" }, path: "/en/eg/same-day/cardiology", count: 4 }],
  careTypes: [{ label: { en: "Home nursing", ar: "التمريض المنزلي" }, path: "/en/eg/home-nursing/cairo/maadi", count: 6 }], partners: { pharmacies: 2, labs: 1 },
};
export const clinic: ClinicData = { kind: "clinic", clinic: { id: "cl_a", slug: "nile-clinic", name: { en: "Nile Clinic", ar: "عيادة النيل" }, area: "Maadi", governorate: "Cairo" }, providers: [card()], liveProviders: 1, crumbs: [{ label: { en: "Kiorex", ar: "كيوريكس" }, path: "/en/eg" }, { label: { en: "Nile Clinic", ar: "عيادة النيل" }, path: null }], specialties: [{ code: "cardiology", label: { en: "Cardiology", ar: "القلب" } }], facets: list.facets, links: [{ label: { en: "Cardiology", ar: "القلب" }, path: "/en/eg/doctors/cardiology", count: 3 }], homonym: null };
export const pharmacy: PartnerData = { kind: "pharmacy", partner: { id: "pc_1", slug: "nile-pharmacy", name: { en: "Nile Pharmacy", ar: "صيدلية النيل" } }, others: [{ label: { en: "Delta Pharmacy", ar: "صيدلية الدلتا" }, path: "/en/eg/pharmacy/delta-pharmacy", count: 0 }], crumbs: [{ label: { en: "Kiorex", ar: "كيوريكس" }, path: "/en/eg" }, { label: { en: "Pharmacies", ar: "الصيدليات" }, path: null }, { label: { en: "Nile Pharmacy", ar: "صيدلية النيل" }, path: null }] };
export const lab: PartnerData = { ...pharmacy, kind: "lab", partner: { id: "pc_2", slug: "nile-lab", name: { en: "Nile Lab", ar: "معمل النيل" } } };

export const state = (locale: "ar" | "en", type: PublicState["type"], path: string, data: PublicState["data"]): PublicState => ({
  locale, cc: "eg", type, path, query: { page: 1, sort: null }, data, site: { canonicalHost: "https://kiorex.test", reviewMarkup: true, templates: {}, imageCdn: null },
});

const as = (k: ListData["kind"], o: Partial<ListData> = {}): ListData => ({ ...list, kind: k, ...o });
/** One sample per public page type (AR and EN): the snapshot, FAQ, privacy and JSON-LD tests iterate this list. */
export const SAMPLES = (l: "ar" | "en") => [
  state(l, "home", `/${l}/eg`, home), state(l, "hub", `/${l}/eg/doctors/cardiology`, as("hub", { city: null, title: { en: "Cardiology doctors", ar: "أطباء القلب" } })),
  state(l, "city", `/${l}/eg/doctors/cardiology/cairo`, list),
  state(l, "district", `/${l}/eg/doctors/cardiology/cairo/maadi`, as("district", { district: { en: "Maadi", ar: "المعادي" }, title: { en: "Cardiology doctors in Maadi", ar: "أطباء القلب في المعادي" } })),
  state(l, "care-district", `/${l}/eg/home-nursing/cairo/maadi`, as("care-district", { specialty: null, careType: "HOME_NURSING", district: { en: "Maadi", ar: "المعادي" }, title: { en: "Home nursing in Maadi", ar: "التمريض المنزلي في المعادي" } })),
  state(l, "city-hub", `/${l}/eg/locations/cairo`, as("city-hub", { specialty: null, title: { en: "Doctors and care in Cairo", ar: "أطباء ورعاية صحية في القاهرة" }, specialtyMix: [{ label: { en: "Cardiology", ar: "القلب" }, path: "/en/eg/doctors/cardiology/cairo", count: 30 }] })),
  state(l, "district-hub", `/${l}/eg/locations/cairo/maadi`, as("district-hub", { specialty: null, district: { en: "Maadi", ar: "المعادي" }, title: { en: "Doctors and care in Maadi, Cairo", ar: "أطباء ورعاية صحية في المعادي، القاهرة" } })),
  state(l, "same-day", `/${l}/eg/same-day/cardiology`, as("same-day", { city: null, title: { en: "Cardiology doctors available today", ar: "أطباء القلب متاحون اليوم" } })),
  state(l, "telemedicine", `/${l}/eg/telemedicine/cardiology`, as("telemedicine", { city: null, title: { en: "Cardiology video consultations", ar: "استشارات القلب بالفيديو" } })),
  state(l, "doctor", `/${l}/eg/doctor/sara-hassan`, doctor),
  state(l, "nurse", `/${l}/eg/nurse/mona-adel`, { ...doctor, kind: "nurse", provider: { ...doctor.provider, kind: "nurse", profession: "NURSE", specialty: null } }),
  state(l, "clinic", `/${l}/eg/clinic/nile-clinic`, clinic), state(l, "pharmacy", `/${l}/eg/pharmacy/nile-pharmacy`, pharmacy), state(l, "lab", `/${l}/eg/lab/nile-lab`, lab),
  state(l, "not-found", `/${l}/eg/account`, { kind: "not-found", reason: "ROUTE_NOT_FOUND" }),
];
