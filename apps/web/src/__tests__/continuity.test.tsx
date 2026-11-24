import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "@/test/mocks/server";
import { renderApp } from "@/test/utils";
import { ContinuityCards, cardTarget } from "@/components/continuity/ContinuityCards";
import { currentCard, rememberCard, clearCard, CONTINUITY_HEADER } from "@/api/continuity";
import { api } from "@/api/client";
import en from "@/i18n/continuity.en.json";
import ar from "@/i18n/continuity.ar.json";

const B = "/api/v1/growth/v1/continuity";
const card = (o: Record<string, unknown> = {}) => ({ id: "ep_abcdefghij", kind: "RX_TO_PHARMACY", toProduct: "PHARMACY", expiresAt: "2027-03-01T00:00:00Z", recordId: "kx_rec_1", path: "/pharmacy", ...o });
const cards = (list: unknown[], o: Record<string, unknown> = {}) => HttpResponse.json({ enabled: true, consent: false, cards: list, ...o });
const flat = (o: unknown, p = ""): string[] => (o && typeof o === "object" ? Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => flat(v, p ? `${p}.${k}` : k)) : [p]);
const Where = () => { const l = useLocation(); return <p data-testid="where">{l.pathname}{l.search}</p>; };
const page = (lang: "ar" | "en" = "en") => renderApp(<Routes><Route path="/" element={<ContinuityCards />} /><Route path="*" element={<Where />} /></Routes>, { lang });

beforeEach(() => { try { sessionStorage.clear(); localStorage.clear(); } catch { /* */ } });

describe("continuity strings (GRW-P4-A)", () => {
  it("English and Arabic carry the same keys", () => { expect(flat(en).sort()).toEqual(flat(ar).sort()); });
  it("the copy never names a condition, a drug, a test or a reward", () => {
    expect(JSON.stringify(en)).not.toMatch(/diagnos|symptom|cancer|diabet|antibiotic|blood count|discount|coupon/i);
    expect(en.consent.help).toMatch(/never earns a reward/); expect(ar.consent.help).toMatch(/لا يمنحك مكافأة/);
  });
});

describe("ContinuityCards", () => {
  it("renders nothing when the package is OFF or locked (the home page is exactly as before), on a 403, and on an outage", async () => {
    for (const r of [() => HttpResponse.json({ enabled: false, consent: false, cards: [] }), () => HttpResponse.json({ code: "FEATURE_DISABLED" }, { status: 403 }), () => HttpResponse.json({ code: "X" }, { status: 500 })]) {
      server.use(http.get(`${B}/cards`, r)); const { container, unmount } = page();
      await waitFor(() => expect(container.querySelector("[data-testid='continuity-cards']")).toBeNull()); await new Promise((x) => setTimeout(x, 30)); expect(container.textContent).toBe(""); unmount();
    }
  });
  it("shows the pharmacy card in English with the exact product copy, a 44 px dismiss target and an off-by-default connect switch", async () => {
    server.use(http.get(`${B}/cards`, () => cards([card()])));
    page("en");
    expect(await screen.findByRole("heading", { name: "Send your prescription to a pharmacy" })).toBeInTheDocument();
    const sw = screen.getByRole("switch", { name: "Keep my visit and this order connected" }); expect(sw).toHaveAttribute("aria-checked", "false");
    expect(screen.getByTestId("continuity-draft")).toHaveTextContent("pending legal review");
    expect(screen.getByTestId("continuity-dismiss-rx").className).toMatch(/h-11/); expect(screen.getByTestId("continuity-dismiss-rx")).toHaveAccessibleName(/Hide this card: Send your prescription to a pharmacy/);
    expect(document.body.textContent).not.toMatch(/amoxicillin|paracetamol|enc_|kx_rec/i);
  });
  it("renders in Arabic (RTL-safe logical spacing) with the Arabic copy", async () => {
    server.use(http.get(`${B}/cards`, () => cards([card({ id: "ep_labbbbbbbb", kind: "LAB_ORDER_TO_LAB", toProduct: "LAB", path: "/lab", recordId: undefined })])));
    page("ar");
    expect(await screen.findByRole("heading", { name: "احجز تحليلك" })).toBeInTheDocument();
    expect(screen.getByTestId("continuity-dismiss-lab").className).toMatch(/end-1/);
  });
  it("opening a card remembers it for 30 minutes in this tab, navigates to the existing flow (the pharmacy one with the patient's own prescription chosen) and sends the consent only when the switch changed", async () => {
    let put: unknown = null;
    server.use(http.get(`${B}/cards`, () => cards([card()])), http.put(`${B}/consent`, async ({ request }) => { put = await request.json(); return HttpResponse.json({ granted: true }); }));
    page("en");
    await userEvent.click(await screen.findByTestId("continuity-open-rx"));
    expect(await screen.findByTestId("where")).toHaveTextContent("/pharmacy?rx=kx_rec_1"); expect(currentCard()).toBe("ep_abcdefghij"); expect(put).toBeNull(); // the switch was untouched
  });
  it("turning the switch on then opening saves the consent (web source) before the flow starts", async () => {
    let put: unknown = null;
    server.use(http.get(`${B}/cards`, () => cards([card()])), http.put(`${B}/consent`, async ({ request }) => { put = await request.json(); return HttpResponse.json({ granted: true }); }));
    page("en");
    await userEvent.click(await screen.findByRole("switch")); await userEvent.click(screen.getByTestId("continuity-open-rx"));
    await waitFor(() => expect(put).toEqual({ granted: true, source: "web" }));
  });
  it("a dismissed card is hidden through the API and a withdrawn state is shown as not connected", async () => {
    let dismissed = ""; let list = [card()];
    server.use(http.get(`${B}/cards`, () => cards(list, { consent: true })), http.post(`${B}/cards/:id/dismiss`, ({ params }) => { dismissed = String(params.id); list = []; return HttpResponse.json({ dismissed: true }); }));
    page("en");
    expect(await screen.findByRole("switch")).toHaveAttribute("aria-checked", "true"); expect(screen.queryByTestId("continuity-draft")).toBeNull();
    await userEvent.click(screen.getByTestId("continuity-dismiss-rx"));
    await waitFor(() => expect(dismissed).toBe("ep_abcdefghij")); await waitFor(() => expect(screen.queryByTestId("continuity-cards")).toBeNull());
  });
  it("is a labelled list of articles-free cards with a heading per card, names for every control and no positive tabindex (the axe run is in e2e/continuity.spec.ts)", async () => {
    server.use(http.get(`${B}/cards`, () => cards([card(), card({ id: "ep_homeeeeeee", kind: "CARE_PLAN_TO_HOME_VISIT", toProduct: "NURSE", path: "/care-plans", recordId: undefined })])));
    const { container } = page("en"); await screen.findByTestId("continuity-card-home");
    expect(screen.getByRole("list", { name: "Continue your care" })).toBeInTheDocument(); expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(2);
    for (const el of screen.getAllByRole("button")) expect(el).toHaveAccessibleName(/\S/);
    for (const el of screen.getAllByRole("switch")) expect(el).toHaveAccessibleName("Keep my visit and this order connected");
    expect(container.querySelector("[tabindex]:not([tabindex='0']):not([tabindex='-1'])")).toBeNull();
  });
});

