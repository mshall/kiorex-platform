import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { describe, expect, it, beforeEach } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "@/test/mocks/server";
import { renderApp } from "@/test/utils";
import RedeemCode from "@/pages/corporate/RedeemCode";
import { cleanCorporateCode } from "@/api/corporate";
import en from "@/i18n/corporate.en.json";
import ar from "@/i18n/corporate.ar.json";

const C = "/api/v1/growth/v1/corporate";
const flat = (o: unknown, p = ""): string[] => (o && typeof o === "object" ? Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => flat(v, p ? `${p}.${k}` : k)) : [p]);
const member = (o: Record<string, unknown> = {}) => ({ member: true, verifiedBy: "CODE", enrolledAt: "2027-02-01T00:00:00Z", programme: { sponsor: "Nile Logistics", endsAt: "2027-12-31T00:00:00Z", currency: "EGP" }, allowance: { capMinor: 30_000, usedMinor: 10_000, heldMinor: 5_000, remainingMinor: 15_000 }, ...o });
const violations = async () => (await axe.run(document.body, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] }, rules: { "color-contrast": { enabled: false }, region: { enabled: false } } })).violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`);

beforeEach(() => { try { localStorage.clear(); } catch { /* */ } });

describe("corporate strings and code rules (GRW-P4-C)", () => {
  it("English and Arabic carry the same keys", () => { const a = new Set(flat(en)); const b = new Set(flat(ar)); expect([...a].filter((k) => !b.has(k))).toEqual([]); expect([...b].filter((k) => !a.has(k))).toEqual([]); });
  it("no string promises a cash value, a transfer or a payout, and none names who sees what beyond anonymous totals", () => { const text = JSON.stringify([en, ar]); expect(text).not.toMatch(/withdraw it|cash out|earn money|transfer it to/i); expect(en.how).toMatch(/no cash value/i); });
  it("cleans a code like the server: case, dashes, spaces and look-alikes; refuses anything else", () => {
    expect(cleanCorporateCode("a7kq2-m9x0t")).toBe("A7KQ2M9X0T"); expect(cleanCorporateCode(" A7KQ2 M9XOT ")).toBe("A7KQ2M9X0T"); expect(cleanCorporateCode("A7KQ2-M9X0U")).toBeNull();
    expect(cleanCorporateCode("short")).toBeNull(); expect(cleanCorporateCode("https://evil.example/x")).toBeNull(); expect(cleanCorporateCode("")).toBeNull();
  });
});

describe("RedeemCode page (GRW-P4-C)", () => {
  it("joins with a code: the Join button stays off until the code is well formed, the cleaned code is posted, then the member view shows the allowance", async () => {
    let body: unknown = null; let joined = false;
    server.use(http.get(`${C}/me`, () => HttpResponse.json(joined ? member() : { member: false })), http.post(`${C}/join`, async ({ request }) => { body = await request.json(); joined = true; return HttpResponse.json({ member: true, verifiedBy: "CODE", programme: { sponsor: "Nile Logistics", endsAt: null } }); }));
    renderApp(<RedeemCode />, { lang: "en" });
    const input = await screen.findByTestId("corporate-code"); const submit = screen.getByTestId("corporate-submit");
    expect(submit).toBeDisabled(); await userEvent.type(input, "bad"); expect(submit).toBeDisabled();
    await userEvent.clear(input); await userEvent.type(input, "a7kq2-m9xot"); expect(submit).toBeEnabled(); await userEvent.click(submit);
    await waitFor(() => expect(body).toEqual({ code: "A7KQ2M9X0T" }));
    expect(await screen.findByText("You are in the Nile Logistics programme")).toBeInTheDocument();
    expect(screen.getByTestId("corporate-allowance")).toHaveTextContent(/300/); expect(screen.getByTestId("corporate-how")).toHaveTextContent(/no cash value/i);
    expect(screen.getByTestId("corporate-privacy")).toHaveTextContent(/groups of 10 people or more/);
  });
  it("shows a specific, calm message for each refusal and never echoes the code", async () => {
    for (const code of ["CORPORATE_CODE_EXPIRED", "CORPORATE_CODE_EXHAUSTED", "CORPORATE_ALREADY_MEMBER", "CORPORATE_NOT_ELIGIBLE"]) {
      server.use(http.get(`${C}/me`, () => HttpResponse.json({ member: false })), http.post(`${C}/join`, () => HttpResponse.json({ code, message: "x" }, { status: code === "CORPORATE_ALREADY_MEMBER" ? 409 : 422 })));
      const { unmount } = renderApp(<RedeemCode />, { lang: "en" });
      await userEvent.type(await screen.findByTestId("corporate-code"), "A7KQ2-M9X0T"); await userEvent.click(screen.getByTestId("corporate-submit"));
      const err = await screen.findByTestId("corporate-error"); expect(err).toHaveTextContent(new RegExp({ CORPORATE_CODE_EXPIRED: "expired", CORPORATE_CODE_EXHAUSTED: "maximum", CORPORATE_ALREADY_MEMBER: "already in", CORPORATE_NOT_ELIGIBLE: "not eligible" }[code]!)); expect(err.textContent).not.toContain("A7KQ2");
      expect(screen.getByTestId("corporate-code")).toHaveAttribute("aria-invalid", "true"); unmount();
    }
  });
  it("the verified-email path posts no code and explains an unverified address", async () => {
    let body: unknown = "unset";
    server.use(http.get(`${C}/me`, () => HttpResponse.json({ member: false })), http.post(`${C}/join`, async ({ request }) => { body = await request.json(); return HttpResponse.json({ code: "CORPORATE_EMAIL_NOT_VERIFIED", message: "x" }, { status: 422 }); }));
    renderApp(<RedeemCode />, { lang: "en" });
    await userEvent.click(await screen.findByTestId("corporate-email")); await waitFor(() => expect(body).toEqual({}));
    expect(await screen.findByTestId("corporate-error")).toHaveTextContent(/Verify your work e-mail/);
  });
  it("leaving needs a confirmation and says history is not changed", async () => {
    let left = false; let me: Record<string, unknown> = member();
    server.use(http.get(`${C}/me`, () => HttpResponse.json(me)), http.post(`${C}/leave`, () => { left = true; me = { member: false }; return HttpResponse.json({ left: true }); }));
    renderApp(<RedeemCode />, { lang: "en" });
    await userEvent.click(await screen.findByTestId("corporate-leave")); expect(left).toBe(false); expect(screen.getByTestId("corporate-leave-confirm")).toHaveTextContent(/not changed/);
    await userEvent.click(screen.getByTestId("corporate-leave-yes")); await waitFor(() => expect(left).toBe(true)); expect(await screen.findByTestId("corporate-join")).toBeInTheDocument();
  });
  it("the flag being OFF shows the unavailable state, not an error", async () => {
    server.use(http.get(`${C}/me`, () => HttpResponse.json({ code: "FEATURE_DISABLED", message: "off", key: "growth.corporate", scope: "GATE" }, { status: 403 })));
    renderApp(<RedeemCode />, { lang: "en" });
    await waitFor(() => expect(screen.queryByTestId("corporate-join")).not.toBeInTheDocument()); expect(screen.queryByTestId("corporate-code")).not.toBeInTheDocument();
  });
  it("renders in Arabic with Arabic-Indic digits and right-to-left, with no accessibility violations in either language or state", async () => {
    server.use(http.get(`${C}/me`, () => HttpResponse.json(member())));
    const first = renderApp(<RedeemCode />, { lang: "ar" });
    expect(await screen.findByText("أنت في برنامج Nile Logistics")).toBeInTheDocument(); expect(screen.getByTestId("corporate-allowance")).toHaveTextContent(/٣٠٠/); expect(document.documentElement.dir).toBe("rtl");
    expect(await violations()).toEqual([]); first.unmount();
    server.use(http.get(`${C}/me`, () => HttpResponse.json({ member: false })));
    const second = renderApp(<RedeemCode />, { lang: "ar" }); expect(await screen.findByLabelText("كود الشركة")).toBeInTheDocument(); expect(await violations()).toEqual([]); second.unmount();
    renderApp(<RedeemCode />, { lang: "en" }); expect(await screen.findByLabelText("Company code")).toBeInTheDocument(); expect(document.documentElement.dir).toBe("ltr"); expect(await violations()).toEqual([]);
  });
});
