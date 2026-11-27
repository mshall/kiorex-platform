import { describe, expect, it } from "vitest";
import { canStartOnboarding, enrolKindForLead, onboardingUrlForLead } from "@/lib/leadOnboarding";

describe("join request -> Partner onboarding helper", () => {
  it("maps every provider type to a product kind, OTHER to none", () => {
    expect(["CLINIC", "INDEPENDENT_DOCTOR", "CHAIN", "HOSPITAL", "PHYSICIAN"].map(enrolKindForLead)).toEqual(Array(5).fill("CLINIC"));
    expect(enrolKindForLead("NURSE")).toBe("NURSE"); expect(enrolKindForLead("LAB")).toBe("LAB"); expect(enrolKindForLead("PHARMACY")).toBe("PHARMACY");
    expect(enrolKindForLead("OTHER")).toBeNull(); expect(enrolKindForLead("ADDED_BY_TEAM")).toBeNull();
  });
  it("is offered only for a connected request that is qualified or in onboarding", () => {
    expect(canStartOnboarding({ mode: "CONNECTED", status: "QUALIFIED" })).toBe(true); expect(canStartOnboarding({ mode: "CONNECTED", status: "ONBOARDING" })).toBe(true);
    for (const s of ["NEW", "CONTACTED", "WON", "LOST"]) expect(canStartOnboarding({ mode: "CONNECTED", status: s })).toBe(false);
    expect(canStartOnboarding({ mode: "STANDALONE", status: "QUALIFIED" })).toBe(false);
  });
  it("puts only the id in the URL", () => { expect(onboardingUrlForLead("ld_abc 1")).toBe("/partner-onboarding?lead=ld_abc%201"); });
});