describe("the card id travels only on the three requests the patient makes", () => {
  it("cardTarget and the storage window", () => {
    expect(cardTarget(card() as never)).toBe("/pharmacy?rx=kx_rec_1"); expect(cardTarget(card({ kind: "LAB_ORDER_TO_LAB", path: "/lab", recordId: undefined }) as never)).toBe("/lab");
    rememberCard("ep_abcdefghij", 1_000); expect(currentCard(1_000 + 29 * 60_000)).toBe("ep_abcdefghij"); expect(currentCard(1_000 + 31 * 60_000)).toBeNull();
    sessionStorage.setItem("kx-continuity", JSON.stringify({ id: "bad id!", at: Date.now() })); expect(currentCard()).toBeNull(); clearCard();
  });
  it("the header is added to the pharmacy order, lab booking and care-plan request, and to nothing else", async () => {
    const seen: Record<string, string | null> = {};
    server.use(
      http.post("/api/v1/pharmacy/orders", ({ request }) => { seen.order = request.headers.get(CONTINUITY_HEADER); return HttpResponse.json({ id: "o" }); }),
      http.post("/api/v1/lab/bookings", ({ request }) => { seen.lab = request.headers.get(CONTINUITY_HEADER); return HttpResponse.json({ id: "l" }); }),
      http.post("/api/v1/care-plans", ({ request }) => { seen.plan = request.headers.get(CONTINUITY_HEADER); return HttpResponse.json({ id: "p" }); }),
      http.post("/api/v1/me/consents/REMINDERS", ({ request }) => { seen.other = request.headers.get(CONTINUITY_HEADER); return HttpResponse.json({}); }),
    );
    rememberCard("ep_abcdefghij");
    await api.POST("/api/v1/pharmacy/orders" as never, { body: {} } as never); await api.POST("/api/v1/lab/bookings" as never, { body: {} } as never); await api.POST("/api/v1/care-plans" as never, { body: {} } as never); await api.PUT("/api/v1/me/consents/REMINDERS" as never, { body: {} } as never).catch(() => undefined);
    expect(seen).toMatchObject({ order: "ep_abcdefghij", lab: "ep_abcdefghij", plan: "ep_abcdefghij" }); expect(seen.other ?? null).toBeNull();
  });
});
