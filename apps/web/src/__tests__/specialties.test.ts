import { describe, expect, it } from "vitest";
import { isKnownSpecialty, SPECIALTY_LABELS, specialtyLabel } from "@/lib/specialties";
import { SPECIALTY_CODES } from "@/lib/analytics";
import { specialties } from "@/test/mocks/data";

// Every code the platform can emit: Kiorly ClinicalSpecialty enum + Kiorex GET /specialties catalogue + analytics whitelist.
const KIORLY_ENUM = ["POLYCLINIC", "GENERAL_MEDICINE", "PAIN_MANAGEMENT", "ORTHOPEDICS", "PEDIATRICS", "DERMATOLOGY", "DENTISTRY", "PHYSIO_THERAPY", "AESTHETICS", "CARDIOLOGY", "OBSTETRICS_GYNECOLOGY", "ENT", "OPHTHALMOLOGY", "PSYCHIATRY", "RADIOLOGY", "LABORATORY", "INTERNAL_MEDICINE", "FAMILY_MEDICINE", "UROLOGY"];
const ALL = [...KIORLY_ENUM, ...SPECIALTY_CODES, ...specialties.map((s) => s.code), "family_medicine", "obstetrics_gynecology"];

describe("specialty labels", () => {
  it.each([...new Set(ALL)])("maps %s to proper AR and EN labels (no raw code)", (code) => {
    expect(isKnownSpecialty(code)).toBe(true);
    for (const lang of ["ar", "en"]) {
      const l = specialtyLabel(code, lang);
      expect(l).toBeTruthy();
      expect(l).not.toMatch(/_/);
    }
    expect(specialtyLabel(code, "ar")).toMatch(/[؀-ۿ]/);
  });
  it("every map entry has both languages", () => { for (const v of Object.values(SPECIALTY_LABELS)) { expect(v.en).toBeTruthy(); expect(v.ar).toMatch(/[؀-ۿ]/); } });
  it("prefers catalogue names, falls back to the map, and never shows snake_case", () => {
    expect(specialtyLabel("family_medicine", "en")).toBe("Family medicine");
    expect(specialtyLabel("family_medicine", "ar")).toBe("طب الأسرة");
    expect(specialtyLabel("dermatology", "en", [{ code: "dermatology", nameEn: "Skin", nameAr: "جلد" }])).toBe("Skin");
    expect(specialtyLabel("sports_medicine", "en")).toBe("Sports medicine");
  });
});
