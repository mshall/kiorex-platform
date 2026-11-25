import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { describe, expect, it, beforeEach } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "@/test/mocks/server";
import { renderApp } from "@/test/utils";
import LoyaltyHome from "@/pages/loyalty/LoyaltyHome";
import { cleanPartnerCode } from "@/api/loyalty";
import en from "@/i18n/loyalty.en.json";
import ar from "@/i18n/loyalty.ar.json";

const L = "/api/v1/growth/v1/loyalty";
const flat = (o: unknown, p = ""): string[] => (o && typeof o === "object" ? Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => flat(v, p ? `${p}.${k}` : k)) : [p]);
const me = (o: Record<string, unknown> = {}) => ({ tier: "SILVER", tierSince: "2027-02-01T00:00:00Z", window: { months: 12, completed: 3 }, next: { tier: "GOLD", minCompletedBookings: 6, remaining: 3 }, points: { balance: 45, expiringSoon: { points: 10, at: "2027-11-24T00:00:00Z" } },
  conversion: { open: true, pointsRequired: 30, valueMinor: 5000, currency: "EGP", blocksLeftThisYear: 2, canConvert: true }, notMoney: true, ...o });
const violations = async () => (await axe.run(document.body, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] }, rules: { "color-contrast": { enabled: false }, region: { enabled: false } } })).violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`);
const use = (m: Record<string, unknown> = me(), hist: Array<Record<string, unknown>> = []) => server.use(http.get(`${L}/me`, () => HttpResponse.json(m)), http.get(`${L}/history`, () => HttpResponse.json({ items: hist })));

beforeEach(() => { try { localStorage.clear(); } catch { /* */ } });

describe("loyalty strings and code rules (GRW-P4-D)", () => {
  it("English and Arabic carry the same keys", () => { const a = new Set(flat(en)); const b = new Set(flat(ar)); expect([...a].filter((k) => !b.has(k))).toEqual([]); expect([...b].filter((k) => !a.has(k))).toEqual([]); });
  it("no string promises cash, a payout, a transfer or a sale of points", () => { const text = JSON.stringify([en, ar]).toLowerCase(); expect(text).not.toMatch(/cash out|withdraw (it|your)|earn money|transfer (it|them|your)|sell your|top up|egp \d/); expect(en.notMoney).toMatch(/not money/i); });
  it("cleans a partner code like the server and refuses anything else", () => { expect(cleanPartnerCode("a7kq2-m9xot")).toBe("A7KQ2M9X0T"); expect(cleanPartnerCode("A7KQ2-M9X0U")).toBeNull(); expect(cleanPartnerCode("https://evil.example/x")).toBeNull(); expect(cleanPartnerCode("")).toBeNull(); });
});

describe("Loyalty page (GRW-P4-D)", () => {
  it("shows tier, progress, points as a COUNT (never money), what expires and when, and states that points are not money", async () => {
    use(me(), [{ id: "e1", type: "ACCRUE", points: 10, direction: "IN", expiresAt: "2028-02-01T00:00:00Z", at: "2027-02-01T00:00:00Z" }, { id: "e2", type: "CONVERT", points: 30, direction: "OUT", expiresAt: null, at: "2027-02-10T00:00:00Z" }]);
    renderApp(<LoyaltyHome />, { lang: "en" });
    expect(await screen.findByTestId("loyalty-tier-name")).toHaveTextContent("Silver"); expect(screen.getByTestId("loyalty-progress")).toHaveTextContent("3 completed visits in the last 12 months"); expect(screen.getByTestId("loyalty-next")).toHaveTextContent("3 more completed visits to reach Gold");
    expect(screen.getByTestId("loyalty-balance")).toHaveTextContent("45 points"); expect(screen.getByTestId("loyalty-balance").textContent).not.toMatch(/EGP|E£|£/); expect(screen.getByTestId("loyalty-expiring")).toHaveTextContent(/10 points expire on/);
    expect(screen.getByTestId("loyalty-not-money")).toHaveTextContent(/Points are not money/); expect(await screen.findByText("Points earned")).toBeInTheDocument(); expect(screen.getByText("Exchanged for a voucher")).toBeInTheDocument();
    for (const b of screen.getAllByRole("button")) expect(b.textContent).not.toMatch(/transfer|withdraw|cash|top.?up|send|gift/i);
  });
  it("exchanging posts ONE request key per tap, reuses it on a retry after a failure, and shows the voucher with a link to the vouchers", async () => {
    const keys: string[] = []; let fail = true;
    use(); server.use(http.post(`${L}/convert`, async ({ request }) => { keys.push(((await request.json()) as { requestKey: string }).requestKey); if (fail) { fail = false; return HttpResponse.json({ code: "LOYALTY_CONVERSION_REFUSED", message: "x" }, { status: 422 }); } return HttpResponse.json({ lotId: "rwl_1", mode: "COUPON", points: 30, amountMinor: 5000, currency: "EGP", balanceAfter: 15 }); }));
    renderApp(<LoyaltyHome />, { lang: "en" });
    await userEvent.click(await screen.findByTestId("loyalty-convert-button")); expect(await screen.findByTestId("loyalty-convert-error")).toHaveTextContent(/Your points were not used/);
    await userEvent.click(screen.getByTestId("loyalty-convert-button")); expect(await screen.findByTestId("loyalty-converted")).toHaveTextContent(/voucher worth/); expect(screen.getByRole("link", { name: "Open my vouchers" })).toHaveAttribute("href", "/referral/rewards");
    expect(keys).toHaveLength(2); expect(keys[0]).toBe(keys[1]); expect(keys[0]).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
  });
  it("the exchange is disabled with a calm reason when there are not enough points, and closed text when conversion is not open", async () => {
    use(me({ points: { balance: 5, expiringSoon: null }, conversion: { open: true, pointsRequired: 30, valueMinor: 5000, currency: "EGP", blocksLeftThisYear: 2, canConvert: false } }));
    const first = renderApp(<LoyaltyHome />, { lang: "en" }); expect(await screen.findByTestId("loyalty-convert-button")).toBeDisabled(); expect(screen.getByTestId("loyalty-not-enough")).toHaveTextContent("You need 30 points"); first.unmount();
    use(me({ tier: "NONE", tierSince: null, next: null, points: { balance: 0, expiringSoon: null }, conversion: { open: false, pointsRequired: 0, valueMinor: 0, currency: "EGP", blocksLeftThisYear: 0, canConvert: false } }));
    renderApp(<LoyaltyHome />, { lang: "en" }); expect(await screen.findByTestId("loyalty-convert-closed")).toBeInTheDocument(); expect(screen.queryByTestId("loyalty-convert-button")).not.toBeInTheDocument(); expect(screen.getByTestId("loyalty-no-tiers")).toBeInTheDocument(); expect(screen.getByTestId("loyalty-tier-name")).toHaveTextContent("No tier yet");
  });
  it("redeems a partner code: the button stays off until the code is well formed, the cleaned code is posted, the voucher is confirmed, the terms placeholder is flagged for counsel", async () => {
    let body: unknown = null; use(); server.use(http.post(`${L}/partner/redeem`, async ({ request }) => { body = await request.json(); return HttpResponse.json({ redeemed: true, lotId: "rwl_2", amountMinor: 3000, currency: "EGP", partner: { ar: "بنك إكس", en: "Bank X" }, legalTextRef: "TODO" }); }));
    renderApp(<LoyaltyHome />, { lang: "en" }); const input = await screen.findByTestId("loyalty-partner-code"); const submit = screen.getByTestId("loyalty-partner-submit");
    expect(submit).toBeDisabled(); await userEvent.type(input, "bad"); expect(submit).toBeDisabled(); await userEvent.clear(input); await userEvent.type(input, "a7kq2-m9xot"); expect(submit).toBeEnabled(); await userEvent.click(submit);
    await waitFor(() => expect(body).toEqual({ code: "A7KQ2M9X0T" })); expect(await screen.findByTestId("loyalty-partner-done")).toHaveTextContent(/voucher worth.*from Bank X/); expect(screen.getByTestId("loyalty-partner-terms")).toHaveAttribute("data-needs-human", "true"); expect(input).toHaveValue("");
  });
  it("shows a specific calm message for each partner refusal and never echoes the code", async () => {
    for (const [code, re] of [["PARTNERSHIP_CODE_EXPIRED", /expired/], ["PARTNERSHIP_ALREADY_REDEEMED", /already used/], ["PARTNERSHIP_BUDGET_EXCEEDED", /run out/], ["PARTNERSHIP_CODE_INVALID", /not valid/]] as const) {
      use(); server.use(http.post(`${L}/partner/redeem`, () => HttpResponse.json({ code, message: "x" }, { status: 422 })));
      const { unmount } = renderApp(<LoyaltyHome />, { lang: "en" }); await userEvent.type(await screen.findByTestId("loyalty-partner-code"), "A7KQ2-M9X0T"); await userEvent.click(screen.getByTestId("loyalty-partner-submit"));
      const err = await screen.findByTestId("loyalty-partner-error"); expect(err).toHaveTextContent(re); expect(err.textContent).not.toContain("A7KQ2"); expect(screen.getByTestId("loyalty-partner-code")).toHaveAttribute("aria-invalid", "true"); unmount();
    }
  });
  it("flag OFF shows the unavailable state, not an error", async () => {
    server.use(http.get(`${L}/me`, () => HttpResponse.json({ code: "FEATURE_DISABLED", message: "x", key: "growth.loyalty", scope: "GLOBAL" }, { status: 403 })), http.get(`${L}/history`, () => HttpResponse.json({ items: [] })));
    renderApp(<LoyaltyHome />, { lang: "en" }); await waitFor(() => expect(screen.queryByTestId("loyalty-tier")).not.toBeInTheDocument()); expect(screen.queryByTestId("loyalty-convert-button")).not.toBeInTheDocument(); expect(await screen.findByText(/not available|unavailable|temporarily/i)).toBeInTheDocument();
  });
  it("renders in Arabic, right to left, with no axe violations", async () => {
    use(me(), [{ id: "e1", type: "ACCRUE", points: 10, direction: "IN", expiresAt: null, at: "2027-02-01T00:00:00Z" }]);
    renderApp(<LoyaltyHome />, { lang: "ar" }); expect(await screen.findByTestId("loyalty-tier-name")).toHaveTextContent("فضي"); expect(document.documentElement.dir).toBe("rtl"); expect(screen.getByTestId("loyalty-not-money")).toHaveTextContent("النقاط ليست مالاً");
    await screen.findByText("نقاط مكتسبة"); expect(await violations()).toEqual([]);
  });
});
