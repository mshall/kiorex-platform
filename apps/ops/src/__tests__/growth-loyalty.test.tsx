/* eslint-disable @typescript-eslint/no-explicit-any -- loosely typed request-body captures in the test */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "@/test/mocks/server";
import { renderOps } from "@/test/utils";
import LoyaltyHostPage from "@/pages/growth/loyalty/Page";
import i18nJson from "@/i18n/growth.loyalty.json";

const A = "/api/v1/admin/growth/loyalty"; const G = "/api/v1/ops/growth"; const C = "/api/v1/admin/growth/campaigns";
const caps = (manage = true) => HttpResponse.json({ roles: ["ops_admin", ...(manage ? ["super_admin"] : [])], capabilities: { read: true, readFinance: false, writeConfig: manage, approveConfig: manage, reviewFraud: false, manage, manageCampaigns: manage, reviewPromotions: false, manageCorporate: manage, manageLoyalty: manage } });
const flat = (o: unknown, p = ""): string[] => (o && typeof o === "object" ? Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => flat(v, p ? `${p}.${k}` : k)) : [p]);
const violations = async () => (await axe.run(document.body, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] }, rules: { "color-contrast": { enabled: false }, region: { enabled: false } } })).violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`);
const RULES0 = { enabled: true, pointsPerCompletedBooking: 0, windowMonths: 12, expiryMonths: 12, annualCapPoints: 0, tiers: { SILVER: { minCompletedBookings: 0, bonusPoints: 0 }, GOLD: { minCompletedBookings: 0, bonusPoints: 0 }, PLATINUM: { minCompletedBookings: 0, bonusPoints: 0 } }, conversion: { pointsRequired: 0, valueMinor: 0, maxBlocksPerYear: 0 } };
const RULES = { ...RULES0, pointsPerCompletedBooking: 10, annualCapPoints: 1000, tiers: { SILVER: { minCompletedBookings: 3, bonusPoints: 5 }, GOLD: { minCompletedBookings: 6, bonusPoints: 10 }, PLATINUM: { minCompletedBookings: 0, bonusPoints: 0 } }, conversion: { pointsRequired: 30, valueMinor: 5000, maxBlocksPerYear: 2 } };
const rulesView = (rules = RULES0, o: Record<string, unknown> = {}) => ({ rules, versionId: "v1", source: "PROPOSED_DEFAULT", defaultsOnly: true, allZero: rules === RULES0, flagOn: false, ...o });
const summary = (o: Record<string, unknown> = {}) => ({ k: 10, accounts: 120, tiers: { NONE: 100, SILVER: 12, GOLD: null, PLATINUM: 0 }, points: { outstanding: 4300, holders: 90 }, last30Days: { earned: { people: 40, points: 900 }, expired: { people: null, points: null }, reversed: { people: 0, points: 0 }, converted: { people: 12, points: 360 } }, partnerships: { ACTIVE: { programs: 1, budgetMinor: 900000 }, DRAFT: { programs: 2, budgetMinor: 0 } }, suppressed: ["tiers.GOLD", "last30Days.expired.people", "last30Days.expired.points"], ...o });
const prog = (o: Record<string, unknown> = {}) => ({ id: "ptp_1", key: "bank-x", partnerRef: "bank-x", kind: "CODE_DISCOUNT", nameAr: "بنك إكس", nameEn: "Bank X", status: "DRAFT", fundingMode: "PLATFORM_MARKETING", budgetMinor: 900000, perRedemptionMinor: 30000, currency: "EGP", startsAt: null, endsAt: null, campaignId: null, legalTextRef: "TODO_NEEDS_HUMAN: counsel legal text reference", legalTextIsPlaceholder: true, createdBy: "a", activatedBy: null, usedMinor: 0, redemptions: 0, campaign: null, ...o });
const base = (manage = true) => server.use(http.get(`${G}/access`, () => caps(manage)), http.get(`${A}/summary`, () => HttpResponse.json(summary())), http.get(`${A}/rules`, () => HttpResponse.json(rulesView())), http.get(`${A}/partnerships`, () => HttpResponse.json({ items: [prog()] })), http.get(C, () => HttpResponse.json([{ id: "cmp_1", key: "partner-1", name: "Bank partner offer", status: "ACTIVE", channels: ["PARTNER"], budgetTotalMinor: 1_000_000 }, { id: "cmp_2", key: "email-1", name: "Email push", status: "ACTIVE", channels: ["EMAIL"], budgetTotalMinor: 1 }])), http.get(`${A}/partnerships/ptp_1/codes`, () => HttpResponse.json({ items: [] })));
const open = async (tab: "overview" | "tiers" | "partnerships") => { await userEvent.click(await screen.findByTestId(`loy-tab-${tab}`)); };

describe("loyalty ops i18n", () => { it("English and Arabic carry the same keys", () => { const e = new Set(flat(i18nJson.en)); const a = new Set(flat(i18nJson.ar)); expect([...e].filter((k) => !a.has(k))).toEqual([]); expect([...a].filter((k) => !e.has(k))).toEqual([]); }); });

describe("Loyalty overview (GRW-P4-D)", () => {
  it("says points are not money, shows the zero-defaults warning, and masks every cell below 10 as <10", async () => {
    base();
    renderOps(<LoyaltyHostPage />, { route: "/growth/loyalty" });
    expect(await screen.findByTestId("loy-not-money")).toHaveTextContent(/Points are not money/); expect(await screen.findByTestId("loy-zero-note")).toHaveTextContent(/still at its default of 0/); expect(screen.getByTestId("loy-zero-note")).toHaveAttribute("data-needs-human", "true");
    const cards = await screen.findByTestId("loy-cards"); expect(within(cards).getByText("120")).toBeInTheDocument(); expect(within(cards).getAllByText("<10").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByTestId("loy-suppressed")).toHaveTextContent(/fewer than 10 people/); expect(screen.getByTestId("loy-state")).toHaveTextContent(/locked or off/);
  });
  it("shows no person, no balance of one person and no wallet verb anywhere on the page", async () => {
    base(); renderOps(<LoyaltyHostPage />, { route: "/growth/loyalty" }); await screen.findByTestId("loy-cards");
    expect(document.body.textContent).not.toMatch(/\bsub_|kx_bk|\+20\d{9}/);
    for (const b of screen.queryAllByRole("button")) expect(b.textContent).not.toMatch(/top.?up|transfer|withdraw|cash.?out|send/i);
  });
  it("renders in Arabic, right to left, with no axe violations", async () => {
    base(); renderOps(<LoyaltyHostPage />, { route: "/growth/loyalty", lang: "ar" });
    expect(await screen.findByTestId("loy-not-money")).toHaveTextContent("النقاط ليست مالاً."); await screen.findByTestId("loy-cards"); expect(document.documentElement.dir).toBe("rtl"); expect(await violations()).toEqual([]);
  });
});

describe("Tiers and rules (GRW-P4-D)", () => {
  it("lists the ladder with undefined tiers marked, the rules read only with a link to the config console, and the masked people counts", async () => {
    server.use(http.get(`${G}/access`, () => caps()), http.get(`${A}/summary`, () => HttpResponse.json(summary())), http.get(`${A}/rules`, () => HttpResponse.json(rulesView(RULES, { defaultsOnly: false, allZero: false, flagOn: true, source: "ACTIVE" }))));
    renderOps(<LoyaltyHostPage />, { route: "/growth/loyalty" }); await open("tiers");
    expect(await screen.findByTestId("loy-min-SILVER")).toHaveTextContent("3"); expect(screen.getByTestId("loy-min-GOLD")).toHaveTextContent("6"); expect(screen.getByText("Not defined")).toBeInTheDocument();
    expect(screen.getByTestId("loy-people-SILVER")).toHaveTextContent("12"); expect(screen.getByTestId("loy-people-GOLD")).toHaveTextContent("<10"); expect(screen.getByTestId("loy-rule-convPoints")).toHaveTextContent("30");
    expect(screen.getByTestId("loy-edit-note")).toHaveTextContent(/second approver/); expect(screen.getByRole("link", { name: "Open the config console" })).toHaveAttribute("href", "/growth/config");
    expect(screen.getByTestId("loy-needs-human")).toHaveAttribute("data-needs-human", "true"); expect(screen.queryByRole("textbox", { name: /points per/i })).not.toBeInTheDocument();
  });
  it("the calculator asks the server which tier N completed bookings give", async () => {
    let asked = ""; server.use(http.get(`${G}/access`, () => caps()), http.get(`${A}/summary`, () => HttpResponse.json(summary())), http.get(`${A}/rules`, () => HttpResponse.json(rulesView())), http.get(`${A}/tiers/preview`, ({ request }) => { asked = new URL(request.url).searchParams.get("completed") ?? ""; return HttpResponse.json({ completed: Number(asked), tier: "GOLD" }); }));
    renderOps(<LoyaltyHostPage />, { route: "/growth/loyalty" }); await open("tiers");
    await userEvent.type(await screen.findByTestId("loy-calc-input"), "6"); await waitFor(() => expect(screen.getByTestId("loy-calc-result")).toHaveTextContent("6 completed bookings give: Gold")); expect(asked).toBe("6");
  });
});

describe("Partnership programs (GRW-P4-D)", () => {
  it("drafting posts money as integer minor units with the amounts defaulting to 0, and never sends an owner or a status", async () => {
    let body: any = null; base(); server.use(http.post(`${A}/partnerships`, async ({ request }) => { body = await request.json(); return HttpResponse.json(prog({ id: "ptp_2", key: "new-one" }), { status: 201 }); }));
    renderOps(<LoyaltyHostPage />, { route: "/growth/loyalty" }); await open("partnerships");
    await userEvent.type(await screen.findByTestId("ptn-key"), "new-one"); await userEvent.type(screen.getByTestId("ptn-partner"), "Bank X"); await userEvent.click(screen.getByTestId("ptn-create"));
    await waitFor(() => expect(body).toMatchObject({ key: "new-one", partnerRef: "Bank X", kind: "CODE_DISCOUNT", budgetMinor: 0, perRedemptionMinor: 0 })); expect(body.status).toBeUndefined(); expect(body.createdBy).toBeUndefined();
    await userEvent.type(screen.getByTestId("ptn-budget"), "9000"); await userEvent.type(screen.getByTestId("ptn-value"), "300.5"); await userEvent.type(screen.getByTestId("ptn-key"), "second"); await userEvent.type(screen.getByTestId("ptn-partner"), "x"); await userEvent.click(screen.getByTestId("ptn-create"));
    await waitFor(() => expect(body).toMatchObject({ budgetMinor: 900000, perRedemptionMinor: 30050 }));
  });
  it("links only PARTNER-channel campaigns, activation is a separate act, and a read-only role sees no form and no action", async () => {
    let linked: any = null; base(); server.use(http.post(`${A}/partnerships/ptp_1/campaign`, async ({ request }) => { linked = await request.json(); return HttpResponse.json(prog({ campaignId: "cmp_1" })); }));
    const first = renderOps(<LoyaltyHostPage />, { route: "/growth/loyalty" }); await open("partnerships");
    const sel = await screen.findByTestId("ptn-link-bank-x"); expect(within(sel).getAllByRole("option").map((o) => o.textContent)).toEqual(["Choose a PARTNER campaign", "Bank partner offer (ACTIVE)"]); await userEvent.selectOptions(sel, "cmp_1"); await waitFor(() => expect(linked).toEqual({ campaignId: "cmp_1" }));
    expect(screen.getByTestId("ptn-activate-bank-x")).toBeInTheDocument(); expect(screen.getByTestId("ptn-rules-note")).toHaveTextContent(/second approver/); expect(screen.getByTestId("ptn-needs-human")).toHaveAttribute("data-needs-human", "true"); first.unmount();
    base(false); renderOps(<LoyaltyHostPage />, { route: "/growth/loyalty" }); await open("partnerships");
    expect(await screen.findByTestId("ptn-open-bank-x")).toBeInTheDocument(); expect(screen.queryByTestId("ptn-form")).not.toBeInTheDocument(); expect(screen.queryByTestId("ptn-activate-bank-x")).not.toBeInTheDocument(); expect(screen.queryByTestId("ptn-link-bank-x")).not.toBeInTheDocument();
  });
  it("shows the budget bar with its numbers, and a creator-activation refusal from the server is shown as an error", async () => {
    base(); server.use(http.get(`${A}/partnerships`, () => HttpResponse.json({ items: [prog({ usedMinor: 300000, redemptions: 10, budgetMinor: 900000 })] })), http.post(`${A}/partnerships/ptp_1/activate`, () => HttpResponse.json({ code: "PARTNERSHIP_SELF_APPROVAL", message: "The person who created a program cannot activate it" }, { status: 403 })));
    renderOps(<LoyaltyHostPage />, { route: "/growth/loyalty" }); await open("partnerships");
    const bar = await screen.findByTestId("ptn-usage-bank-x"); expect(within(bar).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "33"); expect(bar).toHaveTextContent(/10/);
    await userEvent.click(screen.getByTestId("ptn-activate-bank-x")); expect(await screen.findByText(/cannot activate it/)).toBeInTheDocument();
  });
  it("a new code is shown ONCE, with the plain text; afterwards the list holds only counts and state", async () => {
    let codes: any[] = []; base(); server.use(http.get(`${A}/partnerships/ptp_1/codes`, () => HttpResponse.json({ items: codes })), http.post(`${A}/partnerships/ptp_1/codes`, async ({ request }) => { const b: any = await request.json(); codes = [{ id: "ptc_1", label: b.label, maxRedemptions: b.maxRedemptions, redeemedCount: 0, expiresAt: null, status: "ACTIVE", createdAt: "2027-02-20T00:00:00Z" }]; return HttpResponse.json({ id: "ptc_1", code: "ABCDE-FGHJK", label: b.label, maxRedemptions: b.maxRedemptions, expiresAt: null, shownOnce: true }, { status: 201 }); }));
    renderOps(<LoyaltyHostPage />, { route: "/growth/loyalty" }); await open("partnerships"); await userEvent.click(await screen.findByTestId("ptn-open-bank-x"));
    expect(await screen.findByTestId("ptn-legal")).toHaveAttribute("data-needs-human", "true");
    await userEvent.type(await screen.findByTestId("ptn-code-label"), "Card mailer"); await userEvent.click(screen.getByTestId("ptn-code-create"));
    expect(await screen.findByTestId("ptn-code-value")).toHaveTextContent("ABCDE-FGHJK"); await userEvent.click(screen.getByTestId("ptn-code-dismiss"));
    expect(screen.queryByTestId("ptn-code-value")).not.toBeInTheDocument(); expect(await screen.findByText("Card mailer")).toBeInTheDocument(); expect(document.body.textContent).not.toContain("ABCDE-FGHJK");
  });
  it("renders in Arabic and passes axe on the program list and the detail", async () => {
    base(); renderOps(<LoyaltyHostPage />, { route: "/growth/loyalty", lang: "ar" }); await userEvent.click(await screen.findByTestId("loy-tab-partnerships")); await userEvent.click(await screen.findByTestId("ptn-open-bank-x"));
    expect(await screen.findByRole("heading", { level: 2, name: "برامج الشراكة" })).toBeInTheDocument(); expect(document.documentElement.dir).toBe("rtl"); expect(await violations()).toEqual([]);
  });
});
