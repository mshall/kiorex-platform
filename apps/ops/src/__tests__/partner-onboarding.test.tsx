import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { Route, Routes } from "react-router-dom";
import { server } from "@/test/mocks/server";
import { renderOps } from "@/test/utils";
import PartnerOnboardingPage from "@/pages/PartnerOnboardingPage";
import PartnerOnboardingDetailPage from "@/pages/PartnerOnboardingDetailPage";

const B = "/api/v1/admin/onboarding/partners";
const auto = (state: string, code?: string, detail?: Record<string, unknown>) => ({ type: "AUTO", state, code, detail });
const detail = (o: Record<string, unknown> = {}) => ({
  id: "pc1", kind: "PHARMACY", orgRef: "org_1", name: "Al-Shifa Pharmacy", nameAr: "صيدلية الشفاء", market: "EG", status: "IN_REVIEW", progress: 57, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  requestedBy: null, approvedBy: null, rotationPending: false, readiness: {}, blockers: ["STEP_VERIFY_LICENCE"], humanActions: ["verify_licence", "fees"], checksRunAt: new Date().toISOString(),
  steps: [
    { key: "credentials", ...auto("DONE", "CREDENTIALS_PRESENT") }, { key: "handshake", ...auto("FAILED", "SIGNATURE_REJECTED") }, { key: "sync_dry_run", ...auto("DONE", "CATALOGUE_READY", { items: 12 }) },
    { key: "flags", ...auto("WARN", "AWAITING_GATE", { gates: [{ flag: "kiorex.pharmacy_orders", gateIds: [], satisfied: false }] }) }, { key: "market_pack", ...auto("DONE") }, { key: "duplicates", ...auto("DONE") }, { key: "documents", ...auto("DONE") },
    { key: "review_documents", type: "HUMAN", state: "ACTION", actor: "ops_admin" }, { key: "verify_licence", type: "HUMAN", state: "ACTION", actor: "ops_admin" }, { key: "fees", type: "HUMAN", state: "ACTION", actor: "ops_admin" },
    { key: "launch_gate", type: "HUMAN", state: "ACTION", actor: "super_admin", detail: { gates: [{ flag: "kiorex.pharmacy_orders", gateIds: [], satisfied: false }] } },
    { key: "approval", type: "HUMAN", state: "LOCKED", actor: "super_admin" }, { key: "go_live", type: "HUMAN", state: "LOCKED", actor: "ops_admin" },
  ], ...o,
});
const mount = (lang: "en" | "ar" = "en") => renderOps(<Routes><Route path="/partner-onboarding/:id" element={<PartnerOnboardingDetailPage />} /><Route path="/partner-onboarding" element={<PartnerOnboardingPage />} /></Routes>, { route: "/partner-onboarding/pc1", lang });

describe("partner onboarding console", () => {
  it("queue highlights what a person must do and shows progress", async () => {
    server.use(http.get(B, () => HttpResponse.json([{ id: "pc1", kind: "LAB", name: "Nile Lab", market: "EG", status: "IN_REVIEW", progress: 43, humanActions: ["verify_licence"], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }])));
    renderOps(<Routes><Route path="/partner-onboarding" element={<PartnerOnboardingPage />} /></Routes>, { route: "/partner-onboarding" });
    expect(await screen.findByText("Nile Lab")).toBeInTheDocument();
    expect(screen.getByTestId("pob-progress-pc1")).toHaveTextContent("43%");
    expect(screen.getByTestId("pob-human-flag")).toHaveTextContent("Verify licence");
  });
  it("wizard separates automated checks from highlighted human steps; failed checks show a localised reason; Go live stays locked", async () => {
    server.use(http.get(`${B}/pc1`, () => HttpResponse.json(detail())), http.get(`${B}/pc1/audit`, () => HttpResponse.json([])));
    mount();
    expect(await screen.findByTestId("human-banner")).toBeInTheDocument();
    expect(within(screen.getByTestId("step-handshake")).getByTestId("code-handshake")).toHaveTextContent("rejected our signature");
    const lic = screen.getByTestId("step-verify_licence"); expect(within(lic).getByTestId("action-needed")).toBeInTheDocument();
    expect(screen.getByTestId("step-launch_gate")).toHaveTextContent("never recorded by this wizard");
    expect(screen.getByTestId("blockers")).toBeInTheDocument();
    expect(screen.getByTestId("pob-progress")).toHaveAttribute("aria-valuenow", "57");
    expect(screen.queryByTestId("act-go-live")).not.toBeInTheDocument();
  });
  it("records the licence verification and re-runs the automated checks on demand", async () => {
    let lic: any; let reran = false;
    server.use(http.get(`${B}/pc1`, () => HttpResponse.json(detail())), http.get(`${B}/pc1/audit`, () => HttpResponse.json([])),
      http.post(`${B}/pc1/steps/verify_licence`, async ({ request }) => { lic = await request.json(); return HttpResponse.json(detail()); }),
      http.post(`${B}/pc1/run-checks`, () => { reran = true; return HttpResponse.json(detail()); }));
    mount();
    const btn = await screen.findByTestId("act-licence"); expect(btn).toBeDisabled();
    await userEvent.type(screen.getByTestId("licence-ref"), "EDA-12345"); await userEvent.click(btn);
    await waitFor(() => expect(lic).toEqual({ reference: "EDA-12345" }));
    await userEvent.click(screen.getByTestId("act-rerun")); await waitFor(() => expect(reran).toBe(true));
  });
  it("two-person rule: the requester cannot approve; Go live appears only when approved with no blockers", async () => {
    const steps = detail().steps.map((s: any) => (["handshake"].includes(s.key) ? { ...s, state: "DONE" } : s.type === "HUMAN" && s.key !== "approval" && s.key !== "go_live" ? { ...s, state: "DONE" } : s.key === "approval" ? { ...s, state: "ACTION" } : s));
    server.use(http.get(`${B}/pc1`, () => HttpResponse.json(detail({ status: "AWAITING_APPROVAL", requestedBy: "test-ops-1", steps, blockers: [], humanActions: ["approval"] }))), http.get(`${B}/pc1/audit`, () => HttpResponse.json([])));
    mount();
    expect(await screen.findByTestId("act-approve")).toBeDisabled(); expect(screen.getByTestId("two-person-note")).toBeInTheDocument();
  });
  it("go live is enabled once approved and renders RTL Arabic labels", async () => {
    const steps = detail().steps.map((s: any) => (s.key === "go_live" ? { ...s, state: "ACTION" } : s.key === "approval" ? { ...s, state: "DONE" } : s.type === "HUMAN" || s.state === "FAILED" ? { ...s, state: "DONE" } : s));
    let hit = false;
    server.use(http.get(`${B}/pc1`, () => HttpResponse.json(detail({ status: "APPROVED", steps, blockers: [], humanActions: ["go_live"], progress: 92 }))), http.get(`${B}/pc1/audit`, () => HttpResponse.json([])), http.post(`${B}/pc1/go-live`, () => { hit = true; return HttpResponse.json(detail({ status: "LIVE", steps, blockers: [], humanActions: [], progress: 100 })); }));
    mount("ar");
    const go = await screen.findByTestId("act-go-live"); expect(go).toBeEnabled(); expect(go.textContent).toBe("إطلاق");
    await userEvent.click(go); await waitFor(() => expect(hit).toBe(true));
  });
});
