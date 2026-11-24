import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "@/test/mocks/server";
import { renderOps } from "@/test/utils";
import AssistantWorkspace from "@/pages/growth/whatsapp/Tabs";
import whatsappI18n from "@/i18n/growth.whatsapp.json";

const G = "/api/v1/ops/growth"; const A = "/api/v1/admin/growth/assistant";
const access = (roles: string[]) => http.get(`${G}/access`, () => HttpResponse.json({ roles, capabilities: { read: true, readFinance: false, writeConfig: false, approveConfig: false, reviewFraud: false, manage: false, manageCampaigns: false } }));
const status = (o: Record<string, unknown> = {}) => ({ market: "EG", mode: "mock", model: "mock-rules-v1", policy: { source: "PROPOSED_DEFAULT", versionId: "abcdef1234", retentionDays: 30, escalationSlaMinutes: 30, model: { mode: "mock", providerLabel: "mock" } },
  flags: { assistant: { key: "kiorex.whatsapp_ai_assistant", effective: false, reason: "LAUNCH_LOCKED", blockedBy: null }, realModel: { key: "growth.assistant_real_model", effective: false, reason: "LAUNCH_LOCKED" } }, realModelConfigured: false,
  usageToday: { tokens: 1200, costMinor: 0, conversations: 4, breakerTripped: false }, budgets: { tokensPerTurn: 1500, tokensPerConversation: 8000, turnsPerConversation: 40, tokensPerSubjectDay: 30000, costPerMarketDayMinor: 200000 }, rateLimits: { messagesPerNumberPerHour: 30, globalConcurrency: 50 }, escalations: { open: 1, overdue: 1 }, ...o });
const flat = (o: unknown, p = ""): string[] => (o && typeof o === "object" ? Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => flat(v, p ? `${p}.${k}` : k)) : [p]);

describe("WhatsApp assistant i18n (GRW-P2-D)", () => {
  it("English and Arabic carry the same keys", () => {
    const en = new Set(flat(whatsappI18n.en)); const ar = new Set(flat(whatsappI18n.ar));
    expect([...en].filter((k) => !ar.has(k))).toEqual([]); expect([...ar].filter((k) => !en.has(k))).toEqual([]);
  });
});

describe("Assistant status tab", () => {
  it("shows the mock mode, the locked gates in words, no key value, and the safety statements that never change", async () => {
    server.use(access(["ops_admin"]), http.get(`${A}/status`, () => HttpResponse.json(status())));
    renderOps(<AssistantWorkspace section="assistant" initial="assistant" />, { route: "/growth/assistant" });
    expect(await screen.findByTestId("as-model")).toHaveTextContent(/mock/i);
    expect(screen.getByTestId("as-flag-assistant")).toHaveTextContent(/locked/i); expect(screen.getByTestId("as-flag-real")).toHaveTextContent(/locked/i);
    expect(screen.getByTestId("as-real-configured")).toHaveTextContent(/^No$/); expect(screen.getByTestId("as-escalations")).toHaveTextContent("1 open, 1 overdue");
    expect(within(screen.getByTestId("as-safety-list")).getAllByRole("listitem").length).toBeGreaterThanOrEqual(5);
    expect(document.body.textContent).not.toMatch(/sk-|Bearer|secret/i);
  });
  it("renders in Arabic with the page direction rules (RTL strings)", async () => {
    server.use(access(["ops_admin"]), http.get(`${A}/status`, () => HttpResponse.json(status())));
    renderOps(<AssistantWorkspace section="assistant" initial="assistant" />, { route: "/growth/assistant", lang: "ar" });
    expect(await screen.findByTestId("as-model")).toHaveTextContent("تجريبي");
  });
});

describe("Conversations tab", () => {
  const rows = [{ id: "s1", createdAt: "2027-01-02T10:00:00.000Z", state: "HANDOFF", language: "ar", turns: 5, tokens: 700, costMinor: 0, verified: true, escalated: true, escalationStatus: "OPEN", expiresAt: "2027-01-03T10:00:00.000Z" }];
  it("lists conversations without any phone number; support opens the redacted transcript", async () => {
    server.use(access(["ops_admin", "support"]), http.get(`${A}/conversations`, () => HttpResponse.json(rows)),
      http.get(`${A}/conversations/s1`, () => HttpResponse.json({ id: "s1", state: "HANDOFF", language: "ar", verified: true, createdAt: rows[0].createdAt, turns: [{ seq: 1, direction: "IN", text: "my name is [NAME_CLAIM]", template: null, outcome: "OK", at: rows[0].createdAt }, { seq: 1, direction: "OUT", text: "", template: "handoff", outcome: "HANDOFF", at: rows[0].createdAt }], toolCalls: [] })));
    renderOps(<AssistantWorkspace section="whatsapp" initial="conversations" />, { route: "/growth/whatsapp" });
    const cell = within(await screen.findByRole("table")).getByText("HANDOFF"); expect(document.body.textContent).not.toMatch(/\+20\d{8,}|01\d{9}/);
    await userEvent.click(cell);
    const t = await screen.findByTestId("conv-transcript"); expect(within(t).getByText(/NAME_CLAIM/)).toBeInTheDocument(); expect(within(t).getByText("handoff")).toBeInTheDocument();
  });
  it("finance (no support role) sees the list but cannot open a transcript", async () => {
    server.use(access(["ops_admin", "finance"]), http.get(`${A}/conversations`, () => HttpResponse.json(rows)));
    renderOps(<AssistantWorkspace section="whatsapp" initial="conversations" />, { route: "/growth/whatsapp" });
    await userEvent.click(within(await screen.findByRole("table")).getByText("HANDOFF")); expect(screen.queryByTestId("conv-transcript")).toBeNull(); expect(screen.getByTestId("conv-readonly")).toBeInTheDocument();
  });
});

