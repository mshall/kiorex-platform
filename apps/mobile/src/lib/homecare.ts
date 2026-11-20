// Pure helpers for Rev 2.3 home visits (KXMHV01-10). No network, no React: unit-tested in __tests__/homecare.test.ts.
import { ApiError } from "@/api/errors";
import type { Address, AddressInput, Booking, CareType, ServiceLocation, VisitType } from "@/api/types";

export const CARE_TYPES: readonly CareType[] = ["DOCTORS", "PHYSIOTHERAPY", "HOME_NURSING"] as const;
export const CARE_TYPE_KEY: Record<CareType, string> = { DOCTORS: "doctors", PHYSIOTHERAPY: "physio", HOME_NURSING: "nursing" };
export const PROBLEM_CATEGORIES = ["SAFETY", "CONDUCT", "PROVIDER_NO_SHOW", "BILLING", "OTHER"] as const;
export type ProblemCategory = (typeof PROBLEM_CATEGORIES)[number];

/** District codes are slugs ("nasr-city"). Shown title-cased; the API only ever exchanges the code, never a street. */
const AR_DISTRICTS: Record<string, string> = {
  "nasr-city": "مدينة نصر", maadi: "المعادي", heliopolis: "مصر الجديدة", zamalek: "الزمالك", dokki: "الدقي", mohandessin: "المهندسين", "new-cairo": "القاهرة الجديدة",
  "sheikh-zayed": "الشيخ زايد", "6th-october": "السادس من أكتوبر", shubra: "شبرا", giza: "الجيزة", "5th-settlement": "التجمع الخامس",
};
export const districtLabel = (code: string | null | undefined, lang: string): string => {
  if (!code) return "";
  if (lang.startsWith("ar") && AR_DISTRICTS[code]) return AR_DISTRICTS[code];
  return code.split("-").map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(" ");
};
/** Slug the API expects, from free text typed by the user. */
export const toDistrictCode = (v: string): string => v.trim().toLowerCase().replace(/[\s_]+/g, "-");
export const isDistrictCode = (v: string): boolean => /^[a-z0-9][a-z0-9-]{1,39}$/.test(toDistrictCode(v));

export const isHome = (b: { serviceLocation?: ServiceLocation | string | null } | null | undefined) => b?.serviceLocation === "HOME";

export interface AddressDraft { label: string; governorate: string; district: string; street: string; building: string; floor: string; flat: string; landmark: string; makeDefault: boolean }
export const emptyAddressDraft = (): AddressDraft => ({ label: "", governorate: "", district: "", street: "", building: "", floor: "", flat: "", landmark: "", makeDefault: false });
export const draftFromAddress = (a: Address): AddressDraft => ({
  label: a.label, governorate: a.governorate, district: a.district, street: a.street ?? "", building: a.building ?? "", floor: a.floor ?? "", flat: a.flat ?? "", landmark: a.landmark ?? "", makeDefault: a.isDefault,
});
export const addressDraftValid = (d: AddressDraft) => d.label.trim().length > 0 && d.governorate.trim().length >= 2 && isDistrictCode(d.district) && d.street.trim().length > 0;
const opt = (v: string) => (v.trim() ? v.trim() : undefined);
export function draftToBody(d: AddressDraft): AddressInput {
  return { label: d.label.trim(), governorate: d.governorate.trim(), district: toDistrictCode(d.district), street: d.street.trim(), building: opt(d.building), floor: opt(d.floor), flat: opt(d.flat), landmark: opt(d.landmark), makeDefault: d.makeDefault || undefined };
}
/** Pharmacy delivery reuses the address book (the cart endpoint takes the same structured address). */
export const addressToBody = (a: Address): AddressInput => draftToBody(draftFromAddress(a));

/** Masked display: label + district only; the doorstep lines never appear on list rows. */
export const maskedAddressLine = (a: Pick<Address, "label" | "district">, lang: string) =>
  [a.label, districtLabel(a.district, lang)].filter(Boolean).join(" · ");

/** Which saved address to preselect: the default one, else the first confirmed one, else the first. */
export function defaultAddress(list: readonly Address[] | undefined): Address | undefined {
  if (!list?.length) return undefined;
  return list.find((a) => a.isDefault) ?? list.find((a) => a.confirmed) ?? list[0];
}

export type HomeErrorKind =
  | "out_of_coverage" | "address_not_confirmed" | "address_required" | "home_not_offered" | "phone_not_verified" | "phone_mismatch"
  | "address_limit" | "invalid_district" | "consent_required" | "contact_consent" | "share_limit" | "contact_exists" | "invalid_phone" | "not_shareable" | "feature_disabled" | "other";
