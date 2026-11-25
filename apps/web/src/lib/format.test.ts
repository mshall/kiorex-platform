import { describe, expect, it } from "vitest";
import { formatMinor } from "./format";

describe("formatMinor follows the currency exponent (ZY readiness)", () => {
  it("EGP keeps two minor units exactly as before", () => {
    expect(formatMinor(30000, "en", "EGP")).toMatch(/300/); expect(formatMinor(30050, "en", "EGP")).toMatch(/300\.50/);
    expect(formatMinor(30000, "en")).toBe(formatMinor(30000, "en", "EGP"));
  });
  it("JOD has three minor units: 30500 is 30.500 dinars, not 305", () => {
    expect(formatMinor(30500, "en", "JOD")).toMatch(/30\.500/); expect(formatMinor(30000, "en", "JOD")).toMatch(/30(?!\.)/);
    expect(formatMinor(30000, "en", "JOD")).not.toMatch(/300/);
  });
  it("an unknown currency code falls back to two minor units instead of throwing", () => {
    expect(() => formatMinor(12345, "en", "XXZ")).not.toThrow();
  });
});
