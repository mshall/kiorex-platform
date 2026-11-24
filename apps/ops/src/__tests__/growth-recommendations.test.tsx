import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "@/test/mocks/server";
import { renderOps } from "@/test/utils";
import RecommendationsRoute from "@/pages/growth/recommendations/Page";
import i18nJson from "@/i18n/growth.recommendations.json";

const A = "/api/v1/admin/growth/recommendations"; const G = "/api/v1/ops/growth";
const caps = (manage = true) => HttpResponse.json({ roles: ["ops_admin", "super_admin"], capabilities: { read: true, readFinance: false, writeConfig: manage, approveConfig: manage, reviewFraud: false, manage: false, manageCampaigns: manage, manageExperiments: manage, reviewPromotions: false } });
const flat = (o: unknown, p = ""): string[] => (o && typeof o === "object" ? Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => flat(v, p ? `${p}.${k}` : k)) : [p]);
const cat = { kinds: ["REALLOCATE_BUDGET", "PAUSE_CAMPAIGN", "CONTENT_SUGGESTION", "SEO_GAP", "LIFECYCLE_HOLDOUT"], policy: { k: 10, expiryDays: 14, maxPerRun: 10, maxShiftBp: 2000 }, mode: "mock" };
const rec = (o: Record<string, unknown> = {}) => ({ id: "r1", market: "EG", kind: "REALLOCATE_BUDGET", payload: { fromChannel: "PAID_SEARCH", toChannel: "REFERRAL", shiftBp: 1500, fromAttended: 40, toAttended: 50, window: { from: "2027-01-01", to: "2027-01-28" } }, rationale: { en: "Referral acquires patients at 10% of the cost of paid search.", ar: "الإحالات بتجيب مرضى بنسبة 10% من تكلفة البحث المدفوع." }, evidenceRefs: [{ source: "channel-performance", ref: "REFERRAL", window: "2027-01-01..2027-01-28" }], confidence: 74, status: "PROPOSED", decidedBy: null, decidedAt: null, decisionNote: null, convertedRef: null, modelMode: "mock", aiAssisted: true, aiSummary: { en: "Summary (mock): move some spend.", ar: "ملخص (تجريبي): انقل جزء من الإنفاق.", label: "AI-assisted", model: "mock" }, feedback: null, expiresAt: "2027-02-11T10:00:00Z", createdAt: "2027-01-28T10:00:00Z", next: null, ...o });

describe("recommendations i18n", () => {
  it("English and Arabic carry the same keys; Arabic has no English placeholder text", () => {
    const e = new Set(flat(i18nJson.en)); const a = new Set(flat(i18nJson.ar));
    expect([...e].filter((k) => !a.has(k))).toEqual([]); expect([...a].filter((k) => !e.has(k))).toEqual([]);
    expect(JSON.stringify(i18nJson.ar)).not.toMatch(/Recommendations|Approve|Rejected/);
  });
});

