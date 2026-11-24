import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "@/test/mocks/server";
import { renderOps } from "@/test/utils";
import CrossProductRoutePage from "@/pages/growth/cross-product/Page";
import i18nJson from "@/i18n/growth.crossProduct.json";

const F = "/api/v1/ops/growth/cross-product/funnel";
const flat = (o: unknown, p = ""): string[] => (o && typeof o === "object" ? Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => flat(v, p ? `${p}.${k}` : k)) : [p]);
const row = (entryPoint: string, product: string, o: Record<string, unknown> = {}) => ({ product, entryPoint, offered: 40, dismissed: 12, continued: 20, notContinued: 8, bySourceOfFirstBooking: { PROVIDER_LED: "<10", MARKETPLACE: 20, UNATTRIBUTED: "<10" }, timeToContinue: { LT_24H: 14, D1_3: "<10", D3_7: 0, GT_7D: 0 }, ...o });
const funnel = (o: Record<string, unknown> = {}) => ({ days: 30, market: "EG", enabled: true, clinicVisitsCompleted: 120, products: [row("RX_TO_PHARMACY", "PHARMACY"), row("LAB_ORDER_TO_LAB", "LAB", { offered: "<10", continued: "<10", notContinued: "<10" }), row("CARE_PLAN_TO_HOME_VISIT", "NURSE", { offered: 0, dismissed: 0, continued: 0, notContinued: 0 })], rewards: "NONE", commissionLink: "INERT", ...o });

describe("cross-product i18n", () => {
  it("English and Arabic carry the same keys, and the rules never promise a reward", () => {
    expect(flat(i18nJson.en).sort()).toEqual(flat(i18nJson.ar).sort());
    expect(JSON.stringify(i18nJson.en)).toMatch(/No reward and no referral qualification/);
  });
});

describe("Cross-product journeys page (GRW-P4-A)", () => {
  it("overview: status, visits, no rewards, inert commission link, the rules and the NEEDS_HUMAN note", async () => {
    server.use(http.get(F, () => HttpResponse.json(funnel())));
    renderOps(<CrossProductRoutePage />, { route: "/growth/cross-product" });
    expect(await screen.findByTestId("cp-status")).toHaveTextContent("Effective");
    expect(screen.getByTestId("cp-visits")).toHaveTextContent("120"); expect(screen.getByTestId("cp-rewards")).toHaveTextContent("None"); expect(screen.getByTestId("cp-commission")).toHaveTextContent("Inert");
    expect(screen.getByTestId("cp-rules").querySelectorAll("li")).toHaveLength(5);
    expect(screen.getByTestId("cp-needs-human")).toHaveTextContent(/NEEDS_HUMAN/);
  });
  it("funnel: masked cells read <10 and nothing identifies a person, a clinic or a specialty", async () => {
    server.use(http.get(F, () => HttpResponse.json(funnel())));
    renderOps(<CrossProductRoutePage />, { route: "/growth/cross-product" });
    await userEvent.click(await screen.findByRole("tab", { name: "Funnel" }));
    expect(await screen.findByTestId("cp-RX_TO_PHARMACY-offered")).toHaveTextContent("40");
    expect(screen.getByTestId("cp-LAB_ORDER_TO_LAB-offered")).toHaveTextContent("<10"); expect(screen.getByTestId("cp-LAB_ORDER_TO_LAB-notContinued")).toHaveTextContent("<10");
    expect(screen.getByTestId("cp-RX_TO_PHARMACY-src-PROVIDER_LED")).toHaveTextContent("<10"); expect(screen.getByTestId("cp-RX_TO_PHARMACY-src-MARKETPLACE")).toHaveTextContent("20");
    expect(screen.getByTestId("cp-RX_TO_PHARMACY-lag-LT_24H")).toHaveTextContent("14");
    const t = within(screen.getByTestId("cp-funnel")).getAllByRole("table")[0]!; expect(t.querySelector("caption")).toHaveTextContent(/Funnel from prompt/);
    expect(screen.getByTestId("cp-k-note")).toHaveTextContent(/under 10/);
    expect(document.body.textContent).not.toMatch(/specialt|cl_1|kx_|sub_/i);
  });
  it("renders in Arabic with Arabic-Indic digits and right-to-left tables", async () => {
    server.use(http.get(F, () => HttpResponse.json(funnel())));
    renderOps(<CrossProductRoutePage />, { route: "/growth/cross-product", lang: "ar" });
    expect(await screen.findByTestId("cp-visits")).toHaveTextContent("١٢٠");
    await userEvent.click(screen.getByRole("tab", { name: "القمع" }));
    expect(await screen.findByTestId("cp-RX_TO_PHARMACY-offered")).toHaveTextContent("٤٠");
    expect(screen.getAllByText("من الوصفة إلى الصيدلية").length).toBeGreaterThanOrEqual(1);
  });
  it("shows Off when the package is not effective, an error with retry on failure and a skeleton while loading", async () => {
    server.use(http.get(F, () => HttpResponse.json(funnel({ enabled: false }))));
    const a = renderOps(<CrossProductRoutePage />, { route: "/growth/cross-product" });
    expect(await screen.findByTestId("cp-status")).toHaveTextContent("Off or awaiting gate"); a.unmount();
    server.use(http.get(F, () => HttpResponse.json({ code: "X" }, { status: 500 })));
    renderOps(<CrossProductRoutePage />, { route: "/growth/cross-product" });
    await waitFor(() => expect(screen.getByRole("button", { name: /retry|try again/i })).toBeInTheDocument());
  });
});
