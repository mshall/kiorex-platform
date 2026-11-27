import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { Route, Routes } from "react-router-dom";
import { server } from "@/test/mocks/server";
import { renderOps } from "@/test/utils";
import KiorlyMarketsPage from "@/pages/KiorlyMarketsPage";
import ar from "@/i18n/kiorlyMarkets.json";
import { actionsFor, applyCountry, changeBody, emptyForm, errorCode, validateChange, validateForm, validTimezone } from "@/lib/kiorlyMarketsLogic";

const B = "/api/v1/admin/kiorly-markets";
const ready = (o: Record<string, unknown> = {}) => ({ taxPack: { ok: true, invoiceVatPercent: 14, saasVatPercent: 14, defaultVisitFee: 300 }, crossBorder: { required: false, approved: true }, hostCellKnown: true, commercialConfigured: false, blockers: [], canLaunch: true, ...o });
const market = (o: Record<string, unknown> = {}) => ({ id: "m_eg", code: "EG", nameEn: "Egypt", nameAr: "مصر", status: "LIVE", operationalStatus: "ACTIVE", operability: "active", pausedUntil: null, launchedAt: "2026-11-01T00:00:00Z", dataRegion: "eu-central-1", hostCell: "frankfurt", defaultCurrency: "EGP", defaultTimezone: "Africa/Cairo", defaultLocale: "ar-EG", defaultPhoneRegion: "EG", crossBorderApprovalRef: "PDPC-1", crossBorderExpiresAt: null, requireSecondApprover: false, organizationCount: 3, readiness: ready({ crossBorder: { required: true, approved: true } }), kiorex: { known: true, live: false, state: "AWAITING_GATE", flag: "market.eg.live" }, ...o });
const draft = market({ id: "m_sa", code: "SA", nameEn: "Saudi Arabia", nameAr: "السعودية", status: "DRAFT", operability: "draft", organizationCount: 0, kiorex: { known: false, live: false, state: "NOT_CONFIGURED", flag: null }, readiness: ready({ taxPack: { ok: false }, blockers: [{ code: "TAX_PACK_MISSING", message: "Tax pack missing" }], canLaunch: false }) });
const defaults = [{ code: "SA", nameEn: "Saudi Arabia", nameAr: "السعودية", defaultCurrency: "SAR", defaultTimezone: "Asia/Riyadh", defaultLocale: "ar-SA", defaultPhoneRegion: "SA", weekendDays: [5, 6], enabledLanguages: ["ar", "en"] }];
const mount = (lang: "en" | "ar" = "en") => renderOps(<Routes><Route path="/kiorly-markets" element={<KiorlyMarketsPage />} /></Routes>, { route: "/kiorly-markets", lang });
const list = (items: unknown[], canChange = true) => http.get(B, () => HttpResponse.json({ items, canChange }));

