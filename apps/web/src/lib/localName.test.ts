import { describe, expect, it } from "vitest";
import { localized, medForm, medName } from "./localName";

describe("bilingual catalogue names with English fallback", () => {
  it("Arabic UI shows nameAr when present, the English name otherwise (never blank)", () => {
    expect(medName("ar", { name: "Paracetamol 500mg", nameAr: "باراسيتامول ٥٠٠" })).toBe("باراسيتامول ٥٠٠");
    expect(medName("ar-EG", { name: "Paracetamol 500mg", nameAr: "باراسيتامول ٥٠٠" })).toBe("باراسيتامول ٥٠٠");
    expect(medName("ar", { name: "Vitamin C" })).toBe("Vitamin C");
    expect(medName("ar", { name: "Vitamin C", nameAr: "   " })).toBe("Vitamin C");
  });
  it("English UI always shows the English name", () => {
    expect(medName("en", { name: "Paracetamol 500mg", nameAr: "باراسيتامول" })).toBe("Paracetamol 500mg");
  });
  it("dosage form and optional text follow the same rule", () => {
    expect(medForm("ar", { form: "tablet", formAr: "أقراص" })).toBe("أقراص");
    expect(medForm("ar", { form: "tablet" })).toBe("tablet");
    expect(medForm("en", { form: "tablet", formAr: "أقراص" })).toBe("tablet");
    expect(localized("ar", undefined, "فقط عربي")).toBe("فقط عربي");
    expect(localized("en", undefined, undefined)).toBe("");
  });
});
