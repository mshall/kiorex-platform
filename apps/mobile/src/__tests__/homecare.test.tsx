import type { ReactElement } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import i18n from "@/i18n";
import { ThemeProvider } from "@/theme";
import { ApiError } from "@/api/errors";
import { mapProfile, mapSearchItem } from "@/api/adapters";
import type { Address, CareTypeInfo } from "@/api/types";
import { CareTypeTiles, HomeTimeline, OutOfCoverage } from "@/components/homecare";
import { pollIntervalFor } from "@/lib/booking-state";
import {
  addressDraftValid, addressToBody, classifyHomeError, currentHomeStep, defaultAddress, districtLabel, draftToBody, emptyAddressDraft, etaMinutes, locationsOf, maskedAddressLine,
  safetyCardVisible, shareable, toDistrictCode, validInternationalPhone, visitTypesFor, type HomeView,
} from "@/lib/homecare";

jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }) }));
const setLang = (l: string) => act(async () => { await i18n.changeLanguage(l); });
const wrap = (ui: ReactElement) => render(<SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 800 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}><ThemeProvider>{ui}</ThemeProvider></SafeAreaProvider>);

const addr = (o: Partial<Address> = {}): Address => ({ id: "a1", label: "Home", governorate: "Cairo", district: "nasr-city", street: "12 Abbas St", building: "4", floor: "2", flat: "7", landmark: null, lat: null, lng: null, pinSource: null, confirmed: true, confirmedAt: null, createdAt: "2026-11-20T00:00:00Z", summary: "Nasr City", hasPin: false, isDefault: false, ...o });

describe("address helpers", () => {
  it("builds the API body from a draft: district slug, optional fields omitted", () => {
    const d = { ...emptyAddressDraft(), label: " Home ", governorate: "Cairo", district: "Nasr City", street: " 12 Abbas St ", flat: "7" };
    expect(addressDraftValid(d)).toBe(true);
    expect(draftToBody(d)).toEqual({ label: "Home", governorate: "Cairo", district: "nasr-city", street: "12 Abbas St", building: undefined, floor: undefined, flat: "7", landmark: undefined, makeDefault: undefined });
  });
  it("rejects incomplete drafts", () => {
    expect(addressDraftValid(emptyAddressDraft())).toBe(false);
    expect(addressDraftValid({ ...emptyAddressDraft(), label: "x", governorate: "Cairo", district: "!", street: "s" })).toBe(false);
  });
  it("round-trips an address into the pharmacy delivery body", () => { expect(addressToBody(addr())).toMatchObject({ line1: "12 Abbas St, bldg 4, fl 2, apt 7", area: "nasr-city" }); });
  it("masked line shows label + district only, never the street", () => {
    const l = maskedAddressLine(addr(), "en");
    expect(l).toBe("Home · Nasr City");
    expect(l).not.toContain("Abbas");
    expect(maskedAddressLine(addr(), "ar")).toBe("Home · مدينة نصر");
  });
  it("preselects default, then confirmed, then first", () => {
    expect(defaultAddress([addr({ id: "a" , confirmed: false}), addr({ id: "b", isDefault: true })])?.id).toBe("b");
    expect(defaultAddress([addr({ id: "a", confirmed: false }), addr({ id: "b" })])?.id).toBe("b");
    expect(defaultAddress([addr({ id: "a", confirmed: false })])?.id).toBe("a");
    expect(defaultAddress([])).toBeUndefined();
  });
  it("district codes", () => { expect(toDistrictCode(" New Cairo ")).toBe("new-cairo"); expect(districtLabel("new-cairo", "en")).toBe("New Cairo"); expect(districtLabel("unknown-place", "ar")).toBe("Unknown Place"); });
});

describe("home error classification", () => {
  it("OUT_OF_COVERAGE carries district, coverage and in-zone alternatives", () => {
    const e = new ApiError(422, "OUT_OF_COVERAGE", "x", { district: "maadi", coverageDistricts: ["nasr-city"], suggestedProviders: [{ id: "p2", nameEn: "B", nameAr: "ب" }] });
    expect(classifyHomeError(e)).toEqual({ kind: "out_of_coverage", district: "maadi", coverage: ["nasr-city"], suggested: [{ id: "p2", nameEn: "B", nameAr: "ب" }] });
  });
  it("maps the address / consent / share codes", () => {
    expect(classifyHomeError(new ApiError(409, "ADDRESS_NOT_CONFIRMED", "x")).kind).toBe("address_not_confirmed");
    expect(classifyHomeError(new ApiError(409, "FAMILY_SHARE_LIMIT", "x")).kind).toBe("share_limit");
    expect(classifyHomeError(new ApiError(403, "FEATURE_DISABLED", "x", { key: "kiorex.home_visits", scope: "GATE" })).kind).toBe("feature_disabled");
    expect(classifyHomeError(new Error("net")).kind).toBe("other");
  });
});

