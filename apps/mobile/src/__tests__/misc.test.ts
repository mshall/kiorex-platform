import { apiOrigin } from "@/lib/apiBase";
import { b64urlDecode, decodeClaims } from "@/auth/jwt";
import { buildIcs, directionsUrl, googleCalendarUrl, telUrl } from "@/lib/calendar";
import { toApiError } from "@/api/errors";
import { mapPolicy, mapProfile, mapSearchItem } from "@/api/adapters";
import { pushRecent } from "@/lib/recent";
import { waitForDeposit } from "@/hooks/useDepositPay";
import { dayKey, pick } from "@/lib/format";

describe("api base", () => {
  it("strips the /api/v1 prefix (the generated client paths carry it)", () => {
    expect(apiOrigin("http://localhost:4000/api/v1")).toBe("http://localhost:4000");
    expect(apiOrigin("https://api.kiorex.com/api/v1/")).toBe("https://api.kiorex.com");
    expect(apiOrigin(undefined)).toBe("http://localhost:4000");
  });
});

describe("jwt claims", () => {
  const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  it("decodes unicode payloads", () => {
    const jwt = `x.${enc({ sub: "u1", name: "أميرة", kx_roles: ["patient"] })}.y`;
    expect(decodeClaims(jwt)).toMatchObject({ sub: "u1", name: "أميرة", kx_roles: ["patient"] });
  });
  it("returns null for garbage", () => { expect(decodeClaims("nope")).toBeNull(); expect(decodeClaims(null)).toBeNull(); });
  it("b64url", () => expect(b64urlDecode("aGk")).toBe("hi"));
});

describe("calendar + links (KXMBK09)", () => {
  const e = { id: "b1", title: "Kiorex · Dr. A", location: "Nasr City, Cairo", startsAt: "2030-01-01T10:00:00Z", endsAt: "2030-01-01T10:20:00Z" };
  it("builds a minimal ICS with no clinical content", () => {
    const ics = buildIcs(e);
    expect(ics).toContain("DTSTART:20300101T100000Z");
    expect(ics).toContain("UID:b1@kiorex.com");
    expect(ics).toContain("LOCATION:Nasr City\\, Cairo");
  });
  it("google calendar url", () => expect(googleCalendarUrl(e)).toContain("dates=20300101T100000Z/20300101T102000Z"));
  it("directions prefer coordinates, tel strips formatting", () => {
    expect(directionsUrl({ lat: 30.05, lng: 31.3, nameEn: "x", addressEn: "y" })).toContain("destination=30.05,31.3");
    expect(directionsUrl({ lat: null, lng: null, nameEn: "Clinic", addressEn: "Cairo" })).toContain("query=Clinic%20Cairo");
    expect(telUrl("+20 2 5555 0100")).toBe("tel:+20255550100");
  });
});

describe("API error envelope + adapters (real wire shapes)", () => {
  it("keeps top-level extras (alternatives, key) as details", () => {
    const e = toApiError(409, { code: "SLOT_TAKEN", message: "Slot taken", bookingId: "b", alternatives: [{ startsAt: "a", endsAt: "b" }] });
    expect(e.code).toBe("SLOT_TAKEN");
    expect(e.details?.alternatives).toHaveLength(1);
    const f = toApiError(403, { code: "FEATURE_DISABLED", message: "off", key: "kiorex.pay_deposits", scope: "GLOBAL" });
    expect(f.isFeatureDisabled).toBe(true);
    expect(f.featureKey).toBe("kiorex.pay_deposits");
  });
  it("maps a search item (minor units → EGP, slots keyed by start time)", () => {
    const d = mapSearchItem({ id: "d1", nameEn: "Dr A", nameAr: "د. أ", specialty: "cardiology", minFeeMinor: 35000, rating: { average: 4.5, count: 3 }, acceptsDeposit: true, gender: "FEMALE", area: "Nasr City", defaultTypeId: "t1", nextSlots: [{ startsAt: "2030-01-01T10:00:00Z", endsAt: "2030-01-01T10:20:00Z" }], verified: true, bookable: true });
    expect(d.feeFromEgp).toBe(350);
    expect(d.gender).toBe("F");
    expect(d.nextSlots[0]).toMatchObject({ slotId: "2030-01-01T10:00:00Z", visitTypeId: "t1" });
    expect(d.bookable).toBe(true);
  });
  it("search item without a visit type is not bookable", () => expect(mapSearchItem({ id: "x", defaultTypeId: null, bookable: false }).bookable).toBe(false));
  it("maps a profile and never invents a policy", () => {
    const p = mapProfile({ id: "d1", nameEn: "Dr A", status: "LIVE", bookable: true, verified: true, fees: [{ typeId: "t1", nameEn: "Consultation", nameAr: "كشف", currency: "EGP", amountMinor: 50000 }], clinic: { id: "c", nameEn: "Clinic", phone: "+20", latitude: 1, longitude: 2 }, acceptsDeposit: false, cancellationPolicy: null } as never);
    expect(p.visitTypes[0].feeEgp).toBe(500);
    expect(p.cancellationPolicy).toEqual({ freeCancelHoursBefore: null, depositRefundable: null, textAr: "", textEn: "" });
    expect(mapPolicy({ cancellationWindowHours: 24 }).freeCancelHoursBefore).toBe(24);
  });
});

describe("misc", () => {
  it("recent doctors: most recent first, de-duplicated, capped at 8", () => {
    let l: { id: string; nameAr: string; nameEn: string; specialty: string }[] = [];
    for (let i = 0; i < 10; i++) l = pushRecent(l, { id: `d${i}`, nameAr: "", nameEn: "", specialty: "" });
    l = pushRecent(l, { id: "d5", nameAr: "", nameEn: "", specialty: "" });
    expect(l).toHaveLength(8);
    expect(l[0].id).toBe("d5");
    expect(l.filter((x) => x.id === "d5")).toHaveLength(1);
  });
  it("pick prefers the UI language and falls back", () => {
    expect(pick({ nameAr: "أ", nameEn: "A" }, "name", "ar")).toBe("أ");
    expect(pick({ nameAr: null, nameEn: "A" }, "name", "ar")).toBe("A");
  });
  it("dayKey groups by Cairo calendar day", () => expect(dayKey("2030-01-01T22:30:00Z")).toBe("2030-01-02"));
  it("waitForDeposit resolves paid once the webhook lands, pending if it never does", async () => {
    const seq = ["REQUIRED", "REQUIRED", "PAID"];
    const sleep = jest.fn(async () => {});
    expect(await waitForDeposit(async () => ({ depositStatus: seq.shift()! as "PAID" }), 5, 1, sleep)).toBe("paid");
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(await waitForDeposit(async () => ({ depositStatus: "REQUIRED" as const }), 3, 1, sleep)).toBe("pending");
    expect(await waitForDeposit(async () => { throw new Error("net"); }, 2, 1, sleep)).toBe("pending");
  });
});
