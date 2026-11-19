import { describe, expect, it } from "vitest";
import { mapKeywordToSpecialty, sanitize } from "@/lib/analytics";
import { isEmergencyQuery } from "@/lib/emergency";
import { formatCountdown, pick } from "@/lib/format";
import { activeFilterCount, parseSearch, toQuery } from "@/lib/searchParams";
import { buildIcs } from "@/lib/ics";
import { mapProfile, mapSearchItem } from "@/api/adapters";

describe("analytics privacy (KX-03 §07)", () => {
  it("drops non-whitelisted keys and long free text", () => {
    const out = sanitize({ specialtyCode: "cardiology", q: "chest pain and diabetes", diagnosis: "x", note: "free text", resultCount: 3, providerId: "x".repeat(80), code: "SLOT_TAKEN", market: "eg" });
    expect(out).toEqual({ specialtyCode: "cardiology", code: "SLOT_TAKEN" });
    expect(sanitize({ specialtyCode: "other" })).toEqual({});
  });
  it("maps keywords to specialty codes and never echoes the raw query", () => {
    expect(mapKeywordToSpecialty("طبيب أسنان")).toBe("dentistry");
    expect(mapKeywordToSpecialty("my child has a fever")).toBe("paediatrics");
    expect(mapKeywordToSpecialty("zzz")).toBe("other");
  });
});

describe("emergency routing (KXMDS06)", () => {
  it.each(["chest pain", "I can't breathe", "ألم في الصدر", "نزيف شديد", "إسعاف"])("flags %s", (q) => expect(isEmergencyQuery(q)).toBe(true));
  it.each(["dermatologist", "طبيب جلدية", "Dr. Laila"])("does not flag %s", (q) => expect(isEmergencyQuery(q)).toBe(false));
});

describe("format helpers", () => {
  it("formats the hold countdown", () => { expect(formatCountdown(300_000)).toBe("05:00"); expect(formatCountdown(61_500)).toBe("01:01"); expect(formatCountdown(-5)).toBe("00:00"); });
  it("picks the language field with fallback", () => {
    expect(pick({ nameAr: "ليلى", nameEn: "Laila" }, "name", "ar")).toBe("ليلى");
    expect(pick({ nameAr: null, nameEn: "Laila" }, "name", "ar")).toBe("Laila");
  });
});

describe("search params", () => {
  it("round-trips and counts active filters", () => {
    const p = parseSearch(new URLSearchParams("q=x&area=Maadi&maxFee=400&acceptsDeposit=true&sort=fee"));
    expect(p).toMatchObject({ q: "x", area: "Maadi", maxFee: 400, acceptsDeposit: true, sort: "fee" });
    expect(activeFilterCount(p)).toBe(3);
    expect(toQuery(p).get("sort")).toBe("fee");
    expect(toQuery({ sort: "earliest", page: 1 }).toString()).toBe("");
  });
});

describe("ics", () => { it("builds a VEVENT with no clinical content", () => { const s = buildIcs({ id: "b1", title: "Dr. A", location: "Cairo, Nasr", startsAt: "2026-12-01T09:00:00Z", endsAt: "2026-12-01T09:20:00Z" }); expect(s).toContain("DTSTART:20261201T090000Z"); expect(s).toContain("LOCATION:Cairo\\, Nasr"); }); });

describe("real-API adapters", () => {
  it("converts minor-unit money and slot identity", () => {
    const d = mapSearchItem({ id: "p1", nameEn: "A", nameAr: "أ", specialty: "dermatology", minFeeMinor: 35000, rating: { average: 4.5, count: 3 }, verified: true, defaultTypeId: "t1", nextSlots: [{ startsAt: "2026-12-01T09:00:00Z", endsAt: "2026-12-01T09:20:00Z" }], gender: "F", languages: ["ar"] });
    expect(d.feeFromEgp).toBe(350);
    expect(d.nextSlots[0]).toMatchObject({ slotId: "2026-12-01T09:00:00Z", visitTypeId: "t1" });
    const p = mapProfile({ id: "p1", fees: [{ typeId: "t1", amountMinor: 50000, nameEn: "Consult" }], clinic: { nameEn: "C" }, rating: { average: 0, count: 0 }, acceptsDeposit: true } as never);
    expect(p.visitTypes[0]).toMatchObject({ feeEgp: 500, depositRequired: true });
    expect(p.summary.feeFromEgp).toBe(500);
  });
});