describe("Recommendations (GRW-P3-E)", () => {
  it("lists proposals with the AI-assisted label, confidence and expiry, and says plainly that nothing is applied automatically", async () => {
    server.use(http.get(`${G}/access`, () => caps()), http.get(`${A}/catalog`, () => HttpResponse.json(cat)), http.get(A, () => HttpResponse.json([rec(), rec({ id: "r2", kind: "SEO_GAP", aiAssisted: false, aiSummary: null, status: "CONVERTED" })])));
    renderOps(<RecommendationsRoute />, { route: "/growth/recommendations" });
    expect(await screen.findByTestId("rec-row-r1")).toHaveTextContent("Move budget between channels"); expect(screen.getByTestId("rec-ai-r1")).toHaveTextContent("AI-assisted"); expect(screen.getByTestId("rec-ai-r2")).toHaveTextContent("Rules only");
    expect(screen.getByTestId("rec-banner")).toHaveTextContent(/never send, spend, activate or change a budget/i); expect(screen.getByTestId("rec-row-r1")).toHaveTextContent("Confidence 74%");
    expect(await screen.findByTestId("rec-run")).toBeInTheDocument();
  });
  it("a read-only role cannot run or decide; the empty state explains itself", async () => {
    server.use(http.get(`${G}/access`, () => caps(false)), http.get(`${A}/catalog`, () => HttpResponse.json(cat)), http.get(A, () => HttpResponse.json([])));
    renderOps(<RecommendationsRoute />, { route: "/growth/recommendations" });
    expect(await screen.findByTestId("rec-empty")).toBeInTheDocument(); expect(screen.queryByTestId("rec-run")).toBeNull();
  });
  it("the locked feature answers in words when running proposals", async () => {
    server.use(http.get(`${G}/access`, () => caps()), http.get(`${A}/catalog`, () => HttpResponse.json(cat)), http.get(A, () => HttpResponse.json([])), http.post(`${A}/run`, () => HttpResponse.json({ code: "FEATURE_DISABLED", message: "x", key: "growth.ai_recommendations" }, { status: 403 })));
    renderOps(<RecommendationsRoute />, { route: "/growth/recommendations" });
    await userEvent.click(await screen.findByTestId("rec-run"));
    expect(await screen.findByTestId("rec-error")).toHaveTextContent(/locked until the governance review is recorded/);
  });
  it("detail: rationale, the labelled summary, the aggregate numbers with their names, and the evidence", async () => {
    server.use(http.get(`${G}/access`, () => caps()), http.get(`${A}/r1`, () => HttpResponse.json(rec())));
    renderOps(<RecommendationsRoute />, { route: "/growth/recommendations?id=r1" });
    expect(await screen.findByTestId("rec-rationale")).toHaveTextContent("Referral acquires patients"); expect(screen.getByTestId("rec-summary")).toHaveTextContent("AI-assisted");
    expect(screen.getByTestId("rec-numbers")).toHaveTextContent("From channel"); expect(screen.getByTestId("rec-numbers")).toHaveTextContent("PAID_SEARCH"); expect(screen.getByTestId("rec-evidence")).toHaveTextContent("channel-performance");
  });
  it("approve says a draft was created and that it still needs its own approval; the approve hint says nothing is activated, sent or spent", async () => {
    let body: unknown;
    server.use(http.get(`${G}/access`, () => caps()), http.get(`${A}/r1`, () => HttpResponse.json(rec())), http.post(`${A}/r1/decision`, async ({ request }) => { body = await request.json(); return HttpResponse.json(rec({ status: "CONVERTED", convertedRef: "campaign:c1", decidedBy: "test-ops-1", conversionError: null })); }));
    renderOps(<RecommendationsRoute />, { route: "/growth/recommendations?id=r1" });
    expect(await screen.findByText(/creates a draft only\. Nothing is activated, sent or spent/)).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("rec-approve"));
    expect(await screen.findByTestId("rec-result")).toHaveTextContent("A draft was created: campaign:c1. It still needs its own approval."); expect(body).toMatchObject({ decision: "APPROVE" });
  });
  it("reject needs a reason, and a decision someone else made first is explained", async () => {
    server.use(http.get(`${G}/access`, () => caps()), http.get(`${A}/r1`, () => HttpResponse.json(rec())), http.post(`${A}/r1/decision`, () => HttpResponse.json({ code: "RECOMMENDATION_NOT_PROPOSED", message: "x" }, { status: 409 })));
    renderOps(<RecommendationsRoute />, { route: "/growth/recommendations?id=r1" });
    expect(await screen.findByTestId("rec-reject")).toBeDisabled(); await userEvent.type(screen.getByTestId("rec-note"), "ran it already"); expect(screen.getByTestId("rec-reject")).not.toBeDisabled();
    await userEvent.click(screen.getByTestId("rec-reject")); expect(await screen.findByTestId("rec-error")).toHaveTextContent("Someone already decided");
  });
  it("an approved recommendation with no draft points at the screen where a person continues", async () => {
    server.use(http.get(`${G}/access`, () => caps()), http.get(`${A}/r1`, () => HttpResponse.json(rec({ kind: "PAUSE_CAMPAIGN", status: "APPROVED", decidedBy: "adm_a", next: { screen: "/growth/campaigns" } }))));
    renderOps(<RecommendationsRoute />, { route: "/growth/recommendations?id=r1" });
    expect(await screen.findByTestId("rec-next")).toHaveTextContent("/growth/campaigns"); expect(screen.queryByTestId("rec-approve")).toBeNull();
  });
  it("stores feedback", async () => {
    let fb: unknown;
    server.use(http.get(`${G}/access`, () => caps()), http.get(`${A}/r1`, () => HttpResponse.json(rec())), http.post(`${A}/r1/feedback`, async ({ request }) => { fb = await request.json(); return HttpResponse.json(rec({ feedback: "USEFUL" })); }));
    renderOps(<RecommendationsRoute />, { route: "/growth/recommendations?id=r1" });
    await userEvent.click(await screen.findByTestId("rec-useful")); await waitFor(() => expect(fb).toEqual({ value: "USEFUL" }));
  });
  it("renders in Arabic", async () => {
    server.use(http.get(`${G}/access`, () => caps()), http.get(`${A}/catalog`, () => HttpResponse.json(cat)), http.get(A, () => HttpResponse.json([rec()])));
    renderOps(<RecommendationsRoute />, { route: "/growth/recommendations", lang: "ar" });
    expect(await screen.findByTestId("rec-row-r1")).toHaveTextContent("الإحالات بتجيب مرضى"); expect(screen.getByTestId("rec-ai-r1")).toHaveTextContent("بمساعدة الذكاء الاصطناعي");
  });
});