describe("home timeline model", () => {
  const steps = (r: number): HomeView["steps"] => ["CONFIRMED", "ON_THE_WAY", "ARRIVED", "FINISHED"].map((key, i) => ({ key, reached: i < r, at: i < r ? "2026-11-21T10:00:00Z" : null }));
  it("current step follows the last reached step; assignee marks ASSIGNED", () => {
    expect(currentHomeStep({ steps: steps(1) })).toBe("CONFIRMED");
    expect(currentHomeStep({ steps: steps(1), assignee: { displayName: "Nurse N", photoUrl: null, badge: null, profession: "NURSE" } })).toBe("ASSIGNED");
    expect(currentHomeStep({ steps: steps(2) })).toBe("ON_THE_WAY");
    expect(currentHomeStep({ steps: steps(4) })).toBe("FINISHED");
  });
  it("aborted-unsafe overrides everything and is never a no-show", () => {
    expect(currentHomeStep({ steps: steps(2), aborted: { abortedAt: "x", noShow: false, depositUnderReview: true } })).toBe("ABORTED");
  });
  it("ETA only when the provider shares it", () => {
    expect(etaMinutes({ eta: { minutes: 12, shared: true } })).toBe(12);
    expect(etaMinutes({ eta: { minutes: null, shared: false } })).toBeNull();
    expect(etaMinutes({ eta: { minutes: 9, shared: false } })).toBeNull();
  });
  it("safety card / sharing availability by status", () => {
    expect(safetyCardVisible({ serviceLocation: "HOME", status: "CONFIRMED" })).toBe(true);
    expect(safetyCardVisible({ serviceLocation: "IN_CLINIC", status: "CONFIRMED" })).toBe(false);
    expect(shareable({ serviceLocation: "HOME", status: "COMPLETED" })).toBe(false);
  });
  it("home bookings poll while confirmed (assignment / en-route updates)", () => {
    expect(pollIntervalFor("CONFIRMED", true)).toBe(15_000);
    expect(pollIntervalFor("CONFIRMED", false)).toBe(false);
    expect(pollIntervalFor("PENDING_CLINIC")).toBe(5_000);
  });
  it("phone validation", () => { expect(validInternationalPhone("+20 100 000 0002")).toBe(true); expect(validInternationalPhone("12")).toBe(false); });
});

describe("adapters", () => {
  const profile = {
    id: "p1", nameEn: "N", nameAr: "ن", specialty: "nursing", subSpecialties: [], languages: [], gender: "F", titleEn: null, titleAr: null, photoUrl: null,
    fees: [
      { serviceLocation: "IN_CLINIC", homeSurchargeMinor: 0, totalMinor: 50_000, typeId: "t1", nameEn: "Clinic", nameAr: "عيادة", amountMinor: 50_000, currency: "EGP" },
      { serviceLocation: "HOME", homeSurchargeMinor: 10_000, totalMinor: 60_000, typeId: "t2", nameEn: "Home", nameAr: "منزل", amountMinor: 50_000, currency: "EGP" },
    ],
    clinic: { id: "c" }, rating: { average: null, count: 0 }, cancellationPolicy: null, profession: "NURSE", careType: "HOME_NURSING", edition: "NURSE", professionBadge: { en: "Verified nurse", ar: "ممرض موثّق" },
    verificationRegister: "Syndicate", categoryEnabled: true, serviceLocations: ["IN_CLINIC", "HOME"], assignsClinician: true, homeVisit: { enabled: true, coverageDistricts: ["nasr-city"], homeSurchargeMinor: 10_000 },
    id2: "", status: "LIVE", bookable: true, verified: true, acceptsDeposit: true, shareUrl: "",
  };
  it("profile: home fee includes the surcharge; visit types split by location", () => {
    const d = mapProfile(profile as never);
    expect(locationsOf(d.visitTypes)).toEqual(["IN_CLINIC", "HOME"]);
    expect(visitTypesFor(d.visitTypes, "HOME")[0]).toMatchObject({ id: "t2", feeEgp: 600, surchargeEgp: 100 });
    expect(d).toMatchObject({ careType: "HOME_NURSING", homeEnabled: true, coverageDistricts: ["nasr-city"], assignsClinician: true, categoryEnabled: true });
  });
  it("search item: home fee with surcharge and profession badge", () => {
    const s = mapSearchItem({ id: "p1", careType: "HOME_NURSING", homeVisit: { enabled: true, homeSurchargeMinor: 10_000, visitFeeIncludingSurchargeMinor: 60_000 }, serviceLocations: ["HOME"], professionBadge: { en: "Verified nurse", ar: "ممرض موثّق" } });
    expect(s).toMatchObject({ careType: "HOME_NURSING", homeEnabled: true, homeFeeEgp: 600, homeSurchargeEgp: 100 });
  });
});

