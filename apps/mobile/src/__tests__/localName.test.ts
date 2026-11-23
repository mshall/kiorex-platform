import { localized, medForm, medName } from "@/lib/localName";

describe("bilingual catalogue names with English fallback (contracts 1.8.0)", () => {
  it("Arabic UI shows nameAr when present and the English name otherwise, never a blank", () => {
    expect(medName("ar", { name: "Paracetamol 500mg", nameAr: "باراسيتامول ٥٠٠" })).toBe("باراسيتامول ٥٠٠");
    expect(medName("ar-EG", { name: "Paracetamol 500mg", nameAr: "باراسيتامول ٥٠٠" })).toBe("باراسيتامول ٥٠٠");
    expect(medName("ar", { name: "Vitamin C" })).toBe("Vitamin C");
    expect(medName("ar", { name: "Vitamin C", nameAr: "  " })).toBe("Vitamin C");
  });
  it("English UI always shows the English name; forms follow the same rule", () => {
    expect(medName("en", { name: "Paracetamol 500mg", nameAr: "باراسيتامول" })).toBe("Paracetamol 500mg");
    expect(medForm("ar", { form: "tablet", formAr: "أقراص" })).toBe("أقراص");
    expect(medForm("ar", { form: "tablet" })).toBe("tablet");
    expect(localized("ar", undefined, "عربي فقط")).toBe("عربي فقط");
    expect(localized("en", undefined, undefined)).toBe("");
  });
});