describe("Kiorly admin: Market launch screen", () => {
  it("lists the markets with state, operability, prerequisites and the read-only Kiorex state of the same country", async () => {
    server.use(list([market(), draft]));
    mount();
    expect(await screen.findByTestId("market-EG")).toBeInTheDocument();
    expect(screen.getByTestId("state-EG")).toHaveTextContent("Live");
    expect(screen.getByTestId("op-EG")).toHaveTextContent("Active");
    expect(screen.getByTestId("state-SA")).toHaveTextContent("Draft");
    expect(screen.getByTestId("kiorex-EG")).toHaveTextContent(/awaiting gate/i);
    expect(screen.getByTestId("kiorex-EG")).toHaveTextContent(/read-only/i);
    expect(screen.getByTestId("kiorex-SA")).toHaveTextContent(/no kiorex market/i);
    expect(screen.getByTestId("prereq-SA")).toHaveTextContent(/tax pack missing/i);
    expect(screen.getByTestId("prereq-SA")).toHaveTextContent(/not ready/i);
    expect(screen.getByTestId("prereq-EG")).toHaveTextContent("PDPC-1");
    // no control on the Kiorex state: it is only displayed
    expect(within(screen.getByTestId("kiorex-EG")).queryByRole("button")).toBeNull();
  });

  it("offers the right actions per state, and none to a read-only viewer (Kiorly ops)", async () => {
    server.use(list([market(), draft, market({ id: "m_ae", code: "AE", operability: "paused", operationalStatus: "PAUSED" })], true));
    mount();
    await screen.findByTestId("market-EG");
    expect(screen.getByTestId("pause-EG")).toBeInTheDocument();
    expect(screen.getByTestId("disable-EG")).toBeInTheDocument();
    expect(screen.getByTestId("launch-SA")).toBeInTheDocument();
    expect(screen.getByTestId("enable-AE")).toBeInTheDocument();
    expect(screen.queryByTestId("launch-EG")).toBeNull();
    expect(screen.getByTestId("new-market")).toBeInTheDocument();
  });

  it("read-only for Kiorly ops: no change buttons, no create button, and a clear note; details and history stay available", async () => {
    server.use(list([market(), draft], false));
    mount();
    await screen.findByTestId("market-EG");
    expect(screen.getByTestId("read-only-note")).toBeInTheDocument();
    for (const id of ["pause-EG", "disable-EG", "launch-SA", "new-market"]) expect(screen.queryByTestId(id)).toBeNull();
    expect(screen.getByTestId("details-EG")).toBeInTheDocument();
  });

  it("Go live needs a reason and shows the API error in the dialog (EN), then closes and refreshes on success", async () => {
    let calls = 0; const bodies: unknown[] = [];
    server.use(list([draft]), http.post(`${B}/m_sa/launch`, async ({ request }) => {
      calls++; bodies.push(await request.json());
      return calls === 1 ? HttpResponse.json({ code: "TAX_PACK_MISSING", message: "x" }, { status: 400 }) : HttpResponse.json({ ...draft, status: "LIVE" });
    }));
    mount(); const user = userEvent.setup();
    await user.click(await screen.findByTestId("launch-SA"));
    await user.click(await screen.findByTestId("action-confirm"));
    expect(await screen.findByTestId("action-error")).toHaveTextContent(/at least 3 characters/i);
    expect(calls).toBe(0);
    await user.type(screen.getByLabelText(/reason/i), "Counsel approved");
    await user.type(screen.getByLabelText(/approval reference/i), "DOC-1");
    await user.click(screen.getByTestId("action-confirm"));
    expect(await screen.findByTestId("action-error")).toHaveTextContent(/tax pack is missing/i);
    expect(bodies[0]).toEqual({ reason: "Counsel approved", approvalRef: "DOC-1" });
    await user.click(screen.getByTestId("action-confirm"));
    await waitFor(() => expect(screen.queryByTestId("action-launch")).toBeNull());
    expect(await screen.findByTestId("page-note")).toBeInTheDocument();
  });

  it("an unreachable Clinic is a clear message, never a hang", async () => {
    server.use(list([draft]), http.post(`${B}/m_sa/launch`, () => HttpResponse.json({ code: "CLINIC_UNAVAILABLE", message: "down" }, { status: 503 })));
    mount(); const user = userEvent.setup();
    await user.click(await screen.findByTestId("launch-SA"));
    await user.type(screen.getByLabelText(/reason/i), "Go ahead please");
    await user.click(screen.getByTestId("action-confirm"));
    expect(await screen.findByTestId("action-error")).toHaveTextContent(/not reachable/i);
  });

  it("double click sends one request", async () => {
    let calls = 0;
    server.use(list([draft]), http.post(`${B}/m_sa/launch`, async () => { calls++; await new Promise((r) => setTimeout(r, 150)); return HttpResponse.json({ ...draft, status: "LIVE" }); }));
    mount(); const user = userEvent.setup();
    await user.click(await screen.findByTestId("launch-SA"));
    await user.type(screen.getByLabelText(/reason/i), "Counsel approved");
    const btn = screen.getByTestId("action-confirm");
    await user.dblClick(btn);
    await waitFor(() => expect(screen.queryByTestId("action-launch")).toBeNull());
    expect(calls).toBe(1);
  });

  it("Pause validates the number of days (1 to 365) before any request", async () => {
    let calls = 0;
    server.use(list([market()]), http.post(`${B}/m_eg/pause`, async () => { calls++; return HttpResponse.json(market({ operability: "paused" })); }));
    mount(); const user = userEvent.setup();
    await user.click(await screen.findByTestId("pause-EG"));
    await user.type(screen.getByLabelText(/reason/i), "Partner outage");
    for (const bad of ["0", "366", "1.5", "abc", "-4", ""]) {
      const days = screen.getByLabelText(/days/i); await user.clear(days); if (bad) await user.type(days, bad);
      await user.click(screen.getByTestId("action-confirm"));
      expect(await screen.findByTestId("action-error"), bad).toHaveTextContent(/whole number of days/i);
    }
    expect(calls).toBe(0);
    const days = screen.getByLabelText(/days/i); await user.clear(days); await user.type(days, "365");
    await user.click(screen.getByTestId("action-confirm"));
    await waitFor(() => expect(calls).toBe(1));
  });

  it("with the second-approver rule on, the dialog says so and the answer 'pending' is shown as a request, not as done", async () => {
    server.use(list([market({ requireSecondApprover: true })]), http.post(`${B}/m_eg/disable`, () => HttpResponse.json({ pending: true, requestId: "r1" })));
    mount(); const user = userEvent.setup();
    await user.click(await screen.findByTestId("disable-EG"));
    expect(screen.getByText(/second approver is required/i)).toBeInTheDocument();
    await user.type(screen.getByLabelText(/reason/i), "Regulator question");
    await user.click(screen.getByTestId("action-confirm"));
    expect(await screen.findByTestId("page-note")).toHaveTextContent(/different administrator must approve/i);
  });

  it("Initiate country launch fills currency, timezone, locale, phone region, weekend and languages from the country and sends them all", async () => {
    let body: Record<string, unknown> = {};
    server.use(list([]), http.get(`${B}/country-defaults`, () => HttpResponse.json(defaults)), http.post(B, async ({ request }) => { body = (await request.json()) as Record<string, unknown>; return HttpResponse.json(draft, { status: 201 }); }));
    mount(); const user = userEvent.setup();
    expect(await screen.findByTestId("markets-empty")).toBeInTheDocument();
    await user.click(screen.getByTestId("new-market"));
    await user.click(screen.getByTestId("create-save"));
    expect(await screen.findAllByRole("alert")).not.toHaveLength(0); // validation, no request
    expect(body).toEqual({});
    await user.selectOptions(await screen.findByLabelText(/^country/i), "SA");
    expect(screen.getByLabelText(/^currency/i)).toHaveValue("SAR");
    expect(screen.getByLabelText(/^timezone/i)).toHaveValue("Asia/Riyadh");
    expect(screen.getByLabelText(/^locale/i)).toHaveValue("ar-SA");
    expect(screen.getByLabelText(/^phone region/i)).toHaveValue("SA");
    await user.click(screen.getByTestId("create-save"));
    await waitFor(() => expect(body.code).toBe("SA"));
    expect(body).toMatchObject({ defaultCurrency: "SAR", defaultTimezone: "Asia/Riyadh", defaultLocale: "ar-SA", defaultPhoneRegion: "SA", weekendDays: [5, 6], enabledLanguages: ["ar", "en"], hostCell: "frankfurt" });
  });

  it("a refused creation shows the translated reason in the dialog (duplicate country)", async () => {
    server.use(list([]), http.get(`${B}/country-defaults`, () => HttpResponse.json(defaults)), http.post(B, () => HttpResponse.json({ code: "MARKET_EXISTS", message: "exists" }, { status: 409 })));
    mount(); const user = userEvent.setup();
    await user.click(await screen.findByTestId("new-market"));
    await user.selectOptions(await screen.findByLabelText(/^country/i), "SA");
    await user.click(screen.getByTestId("create-save"));
    expect(await screen.findByTestId("create-error")).toHaveTextContent(/already exists/i);
  });

  it("history lists the audit rows with actor, reason and approval, and pages with a large list", async () => {
    const row = (n: number) => ({ id: `a${n}`, action: "LAUNCH", fromStatus: "DRAFT", toStatus: "LIVE", fromOperational: null, toOperational: "ACTIVE", actorId: "kiorly-admin:u1", actorEmail: "ops@example.com", actorSource: "KIORLY_ADMIN", reason: n === 0 ? "<img src=x onerror=alert(1)> مرحبا" : `change ${n}`, approvalRef: "DOC-9", approvalLink: "https://docs.example.org/9", secondApproverId: null, createdAt: "2026-11-27T10:00:00Z" });
    server.use(list([market()]), http.get(`${B}/m_eg`, () => HttpResponse.json({ market: market(), legal: { config: {}, crossBorderRequired: true, launchApproved: true, daysUntilExpiry: 30 }, commercial: { source: "featureDefaults" } })), http.get(`${B}/m_eg/change-requests`, () => HttpResponse.json([])),
      http.get(`${B}/m_eg/audit`, ({ request }) => { const before = new URL(request.url).searchParams.get("before"); return before ? HttpResponse.json({ items: [row(26), row(27)], nextBefore: null }) : HttpResponse.json({ items: Array.from({ length: 25 }, (_, n) => row(n)), nextBefore: "2026-11-27T09:00:00Z" }); }));
    mount(); const user = userEvent.setup();
    await user.click(await screen.findByTestId("details-EG"));
    expect(await screen.findAllByTestId("history-row")).toHaveLength(25);
    // hostile text is shown as text, never as markup
    expect(screen.getAllByTestId("history-row")[0]).toHaveTextContent("<img src=x onerror=alert(1)>");
    expect(document.querySelector("img[src='x']")).toBeNull();
    expect(screen.getAllByTestId("history-row")[0]).toHaveTextContent("ops@example.com");
    expect(screen.getAllByTestId("history-row")[0]).toHaveTextContent("DOC-9");
    await user.click(screen.getByRole("button", { name: /load more/i }));
    await waitFor(() => expect(screen.getAllByTestId("history-row")).toHaveLength(27));
    expect(screen.getByTestId("details-kiorex")).toHaveTextContent(/awaiting gate/i);
  });

  it("Arabic: the screen renders in Arabic with RTL-safe text and Arabic error messages", async () => {
    server.use(list([market(), draft]), http.post(`${B}/m_sa/launch`, () => HttpResponse.json({ code: "TAX_PACK_MISSING", message: "x" }, { status: 400 })));
    mount("ar"); const user = userEvent.setup();
    expect(await screen.findByRole("heading", { name: ar.ar.kiorlyMarkets.title })).toBeInTheDocument();
    expect(await screen.findByTestId("state-EG")).toHaveTextContent(ar.ar.kiorlyMarkets.status.LIVE);
    await user.click(screen.getByTestId("launch-SA"));
    await user.click(screen.getByTestId("action-confirm"));
    expect(await screen.findByTestId("action-error")).toHaveTextContent(ar.ar.kiorlyMarkets.errors.REASON_REQUIRED);
    expect(document.documentElement.dir).toBe("rtl");
  });

  it("loading failure is an error state with retry, not an empty page", async () => {
    server.use(http.get(B, () => HttpResponse.json({ code: "CLINIC_UNAVAILABLE", message: "down" }, { status: 503 })));
    mount();
    expect(await screen.findByTestId("error-state")).toBeInTheDocument();
  });

  it("a large list (200 markets) renders", async () => {
    server.use(list(Array.from({ length: 200 }, (_, n) => market({ id: `m${n}`, code: `C${n}`, nameEn: `Country ${n}` }))));
    mount();
    expect(await screen.findByTestId("market-C199")).toBeInTheDocument();
  });
});