describe("Escalations tab", () => {
  const esc = [{ id: "e1", sessionId: "s1", reason: "USER_REQUEST", status: "OPEN", ackBy: null, createdAt: "2027-01-02T10:00:00.000Z", slaDueAt: "2027-01-02T10:30:00.000Z", overdue: true, minutesLeft: -12, closedAt: null }];
  it("shows the SLA clock and lets support acknowledge and close", async () => {
    const calls: string[] = [];
    server.use(access(["ops_admin", "support"]), http.get(`${A}/escalations`, () => HttpResponse.json(esc)), http.post(`${A}/escalations/e1/ack`, () => { calls.push("ack"); return HttpResponse.json({ acked: true }); }), http.post(`${A}/escalations/e1/close`, () => { calls.push("close"); return HttpResponse.json({ closed: true }); }));
    renderOps(<AssistantWorkspace section="whatsapp" initial="escalations" />, { route: "/growth/whatsapp" });
    expect(await screen.findByTestId("esc-sla")).toHaveTextContent("12 min overdue");
    await userEvent.click(screen.getByTestId("esc-ack")); await waitFor(() => expect(calls).toContain("ack"));
    await userEvent.click(screen.getByTestId("esc-close")); await waitFor(() => expect(calls).toContain("close"));
  });
  it("a read-only role sees the queue and no actions", async () => {
    server.use(access(["ops_admin"]), http.get(`${A}/escalations`, () => HttpResponse.json(esc)));
    renderOps(<AssistantWorkspace section="whatsapp" initial="escalations" />, { route: "/growth/whatsapp" });
    await screen.findByTestId("esc-sla"); expect(screen.queryByTestId("esc-ack")).toBeNull(); expect(screen.queryByTestId("esc-close")).toBeNull();
  });
  it("an empty queue is an honest empty state", async () => {
    server.use(access(["ops_admin"]), http.get(`${A}/escalations`, () => HttpResponse.json([])));
    renderOps(<AssistantWorkspace section="whatsapp" initial="escalations" />, { route: "/growth/whatsapp" });
    expect(await screen.findByText(/No open escalations/)).toBeInTheDocument();
  });
});

describe("Budgets tab", () => {
  const budgets = { market: "EG", budgets: status().budgets, rateLimits: status().rateLimits, days: [{ day: "2027-01-02", tokens: 1200, costMinor: 150, conversations: 4, breakerTripped: false }] };
  it("shows the limits, hides metrics under k = 10 and offers the breaker reset to a super admin only when it tripped", async () => {
    let reset = false;
    server.use(access(["ops_admin", "super_admin"]), http.get(`${A}/budgets`, () => HttpResponse.json(budgets)), http.get(`${A}/status`, () => HttpResponse.json(status({ usageToday: { tokens: 9, costMinor: 200000, conversations: 3, breakerTripped: true } }))),
      http.get(`${A}/metrics`, () => HttpResponse.json({ masked: true, k: 10, sessions: null, containmentRate: null, handoffRate: null, bookingCompletionRate: null, costPerBookingMinor: null, p95LatencyMs: null })), http.post(`${A}/budgets/reset-breaker`, () => { reset = true; return HttpResponse.json({ reset: true }); }));
    renderOps(<AssistantWorkspace section="assistant" initial="budgets" />, { route: "/growth/assistant" });
    expect(await screen.findByTestId("bd-breaker")).toHaveTextContent(/tripped/i); expect(screen.getByTestId("bd-masked")).toHaveTextContent("10"); expect(within(screen.getByTestId("bd-limits")).getByText("8000")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("bd-reset")); await waitFor(() => expect(reset).toBe(true));
  });
  it("support cannot reset the breaker; real metrics show when k is met", async () => {
    server.use(access(["ops_admin", "support"]), http.get(`${A}/budgets`, () => HttpResponse.json(budgets)), http.get(`${A}/status`, () => HttpResponse.json(status({ usageToday: { tokens: 9, costMinor: 0, conversations: 30, breakerTripped: true } }))),
      http.get(`${A}/metrics`, () => HttpResponse.json({ masked: false, k: 10, sessions: 30, containmentRate: 0.8, handoffRate: 0.2, bookingCompletionRate: 0.5, costPerBookingMinor: 0, p95LatencyMs: 900 })));
    renderOps(<AssistantWorkspace section="assistant" initial="budgets" />, { route: "/growth/assistant" });
    expect(await screen.findByTestId("bd-containment")).toHaveTextContent("80%"); expect(screen.getByTestId("bd-p95")).toHaveTextContent("900 ms"); expect(screen.queryByTestId("bd-reset")).toBeNull();
  });
});
