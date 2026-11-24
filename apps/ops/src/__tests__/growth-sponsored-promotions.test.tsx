import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { Route, Routes } from "react-router-dom";
import { server } from "@/test/mocks/server";
import { renderOps } from "@/test/utils";
import SponsoredPromotionsPage from "@/pages/growth/sponsored-promotions/Page";
import PromotionReviewPage from "@/pages/growth/promotions/PromotionReviewPage";
import PromotionLedgerPage from "@/pages/growth/promotions/PromotionLedgerPage";
import i18nJson from "@/i18n/growth.sponsoredPromotions.json";

const A = "/api/v1/admin/growth/sponsored-promotions"; const G = "/api/v1/ops/growth";
const caps = (manage = true) => HttpResponse.json({ roles: ["ops_admin", ...(manage ? ["super_admin"] : [])], capabilities: { read: true, readFinance: false, writeConfig: manage, approveConfig: manage, reviewFraud: false, manage, manageCampaigns: manage, reviewPromotions: manage } });
const growthAdminCaps = () => HttpResponse.json({ roles: ["growth_admin"], capabilities: { read: true, readFinance: false, writeConfig: false, approveConfig: false, reviewFraud: false, manage: false, manageCampaigns: false, reviewPromotions: true } });
const flat = (o: unknown, p = ""): string[] => (o && typeof o === "object" ? Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => flat(v, p ? `${p}.${k}` : k)) : [p]);
const detail = (o: Record<string, unknown> = {}) => ({ promotionId: "prm_1", version: 1, orgRef: "tn_1", status: "IN_REVIEW", nameAr: "خصم الكشف", nameEn: "Visit discount", patientCopyAr: "خصم على سعر الكشف برعاية العيادة", patientCopyEn: "A discount on the visit fee, sponsored by the clinic", scope: { careTypes: ["IN_CLINIC"] }, discount: { kind: "FIXED_MINOR", value: 5000 }, eligibility: {}, budgetCapMinor: 6_000_000, fundingMode: "WALLET_ONLY", startsAt: "2027-02-01T00:00:00Z", endsAt: "2027-03-01T00:00:00Z", contentHash: "a".repeat(64), highValue: ["BUDGET_AT_OR_ABOVE_THRESHOLD"], guard: { ok: true, hits: [], signal: null, listVersion: "x" }, reviews: [{ id: "r1", kind: "CONTENT", decision: null, reason: null, decidedAt: null }, { id: "r2", kind: "SCOPE", decision: "APPROVED", reason: null, decidedAt: "2027-01-02T10:00:00Z" }, { id: "r3", kind: "HIGH_VALUE", decision: null, reason: null, decidedAt: null }], ...o });
const page = () => <Routes><Route path="/growth/sponsored-promotions/:id" element={<PromotionReviewPage />} /><Route path="/growth/sponsored-promotions/:id/ledger" element={<PromotionLedgerPage />} /></Routes>;

describe("sponsored promotions i18n", () => { it("English and Arabic carry the same keys", () => { const e = new Set(flat(i18nJson.en)); const a = new Set(flat(i18nJson.ar)); expect([...e].filter((k) => !a.has(k))).toEqual([]); expect([...a].filter((k) => !e.has(k))).toEqual([]); }); });

