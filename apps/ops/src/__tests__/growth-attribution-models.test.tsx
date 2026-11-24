import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "@/test/mocks/server";
import { renderOps } from "@/test/utils";
import AttributionModelsPage from "@/pages/growth/attribution-models/Page";
import i18nJson from "@/i18n/growth.attributionModels.json";

const A = "/api/v1/admin/growth/attribution-models"; const G = "/api/v1/ops/growth";
const caps = () => HttpResponse.json({ roles: ["ops_admin"], capabilities: { read: true, readFinance: false, writeConfig: false, approveConfig: false, reviewFraud: false, manage: false, manageCampaigns: false } });
const flat = (o: unknown, p = ""): string[] => (o && typeof o === "object" ? Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => flat(v, p ? `${p}.${k}` : k)) : [p]);
const block = (model: string, rows: Array<[string, number | "<10", number | "<10"]>, total: [number, number], isDefault = false) => ({ model, available: true, isDefault, total: { conversions: total[0], revenueMinor: total[1] }, rows: rows.map(([sourceKind, conversions, revenueMinor]) => ({ sourceKind, paths: 12, masked: conversions === "<10", conversions, revenueMinor })) });
const cmp = (o: Record<string, unknown> = {}) => ({ market: "EG", from: "2027-01-01", to: "2027-01-30", defaultModel: "POSITION_BASED", reconciled: true, note: "x", dataDriven: { status: "INSUFFICIENT_VOLUME", message: "insufficient volume", conversions90d: 412, needed: 1000 },
  models: [block("LAST_TOUCH", [["DIRECT", 30, 120_000], ["ORGANIC_SEARCH", "<10", "<10"]], [40, 160_000]), block("POSITION_BASED", [["DIRECT", 14, 56_000], ["ORGANIC_SEARCH", 26, 104_000]], [40, 160_000], true), { model: "DATA_DRIVEN", available: false, isDefault: false, total: { conversions: 0, revenueMinor: 0 }, rows: [] }], ...o });

describe("attribution models i18n", () => {
  it("English and Arabic carry the same keys", () => { const e = new Set(flat(i18nJson.en)); const a = new Set(flat(i18nJson.ar)); expect([...e].filter((k) => !a.has(k))).toEqual([]); expect([...a].filter((k) => !e.has(k))).toEqual([]); });
});

describe("Attribution models page (GRW-P3-B)", () => {
  it("shows the models side by side with the default marked, the same total in every column, masked cells and the insufficient-volume data-driven state", async () => {
    server.use(http.get(`${G}/access`, () => caps()), http.get(A, () => HttpResponse.json(cmp())));
    renderOps(<AttributionModelsPage />, { route: "/growth/attribution-models" });
    const table = await screen.findByTestId("models-table");
    expect(within(table).getByTestId("col-POSITION_BASED")).toHaveTextContent("Default");
    expect(within(table).queryByTestId("col-DATA_DRIVEN")).toBeNull(); // not available: not drawn as a column of zeros
    expect(screen.getByTestId("cell-LAST_TOUCH-ORGANIC_SEARCH")).toHaveTextContent("<10");
    expect(screen.getByTestId("total-LAST_TOUCH")).toHaveTextContent("40"); expect(screen.getByTestId("total-POSITION_BASED")).toHaveTextContent("40");
    expect(screen.getByTestId("reconciled")).toHaveTextContent("Yes"); expect(screen.getByTestId("dd-status")).toHaveTextContent("Insufficient volume");
    expect(screen.getByTestId("models-reporting-only")).toHaveTextContent(/never change a commission decision/i);
  });
  it("says so when the models do not reconcile", async () => {
    server.use(http.get(`${G}/access`, () => caps()), http.get(A, () => HttpResponse.json(cmp({ reconciled: false }))));
    renderOps(<AttributionModelsPage />, { route: "/growth/attribution-models" }); expect(await screen.findByTestId("reconciled")).toHaveTextContent("No");
  });
  it("paths tab prints ordered source kinds only with the privacy line; the about tab lists all seven models", async () => {
    server.use(http.get(`${G}/access`, () => caps()), http.get(A, () => HttpResponse.json(cmp())), http.get(`${A}/paths`, () => HttpResponse.json({ market: "EG", from: "a", to: "b", k: 10, paths: [{ pathHash: "h1", length: 2, kinds: ["ORGANIC_SEARCH", "DIRECT"], conversions: 14 }], lengthDistribution: [{ length: 2, conversions: 14 }] })));
    renderOps(<AttributionModelsPage />, { route: "/growth/attribution-models" });
    await userEvent.click(await screen.findByTestId("am-tab-paths")); expect(await screen.findByTestId("paths-privacy")).toHaveTextContent(/10 or more conversions/);
    expect(screen.getByText("Organic search")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("am-tab-models")); const dl = await screen.findByTestId("models-glossary"); expect(dl.querySelectorAll("dt")).toHaveLength(7); expect(screen.getByTestId("models-windows")).toHaveTextContent(/30 days/);
  });
  it("lift lookup reports a suppressed result without a number", async () => {
    server.use(http.get(`${G}/access`, () => caps()), http.get(A, () => HttpResponse.json(cmp())), http.get(`${A}/lift`, () => HttpResponse.json({ experimentKey: "lc", available: false, reason: "K_FLOOR", message: "x" })));
    renderOps(<AttributionModelsPage />, { route: "/growth/attribution-models" }); await userEvent.type(await screen.findByTestId("lift-key"), "lc");
    expect(await screen.findByText(/Fewer than 10 units in an arm/)).toBeInTheDocument();
  });
  it("renders in Arabic (RTL page, Arabic labels)", async () => {
    server.use(http.get(`${G}/access`, () => caps()), http.get(A, () => HttpResponse.json(cmp())));
    renderOps(<AttributionModelsPage />, { route: "/growth/attribution-models", lang: "ar" });
    expect(await screen.findByTestId("models-table")).toBeInTheDocument(); expect(screen.getByTestId("col-POSITION_BASED")).toHaveTextContent("الافتراضي"); expect(screen.getByTestId("dd-status")).toHaveTextContent("الحجم غير كافٍ");
  });
  it("shows the error state with a retry", async () => {
    server.use(http.get(`${G}/access`, () => caps()), http.get(A, () => HttpResponse.json({ code: "INTERNAL", message: "x" }, { status: 500 })));
    renderOps(<AttributionModelsPage />, { route: "/growth/attribution-models" }); expect(await screen.findByRole("button", { name: /retry|try again/i })).toBeInTheDocument();
  });
});
