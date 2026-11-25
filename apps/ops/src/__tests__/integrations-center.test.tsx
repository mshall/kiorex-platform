import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "@/test/mocks/server";
import { renderOps } from "@/test/utils";
import IntegrationsCenterPage from "@/pages/IntegrationsCenterPage";
import i18nJson from "@/i18n/integrationsCenter.json";

const B = "/api/v1/admin/integrations-center";
const SECRET = "sk_live_NEVER_SHOWN_123456789";
const flat = (o: unknown, p = ""): string[] => (o && typeof o === "object" ? Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => flat(v, p ? `${p}.${k}` : k)) : [p]);
const violations = async () => (await axe.run(document.body, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] }, rules: { "color-contrast": { enabled: false }, region: { enabled: false } } })).violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`);

const row = (o: Record<string, unknown> = {}) => ({ key: "SMS", group: "messaging", label: { en: "SMS", ar: "الرسائل النصية" }, owner: "kiorex", observable: true, mode: "mock", approvedMode: "mock", drift: "NONE", secretRefSet: false, ready: true, problems: [],
  env: [{ name: "SMS_MODE", required: true, set: false }, { name: "SMS_API_KEY", required: true, set: false }], circuit: null, lastRun: null, lastCheck: null, webhook: { path: "/api/v1/messaging/webhooks/sms", url: "https://api.kiorex.example/api/v1/messaging/webhooks/sms", verifyTokenEnv: null, verifyTokenSet: null, secretEnv: "SMS_WEBHOOK_SECRET", secretSet: false, note: null },
  growthKind: null, testSend: "SMS", runbook: "INTEGRATION_RUNBOOK_MESSAGING.md#sms", needsHuman: ["NH-SMS"], note: null, ...o });
const overview = (manage: boolean, rows: unknown[] = [row()], extra: Record<string, unknown> = {}) => ({ generatedAt: "2026-11-25T10:00:00Z", market: "EG", canManage: manage, summary: { total: rows.length, real: 0, mock: rows.length, unobservable: 0, drift: 0, notReady: 0 }, approvedModes: {}, pendingProposal: null, integrations: rows,
  rules: { secrets: "", switching: "", checks: "" }, ...extra });

describe("integrations center i18n", () => {
  it("English and Arabic carry the same keys", () => {
    const en = new Set(flat(i18nJson.en)); const ar = new Set(flat(i18nJson.ar));
    expect([...en].filter((k) => !ar.has(k))).toEqual([]); expect([...ar].filter((k) => !en.has(k))).toEqual([]);
  });
});

describe("Integrations Control Center page", () => {
  it("shows mode, approval, drift, credential presence, circuit, last check, webhook, variable names and the runbook; never a value", async () => {
    server.use(http.get(B, () => HttpResponse.json(overview(false, [
      row(), row({ key: "WHATSAPP_CLOUD", label: { en: "WhatsApp Cloud API", ar: "واتساب كلاود" }, mode: "real", approvedMode: "mock", drift: "REAL_NOT_APPROVED", secretRefSet: true, ready: false, problems: ["WHATSAPP_VERIFY_TOKEN is required when WHATSAPP_PROVIDER=meta"],
        circuit: { state: "OPEN", consecutiveFailures: 5, lastOkAt: null, lastErrorAt: null, source: "analytics pull" }, lastCheck: { at: "2026-11-25T09:00:00Z", ok: false, detail: "x", by: "adm_a" },
        webhook: { path: "/api/v1/messaging/webhooks/whatsapp", url: null, verifyTokenEnv: "WHATSAPP_VERIFY_TOKEN", verifyTokenSet: false, secretEnv: "WHATSAPP_WEBHOOK_SECRET", secretSet: true, note: null }, runbook: "INTEGRATION_RUNBOOK_MESSAGING.md#whatsapp" }),
    ]))));
    renderOps(<IntegrationsCenterPage />, { route: "/integrations" });
    expect(await screen.findByTestId("ic-mode-SMS")).toHaveTextContent(/mock/i);
    expect(screen.getByTestId("ic-mode-WHATSAPP_CLOUD")).toHaveTextContent(/real/i);
    expect(screen.getByTestId("ic-drift-WHATSAPP_CLOUD")).toHaveTextContent(/not approved/i);
    expect(screen.getByTestId("ic-secret-WHATSAPP_CLOUD")).toHaveTextContent(/^Set$/i); expect(screen.getByTestId("ic-secret-SMS")).toHaveTextContent(/not set/i);
    expect(screen.getByTestId("ic-ready-WHATSAPP_CLOUD")).toHaveTextContent(/not ready/i);
    expect(screen.getByTestId("ic-circuit-WHATSAPP_CLOUD")).toHaveTextContent("OPEN"); expect(screen.getByTestId("ic-circuit-SMS")).toHaveTextContent(/not tracked/i);
    expect(screen.getByTestId("ic-lastcheck-SMS")).toHaveTextContent(/never checked/i); expect(screen.getByTestId("ic-lastcheck-WHATSAPP_CLOUD")).toHaveTextContent(/failed/i);
    expect(screen.getByTestId("ic-webhook-WHATSAPP_CLOUD")).toHaveTextContent("WHATSAPP_VERIFY_TOKEN"); expect(screen.getByTestId("ic-runbook-WHATSAPP_CLOUD")).toHaveTextContent("INTEGRATION_RUNBOOK_MESSAGING.md#whatsapp");
    expect(screen.getByText(/WHATSAPP_VERIFY_TOKEN is required/)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(SECRET);
    expect(screen.getByTestId("ic-readonly")).toBeInTheDocument();
    expect(screen.queryByTestId("ic-check-SMS")).toBeNull(); expect(screen.queryByTestId("ic-propose-SMS")).toBeNull(); expect(screen.queryByTestId("ic-testsend-SMS")).toBeNull();
  });
  it("a super admin runs a check, sends a mock test message and proposes a mode change that waits for a second person", async () => {
    let checked = false; let sent: unknown = null; let proposed: unknown = null;
    server.use(http.get(B, () => HttpResponse.json(overview(true))),
      http.post(`${B}/SMS/check`, () => { checked = true; return HttpResponse.json({ key: "SMS", ok: true, mode: "mock", detail: "MOCK_OK", checkedAt: "x" }); }),
      http.post(`${B}/SMS/test-send`, async ({ request }) => { sent = await request.json(); return HttpResponse.json({ key: "SMS", ok: true, mode: "mock", providerRef: "mock_sms_1", error: null, to: "+2010****01" }); }),
      http.post(`${B}/SMS/propose-mode`, async ({ request }) => { proposed = await request.json(); return HttpResponse.json({ id: "cfg_1", status: "PENDING_APPROVAL", key: "SMS", mode: "real" }); }));
    renderOps(<IntegrationsCenterPage />, { route: "/integrations" });
    await userEvent.click(await screen.findByTestId("ic-check-SMS")); await waitFor(() => expect(checked).toBe(true));
    await userEvent.click(screen.getByTestId("ic-testsend-SMS")); await userEvent.type(screen.getByLabelText(/test recipient/i), "+201000000001"); await userEvent.click(screen.getByTestId("ic-send-SMS"));
    await waitFor(() => expect(sent).toEqual({ to: "+201000000001" }));
    await userEvent.click(screen.getByTestId("ic-propose-SMS")); expect(screen.getByTestId("ic-submit-SMS")).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/reason/i), "Pilot go-live on 1 December"); await userEvent.click(screen.getByTestId("ic-submit-SMS"));
    await waitFor(() => expect(proposed).toEqual({ mode: "real", reason: "Pilot go-live on 1 December" }));
  });
  it("a real integration offers no test send; a pending proposal is announced with a link to the console", async () => {
    server.use(http.get(B, () => HttpResponse.json(overview(true, [row({ mode: "real", ready: true })], { pendingProposal: { id: "c1", status: "PENDING_APPROVAL", modes: { SMS: "real" }, createdBy: "adm_a", createdAt: "x" } }))));
    renderOps(<IntegrationsCenterPage />, { route: "/integrations" });
    expect(await screen.findByTestId("ic-pending")).toHaveTextContent("SMS → real"); expect(screen.queryByTestId("ic-testsend-SMS")).toBeNull();
    expect(within(screen.getByTestId("ic-pending")).getByRole("link")).toHaveAttribute("href", "/growth/config");
  });
  it("renders in Arabic, right to left, with no axe violations", async () => {
    server.use(http.get(B, () => HttpResponse.json(overview(true, [row(), row({ key: "OBJECT_STORAGE", group: "platform", label: { en: "Object storage", ar: "تخزين الملفات" }, mode: null, observable: false, owner: "clinic", env: [], webhook: null, testSend: null })]))));
    renderOps(<IntegrationsCenterPage />, { route: "/integrations", lang: "ar" });
    expect(await screen.findByRole("heading", { name: /مركز التحكم في التكاملات/ })).toBeInTheDocument();
    expect(await screen.findByTestId("ic-mode-SMS")).toHaveTextContent("تجريبي"); expect(screen.getByTestId("ic-mode-OBJECT_STORAGE")).toHaveTextContent("غير معروف هنا");
    expect(await violations()).toEqual([]);
  });
});