describe("Market launch logic", () => {
  it("applies country defaults and validates", () => {
    expect(validateForm(emptyForm()).code).toBe(true);
    const f = applyCountry(emptyForm(), "SA", defaults);
    expect(validateForm(f)).toEqual({});
    expect(applyCountry(f, "", defaults).code).toBe("");
    expect(validateForm({ ...f, defaultTimezone: "Mars/Base" }).timezone).toBe(true);
    expect(validTimezone("Africa/Cairo")).toBe(true);
    expect(validateForm({ ...f, weekendDays: [0, 1, 2, 3] }).weekend).toBe(true);
    expect(validateForm({ ...f, nameEn: "x".repeat(201) }).nameEn).toBe(true);
  });
  it("change input boundaries", () => {
    const ok = { reason: "abc", approvalRef: "", approvalLink: "", days: "7" };
    expect(validateChange("launch", { ...ok, reason: "ab" })).toBe("REASON_REQUIRED");
    expect(validateChange("launch", { ...ok, reason: "x".repeat(1001) })).toBe("REASON_TOO_LONG");
    expect(validateChange("launch", { ...ok, approvalLink: "http://x.example" })).toBe("APPROVAL_LINK_INVALID");
    expect(validateChange("launch", { ...ok, approvalLink: "javascript:alert(1)" })).toBe("APPROVAL_LINK_INVALID");
    expect(validateChange("pause", { ...ok, days: "0" })).toBe("PAUSE_DAYS_INVALID");
    expect(validateChange("pause", { ...ok, days: "365" })).toBeNull();
    expect(validateChange("disable", { ...ok, days: "junk" })).toBeNull();
    expect(changeBody("pause", { ...ok, approvalRef: " R " })).toEqual({ reason: "abc", approvalRef: "R", days: 7 });
  });
  it("actions per state and role", () => {
    expect(actionsFor({ status: "DRAFT", operability: "draft" }, true)).toEqual(["launch"]);
    expect(actionsFor({ status: "LIVE", operability: "active" }, true)).toEqual(["pause", "disable"]);
    expect(actionsFor({ status: "LIVE", operability: "disabled" }, true)).toEqual(["enable"]);
    expect(actionsFor({ status: "SUNSET", operability: "sunset" }, true)).toEqual([]);
    expect(actionsFor({ status: "LIVE", operability: "active" }, false)).toEqual([]);
    expect(errorCode({ code: "X" })).toBe("X");
    expect(errorCode(null)).toBeNull();
  });
});