describe("home components", () => {
  afterEach(async () => { await setLang("ar"); });
  const cts: CareTypeInfo[] = [
    { code: "DOCTORS", enabled: true, flag: null, labelEn: "Doctors", labelAr: "أطباء", reason: "ON", providerCount: 3 },
    { code: "PHYSIOTHERAPY", enabled: false, flag: "kiorex.category.physiotherapy", labelEn: "Physiotherapy", labelAr: "علاج طبيعي", reason: "GATE", providerCount: 0 },
    { code: "HOME_NURSING", enabled: true, flag: "kiorex.category.nursing", labelEn: "Home nursing", labelAr: "تمريض منزلي", reason: "ON", providerCount: 1 },
  ];
  it("care-type tiles: a gated category stays visible with an awaiting-launch label and is pressable", async () => {
    await setLang("en");
    const onSelect = jest.fn();
    await wrap(<CareTypeTiles items={cts} onSelect={onSelect} />);
    expect(screen.getByText("Doctors")).toBeTruthy();
    expect(screen.getByText("Awaiting launch")).toBeTruthy();
    fireEvent.press(screen.getByTestId("care-PHYSIOTHERAPY"));
    expect(onSelect).toHaveBeenCalledWith(cts[1]);
  });
  it("care-type tiles render in Arabic", async () => { await wrap(<CareTypeTiles items={cts} onSelect={jest.fn()} />); expect(screen.getByText("تمريض منزلي")).toBeTruthy(); expect(screen.getByText("بانتظار الإطلاق")).toBeTruthy(); });
  it("timeline: en-route shows the ETA and assignee badge", async () => {
    await setLang("en");
    const home: HomeView = { steps: ["CONFIRMED", "ON_THE_WAY", "ARRIVED", "FINISHED"].map((key, i) => ({ key, reached: i < 2, at: i < 2 ? "2026-11-21T10:00:00Z" : null })), trackingEnabled: true, eta: { minutes: 14, shared: true }, assignee: { displayName: "Nurse Nadia", photoUrl: null, badge: { en: "Verified nurse", ar: "ممرض موثّق" }, profession: "NURSE" } };
    await wrap(<HomeTimeline home={home} />);
    expect(screen.getByTestId("home-step-ON_THE_WAY")).toBeTruthy();
    expect(screen.getByText("About 14 min away")).toBeTruthy();
    expect(screen.getByText("Nurse Nadia")).toBeTruthy();
    expect(screen.getByText("Verified nurse")).toBeTruthy();
  });
  it("timeline: aborted-unsafe is a safety stop with the deposit under review, not a no-show", async () => {
    await setLang("en");
    const home: HomeView = { steps: ["CONFIRMED", "ON_THE_WAY", "ARRIVED", "FINISHED"].map((key, i) => ({ key, reached: i < 2, at: null })), aborted: { abortedAt: "2026-11-21T10:30:00Z", noShow: false, depositUnderReview: true } };
    await wrap(<HomeTimeline home={home} />);
    expect(screen.getByTestId("aborted-unsafe")).toBeTruthy();
    expect(screen.getByText(/not a no-show/)).toBeTruthy();
    expect(screen.getByText(/under review and will not be forfeited/)).toBeTruthy();
  });
  it("timeline: agency booking shows the assignment-pending note", async () => {
    await setLang("en");
    await wrap(<HomeTimeline home={{ steps: [{ key: "CONFIRMED", reached: true, at: null }], assignmentPending: true }} />);
    expect(screen.getByTestId("assignment-pending")).toBeTruthy();
  });
  it("out-of-coverage lists covered districts and in-zone alternatives", async () => {
    await setLang("en");
    const e = new ApiError(422, "OUT_OF_COVERAGE", "x", { district: "maadi", coverageDistricts: ["nasr-city", "heliopolis"], suggestedProviders: [{ id: "p9", nameEn: "Nurse Sara", nameAr: "سارة" }] });
    const onPick = jest.fn();
    await wrap(<OutOfCoverage error={e} onPickProvider={onPick} />);
    expect(screen.getByText(/does not visit Maadi yet/)).toBeTruthy();
    expect(screen.getByText(/Nasr City, Heliopolis/)).toBeTruthy();
    fireEvent.press(screen.getByTestId("suggested-p9"));
    expect(onPick).toHaveBeenCalledWith("p9");
  });
});
