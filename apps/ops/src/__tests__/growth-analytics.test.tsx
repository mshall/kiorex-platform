import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { Route, Routes } from "react-router-dom";
import { server } from "@/test/mocks/server";
import { renderOps } from "@/test/utils";
import GrowthAnalyticsPage from "@/pages/growth-analytics/GrowthAnalyticsPage";
import AcquisitionPage from "@/pages/growth-analytics/AcquisitionPage";

const B = "/api/v1/ops/growth-analytics";
const fresh = { rolledUpAt: "2026-11-24T10:00:00.000Z", lastEventAt: "2026-11-24T09:59:00.000Z" };
const overview = { period: { from: "2026-10-26", to: "2026-11-24" }, filters: {}, audience: "OPS", k: 10, freshness: fresh, bookings: 120, attendedNewPatients: "<10", feeBearingNewPatients: "<10", providerLedShare: 35, originMix: { providerLed: 42, marketplace: 60, unattributed: 18 }, bookingToAttended: 75, searchToBooking: 8, grossBookingValueMinor: 6_000_000, grossBookingValue: { isRevenue: false, note: "x" }, kiorexRevenueMinor: "<10", commissionPendingMinor: "<10", spendMinor: 0, blendedCacMinor: null, merRatio: null, ltvMinor: 3840, coverage: { visitorStageAvailable: true }, masked: true };
const funnel = { period: overview.period, freshness: fresh, coverage: { visitorStageAvailable: true }, stages: [{ stage: "PageViewed", count: 200, masked: false, kind: "VISITOR_STREAM", stepConversionPct: null, cumulativeConversionPct: null }, { stage: "SearchStarted", count: 100, masked: false, kind: "VISITOR_STREAM", stepConversionPct: 50, cumulativeConversionPct: 50 }, { stage: "BookingAttended", count: "<10", masked: true, kind: "BOOKING_FACT", stepConversionPct: "<10", cumulativeConversionPct: "<10" }] };
const channels = { freshness: fresh, rows: [{ sourceKind: "CAMPAIGN", bookings: 40, attendedNewPatients: 12, spendMinor: 200_000, revenueMinor: 48_000, cacMinor: 16_667, roas: 0.24, ltvToCac: 0.23, verdict: "REVIEW", masked: false }, { sourceKind: "WHATSAPP", bookings: "<10", attendedNewPatients: "<10", spendMinor: 0, revenueMinor: "<10", cacMinor: "<10", roas: "<10", ltvToCac: "<10", verdict: "<10", masked: true }] };
const cohorts = { observation: "closed", rows: [{ cohort: "2026-05", size: 12, masked: false, retention30Pct: 41.67, retention90Pct: 66.67, retention180Pct: null }, { cohort: "2026-10", size: "<10", masked: true, retention30Pct: "<10", retention90Pct: "<10", retention180Pct: "<10" }] };
const mock = () => server.use(http.get(`${B}/overview`, () => HttpResponse.json(overview)), http.get(`${B}/funnel`, () => HttpResponse.json(funnel)), http.get(`${B}/channels`, () => HttpResponse.json(channels)), http.get(`${B}/cohorts`, () => HttpResponse.json(cohorts)), http.get(`${B}/breakdown/:dim`, () => HttpResponse.json({ rows: [] })));
const mount = (ui = <GrowthAnalyticsPage />, lang: "en" | "ar" = "en") => renderOps(<Routes><Route path="/x" element={ui} /></Routes>, { route: "/x", lang });