describe("Review queue (GRW-P2-S)", () => {
  it("lists promotions in review with the review chips, links to the review page, and says the clinic funds it", async () => {
    server.use(http.get(`${G}/access`, () => caps()), http.get(A, () => HttpResponse.json([{ promotionId: "prm_1", version: 1, orgRef: "tn_1", status: "IN_REVIEW", nameAr: "خصم", nameEn: "Visit discount", budgetCapMinor: 6_000_000, updatedAt: "2027-01-02T10:00:00Z", reviews: [{ kind: "CONTENT", decision: null, decidedAt: null }, { kind: "SCOPE", decision: "APPROVED", decidedAt: "x" }] }])));
    renderOps(<SponsoredPromotionsPage />, { route: "/growth/sponsored-promotions" });
    expect(await screen.findByRole("link", { name: "Visit discount" })).toHaveAttribute("href", "/growth/sponsored-promotions/prm_1");
    expect(screen.getByTestId("sponsored-note")).toHaveTextContent(/never touches the clinic's wallet/i); expect(screen.getByText("Wording")).toBeInTheDocument();
    expect(screen.getByText("60,000")).toBeInTheDocument();
  });
  it("filters and renders in Arabic", async () => {
    let status = "";
    server.use(http.get(`${G}/access`, () => caps()), http.get(A, ({ request }) => { status = new URL(request.url).searchParams.get("status") ?? ""; return HttpResponse.json([]); }));
    renderOps(<SponsoredPromotionsPage />, { route: "/growth/sponsored-promotions", lang: "ar" });
    await userEvent.click(await screen.findByTestId("sp-filter-ACTIVE")); await waitFor(() => expect(status).toBe("ACTIVE")); expect(await screen.findByText("لا توجد عروض هنا.")).toBeInTheDocument();
  });
});

describe("Review page (GRW-P2-S)", () => {
  it("shows both languages exactly as written, the rules, the automated check and a second-approver flag; a decision is posted with the version, kind and note", async () => {
    let body: any = null;
    server.use(http.get(`${G}/access`, () => caps()), http.get(`${A}/prm_1`, () => HttpResponse.json(detail())), http.post(`${A}/prm_1/decisions`, async ({ request }) => { body = await request.json(); return HttpResponse.json(detail()); }));
    renderOps(page(), { route: "/growth/sponsored-promotions/prm_1" });
    const text = await screen.findByTestId("sponsored-text"); expect(within(text).getByText("A discount on the visit fee, sponsored by the clinic")).toBeInTheDocument(); expect(within(text).getByText("خصم على سعر الكشف برعاية العيادة")).toBeInTheDocument();
    expect(screen.getByTestId("sponsored-highvalue")).toHaveTextContent(/second approver/i); expect(screen.getByTestId("sponsored-guard")).toHaveTextContent(/No blocked wording/);
    expect(screen.getByTestId("review-SCOPE")).toHaveTextContent("Approved"); expect(screen.queryByTestId("approve-SCOPE")).toBeNull(); // decided: final
    await userEvent.type(screen.getByTestId("sponsored-note-input"), "ok"); await userEvent.click(screen.getByTestId("approve-CONTENT"));
    await waitFor(() => expect(body).toEqual({ version: 1, kind: "CONTENT", decision: "APPROVED", note: "ok" }));
    expect(screen.getByTestId("sponsored-ledger-link")).toHaveAttribute("href", "/growth/sponsored-promotions/prm_1/ledger");
  });
  it("lists the blocked terms and shows the server's reason when a decision is refused", async () => {
    server.use(http.get(`${G}/access`, () => caps()), http.get(`${A}/prm_1`, () => HttpResponse.json(detail({ guard: { ok: false, signal: "PF_CLINICAL_INDUCEMENT", listVersion: "x", hits: [{ rule: "CLINICAL_CLAIM", term: "surgery", severity: "BLOCK", lang: "en" }, { rule: "WARN_FREE", term: "free", severity: "WARN", lang: "en" }] } }))),
      http.post(`${A}/prm_1/decisions`, () => HttpResponse.json({ code: "GUARD_BLOCKS_APPROVAL", message: "x" }, { status: 422 })));
    renderOps(page(), { route: "/growth/sponsored-promotions/prm_1" });
    expect(await screen.findByTestId("sponsored-guard")).toHaveTextContent(/Blocked wording found/); expect(screen.getByTestId("sponsored-hits")).toHaveTextContent("surgery");
    await userEvent.click(screen.getByTestId("approve-CONTENT")); expect(await screen.findByTestId("sponsored-error")).toHaveTextContent(/blocks approval/i);
  });
  it("is read-only without the manage capability (no decision button)", async () => {
    server.use(http.get(`${G}/access`, () => caps(false)), http.get(`${A}/prm_1`, () => HttpResponse.json(detail())));
    renderOps(page(), { route: "/growth/sponsored-promotions/prm_1" });
    expect(await screen.findByTestId("sponsored-readonly")).toBeInTheDocument(); expect(screen.queryByTestId("approve-CONTENT")).toBeNull();
  });
  it("a growth_admin (not a super admin) can decide a review", async () => {
    server.use(http.get(`${G}/access`, () => growthAdminCaps()), http.get(`${A}/prm_1`, () => HttpResponse.json(detail())));
    renderOps(page(), { route: "/growth/sponsored-promotions/prm_1" });
    expect(await screen.findByTestId("approve-CONTENT")).toBeInTheDocument(); expect(screen.queryByTestId("sponsored-readonly")).toBeNull();
  });
  it("renders in Arabic and shows an error state with a retry", async () => {
    server.use(http.get(`${G}/access`, () => caps()), http.get(`${A}/prm_1`, () => HttpResponse.json(detail())));
    const { unmount } = renderOps(page(), { route: "/growth/sponsored-promotions/prm_1", lang: "ar" }); expect(await screen.findByText("ما يقرؤه المريض")).toBeInTheDocument(); unmount();
    server.use(http.get(`${A}/prm_9`, () => HttpResponse.json({ code: "INTERNAL", message: "x" }, { status: 500 })));
    renderOps(page(), { route: "/growth/sponsored-promotions/prm_9" }); expect(await screen.findByRole("button", { name: /retry|try again/i })).toBeInTheDocument();
  });
});

describe("Sponsored ledger (GRW-P2-S)", () => {
  it("shows the distinct provider-sponsored discount line per booking, signed, with totals by state and no patient column", async () => {
    server.use(http.get(`${G}/access`, () => caps()), http.get(`${A}/prm_1/ledger`, () => HttpResponse.json({ promotionId: "prm_1", total: 2, page: 1, pageSize: 50, byState: [{ state: "DEBITED", count: 1, amountMinor: 5000 }, { state: "APPLIED", count: 1, amountMinor: 5000 }], lines: [{ id: "l1", bookingIntentId: "kx_bk_1", promotionVersion: 1, amountMinor: 5000, signedAmountMinor: -5000, currency: "EGP", state: "DEBITED", ledgerLine: "PROVIDER_SPONSORED_DISCOUNT", createdAt: "2027-01-02T10:00:00Z", updatedAt: "2027-01-03T10:00:00Z" }, { id: "l2", bookingIntentId: "kx_bk_2", promotionVersion: 1, amountMinor: 5000, signedAmountMinor: -5000, currency: "EGP", state: "APPLIED", ledgerLine: "PROVIDER_SPONSORED_DISCOUNT", createdAt: "2027-01-02T11:00:00Z", updatedAt: "2027-01-02T11:00:00Z" }] })));
    renderOps(page(), { route: "/growth/sponsored-promotions/prm_1/ledger" });
    expect(await screen.findByText("kx_bk_1")).toBeInTheDocument(); expect(screen.getAllByText("Provider-sponsored discount").length).toBeGreaterThanOrEqual(2); expect(screen.getAllByText(/-50 EGP/).length).toBe(2);
    expect(screen.getByTestId("sponsored-bystate")).toHaveTextContent("Debited"); expect(document.body.textContent).not.toMatch(/phone|national|patient name/i);
  });
});