const CODES: Record<string, HomeErrorKind> = {
  OUT_OF_COVERAGE: "out_of_coverage", ADDRESS_NOT_CONFIRMED: "address_not_confirmed", ADDRESS_REQUIRED: "address_required", HOME_NOT_OFFERED: "home_not_offered",
  PHONE_NOT_VERIFIED: "phone_not_verified", PHONE_MISMATCH: "phone_mismatch", ADDRESS_LIMIT: "address_limit", INVALID_DISTRICT: "invalid_district",
  CONSENT_REQUIRED: "consent_required", CONTACT_CONSENT_REQUIRED: "contact_consent", FAMILY_SHARE_LIMIT: "share_limit", FAMILY_CONTACT_EXISTS: "contact_exists",
  INVALID_PHONE: "invalid_phone", BOOKING_NOT_SHAREABLE: "not_shareable",
};
export interface SuggestedProvider { id: string; nameEn: string | null; nameAr: string | null }
export const classifyHomeError = (e: unknown): { kind: HomeErrorKind; district?: string; coverage: string[]; suggested: SuggestedProvider[] } => {
  if (!(e instanceof ApiError)) return { kind: "other", coverage: [], suggested: [] };
  if (e.isFeatureDisabled) return { kind: "feature_disabled", coverage: [], suggested: [] };
  const d = e.details ?? {};
  return {
    kind: CODES[e.code] ?? "other", district: typeof d.district === "string" ? d.district : undefined,
    coverage: Array.isArray(d.coverageDistricts) ? (d.coverageDistricts as string[]) : [],
    suggested: Array.isArray(d.suggestedProviders) ? (d.suggestedProviders as SuggestedProvider[]) : [],
  };
};

/** Visit types of the chosen location. */
export const visitTypesFor = (types: readonly VisitType[], loc: ServiceLocation) => types.filter((t) => t.serviceLocation === loc);
export const locationsOf = (types: readonly VisitType[]): ServiceLocation[] => (["IN_CLINIC", "HOME"] as const).filter((l) => types.some((t) => t.serviceLocation === l));

/** Home visit step keys in display order (the API sends reached flags; the UI never invents progress). */
export const STEP_ORDER = ["CONFIRMED", "ON_THE_WAY", "ARRIVED", "FINISHED"] as const;
export type HomeStepKey = (typeof STEP_ORDER)[number];
export interface HomeStep { key: string; reached: boolean; at: string | null }
export interface HomeView {
  district?: string | null; subState?: string | null; steps?: HomeStep[]; trackingEnabled?: boolean; eta?: { minutes: number | null; shared: boolean };
  assignee?: { displayName: string | null; photoUrl: string | null; badge: { en: string; ar: string } | string | null; profession: string | null } | null; assignmentPending?: boolean;
  fee?: { visitFeeMinor: number | null; homeSurchargeMinor: number; totalMinor: number; currency: string; depositRequired: boolean };
  aborted?: { abortedAt: string | null; noShow: boolean; depositUnderReview: boolean } | null;
  address?: { district: string | null; governorate: string | null; masked: boolean; maskedAt: string | null; address: Record<string, string | null> | null };
  safety?: { reportProblemSlaMinutes: number; emergencyNumber: string };
}
export const homeOf = (b: Pick<Booking, "home"> | null | undefined): HomeView | null => (b?.home as HomeView | null | undefined) ?? null;

/** Current step for the timeline: the last reached one (aborted overrides: ABORTED_UNSAFE is a stop, never a no-show). */
export function currentHomeStep(h: HomeView | null): HomeStepKey | "ABORTED" | "ASSIGNED" | null {
  if (!h) return null;
  if (h.aborted) return "ABORTED";
  const reached = (h.steps ?? []).filter((s) => s.reached);
  const last = reached[reached.length - 1]?.key as HomeStepKey | undefined;
  if (!last) return null;
  if (last === "CONFIRMED" && h.assignee) return "ASSIGNED";
  return last;
}
export const etaMinutes = (h: HomeView | null): number | null => (h?.eta?.shared && h.eta.minutes != null ? h.eta.minutes : null);
export const badgeText = (b: { en: string; ar: string } | string | null | undefined, lang: string): string => (!b ? "" : typeof b === "string" ? b : lang.startsWith("ar") ? b.ar : b.en);
/** The safety card is useful from confirmation until the visit is over. */
export const safetyCardVisible = (b: Pick<Booking, "status" | "serviceLocation">) => isHome(b) && ["CONFIRMED", "CHECKED_IN", "PENDING_CLINIC", "COMPLETED"].includes(b.status);
export const shareable = (b: Pick<Booking, "status" | "serviceLocation">) => isHome(b) && ["CONFIRMED", "PENDING_CLINIC", "CHECKED_IN"].includes(b.status);
export const addressMasked = (h: HomeView | null) => !!h?.address?.masked;

export const normalizeInternationalPhone = (v: string): string => v.replace(/[\s-]/g, "");
export const validInternationalPhone = (v: string) => /^\+?\d{9,15}$/.test(normalizeInternationalPhone(v));
export const MAX_FAMILY_SHARES = 3;

/** After an unsafe abort the deposit is held for ops review, never auto-forfeited (KXMPAY07). */
export const depositUnderReview = (b: Pick<Booking, "depositStatus">) => b.depositStatus === "HOLD_FOR_REVIEW";
