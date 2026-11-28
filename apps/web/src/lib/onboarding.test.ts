import { describe, expect, it } from "vitest";
import { cleanName, isOnboarded, nameField, safeNext, validName, NEW_ACCOUNT_MINUTES } from "./onboarding";

const now = Date.parse("2026-11-28T12:00:00Z");
const prefs = (r: string | null, a: string | null) => ({ reminders: { consent: false, updatedAt: r }, analytics: { consent: false, textVersion: null, updatedAt: a } });
describe("isOnboarded", () => {
  it("a brand new account with no decision is not onboarded", () => expect(isOnboarded({ createdAt: new Date(now - 60_000).toISOString(), prefs: prefs(null, null), now })).toBe(false));
  it("a recorded reminders or analytics decision means onboarded (even an explicit no)", () => {
    expect(isOnboarded({ createdAt: new Date(now - 1000).toISOString(), prefs: prefs("2026-11-28T11:59:00Z", null), now })).toBe(true);
    expect(isOnboarded({ createdAt: new Date(now - 1000).toISOString(), prefs: prefs(null, "2026-11-28T11:59:00Z"), now })).toBe(true);
  });
  it("an existing account (older than the window) never sees the flow", () => expect(isOnboarded({ createdAt: new Date(now - (NEW_ACCOUNT_MINUTES + 1) * 60_000).toISOString(), prefs: prefs(null, null), now })).toBe(true));
  it("the device marker counts", () => expect(isOnboarded({ deviceDone: true, now })).toBe(true));
  it("unknown facts do not claim onboarded", () => expect(isOnboarded({ now })).toBe(false));
});
describe("safeNext", () => {
  it("keeps same-origin paths", () => expect(safeNext("/doctors/42?x=1")).toBe("/doctors/42?x=1"));
  it("refuses absolute, protocol-relative, backslash and auth loops", () => {
    for (const bad of ["https://evil.test/", "//evil.test", "/\\evil", "javascript:alert(1)", "/auth/callback", "/welcome", "/signin?x=1", "", null, undefined]) expect(safeNext(bad as string)).toBe("/");
  });
});
describe("name", () => {
  it("routes Arabic script to nameAr and everything else to nameEn", () => { expect(nameField("منى")).toEqual({ nameAr: "منى" }); expect(nameField("Mona")).toEqual({ nameEn: "Mona" }); });
  it("collapses whitespace and limits length", () => { expect(cleanName("  A   B ")).toBe("A B"); expect(validName("x".repeat(81))).toBe(false); expect(validName("x".repeat(80))).toBe(true); });
});