describe("Growth analytics page", () => {
  it("shows executive tiles, funnel, channel table and cohort table with every small cell masked as <10", async () => {
    mock(); mount();
    const tiles = await screen.findByTestId("ga-tiles");
    expect(within(tiles).getByText("Confirmed bookings").closest(".kx-card")).toHaveTextContent("120");
    expect(within(tiles).getAllByTestId("masked").length).toBeGreaterThanOrEqual(2); // attended new patients and revenue are under k
    expect(screen.getByText("Gross booking value (not revenue)")).toBeInTheDocument();
    expect(screen.getByTestId("ga-gbv-note")).toHaveTextContent(/never Kiorex revenue/i);
    expect(screen.getByText("Page viewed")).toBeInTheDocument();
    expect(screen.getAllByText("Campaign").length).toBeGreaterThan(0);
    expect(screen.getByText("2026-10")).toBeInTheDocument();
    expect(screen.getAllByTestId("masked").length).toBeGreaterThan(8);
    expect(document.body.textContent).not.toMatch(/\b[1-9]\b\s*(bookings)/);
  });
  it("has labelled filters for every dimension and hides the country selector with one live market", async () => {
    mock(); mount();
    await screen.findByTestId("ga-tiles");
    for (const l of ["From", "To", "City", "District", "Specialty", "Provider", "Doctor", "Branch", "Campaign", "Channel"]) expect(screen.getByLabelText(l)).toBeInTheDocument();
    expect(screen.queryByLabelText("Country")).not.toBeInTheDocument();
  });
  it("renders in Arabic with right-to-left text and Arabic labels", async () => {
    mock(); mount(<GrowthAnalyticsPage />, "ar");
    expect(await screen.findByText("تحليلات النمو")).toBeInTheDocument();
    expect(await screen.findByText("إجمالي قيمة الحجوزات (ليس إيرادًا)")).toBeInTheDocument();
    expect(document.documentElement.dir).toBe("rtl");
  });
});

describe("Acquisition page", () => {
  const spend = (o: object = {}) => ({ id: "sp_1", day: "2026-11-24", campaign: "ramadan", channel: "meta", sourceKind: "CAMPAIGN", amountMinor: 200_000, currency: "EGP", note: "", status: "PENDING", createdBy: "someone-else", decidedBy: null, ...o });
  it("shows the origin mix and lets a different user approve a pending spend line, but not the author", async () => {
    let approved = false;
    mock();
    server.use(http.get(`${B}/spend`, () => HttpResponse.json([spend(), spend({ id: "sp_2", createdBy: "test-ops-1" })])), http.post(`${B}/spend/sp_1/approve`, () => { approved = true; return HttpResponse.json(spend({ status: "APPROVED" })); }));
    mount(<AcquisitionPage />);
    expect(await screen.findByTestId("acq-tiles")).toHaveTextContent("42");
    expect(await screen.findByTestId("approve-sp_1")).toBeInTheDocument();
    expect(screen.queryByTestId("approve-sp_2")).not.toBeInTheDocument(); // my own line: needs another approver
    expect(screen.getByText("Needs another approver")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("approve-sp_1"));
    await waitFor(() => expect(approved).toBe(true));
  });
  it("posts a spend line in piastres and rejects a non-positive amount before calling the API", async () => {
    mock(); let body: Record<string, unknown> | undefined;
    server.use(http.get(`${B}/spend`, () => HttpResponse.json([])), http.post(`${B}/spend`, async ({ request }) => { body = (await request.json()) as Record<string, unknown>; return HttpResponse.json(spend()); }));
    mount(<AcquisitionPage />);
    await screen.findByTestId("spend-form");
    await userEvent.type(screen.getByLabelText("Amount (EGP)"), "0"); await userEvent.click(screen.getByTestId("spend-submit"));
    expect(await screen.findByTestId("spend-error")).toHaveTextContent("positive");
    expect(body).toBeUndefined();
    await userEvent.clear(screen.getByLabelText("Amount (EGP)")); await userEvent.type(screen.getByLabelText("Amount (EGP)"), "1500.50"); await userEvent.type(within(screen.getByTestId("spend-form")).getByLabelText("Campaign"), "ramadan");
    await userEvent.click(screen.getByTestId("spend-submit"));
    await waitFor(() => expect(body).toMatchObject({ amountMinor: 150_050, campaign: "ramadan" }));
  });
});
