import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { Route, Routes } from "react-router-dom";
import { server } from "@/test/mocks/server";
import { renderOps } from "@/test/utils";
import PartnerLeadsPage from "@/pages/PartnerLeadsPage";
import { OpsLayout } from "@/components/OpsLayout";

const B = "/api/v1/admin/partner-leads";
const lead = (o: Record<string, unknown> = {}) => ({ id: "pl_1", kind: "CLINIC", orgRef: "org1", orgName: "Nile Clinic", contactName: "Dr Hoda", contactRole: "Owner", phone: "+201000000001", email: null, preferredTime: "MORNING", note: "After 10", locale: "en", market: "EG", consentAt: new Date().toISOString(), status: "NEW", assignee: null, notes: [], connectionId: null, connectionStatus: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...o });
const funnel = { days: 30, talkToUs: 4, stages: [{ stage: "interested", count: 10, fromPrevious: null, fromInterested: null }, { stage: "started", count: 5, fromPrevious: 50, fromInterested: 50 }, { stage: "submitted", count: 2, fromPrevious: 40, fromInterested: 20 }, { stage: "live", count: 1, fromPrevious: 50, fromInterested: 10 }], byKind: {} };
const mount = () => renderOps(<Routes><Route path="/partner-leads" element={<PartnerLeadsPage />} /></Routes>, { route: "/partner-leads" });

describe("partner leads page", () => {
  it("shows the funnel counts with conversion and the lead list", async () => {
    server.use(http.get(`${B}/funnel`, () => HttpResponse.json(funnel)), http.get(B, () => HttpResponse.json([lead()])));
    mount();
    expect(await screen.findByTestId("funnel-count-interested")).toHaveTextContent("10");
    expect(screen.getByTestId("funnel-count-live")).toHaveTextContent("1");
    expect(screen.getByTestId("funnel-started")).toHaveTextContent("50%");
    expect(await screen.findByText("Nile Clinic")).toBeInTheDocument();
  });
  it("changes status and assignee, adds a note, and links to the onboarding request when it exists", async () => {
    const patches: unknown[] = []; const notes: unknown[] = [];
    server.use(http.get(`${B}/funnel`, () => HttpResponse.json(funnel)), http.get(B, () => HttpResponse.json([lead({ connectionId: "pc_9", status: "SUBMITTED" })])),
      http.patch(`${B}/pl_1`, async ({ request }) => { patches.push(await request.json()); return HttpResponse.json(lead()); }),
      http.post(`${B}/pl_1/notes`, async ({ request }) => { notes.push(await request.json()); return HttpResponse.json(lead()); }));
    mount(); const user = userEvent.setup();
    await user.click(await screen.findByTestId("lead-open-pl_1"));
    expect(await screen.findByTestId("lead-conn-pl_1")).toHaveAttribute("href", "/partner-onboarding/pc_9");
    await user.selectOptions(screen.getByTestId("lead-status-pl_1"), "CONTACTED");
    await waitFor(() => expect(patches).toContainEqual({ status: "CONTACTED" }));
    await user.type(screen.getByTestId("lead-assignee-pl_1"), "sara"); await user.click(screen.getByRole("button", { name: "Assign" }));
    await waitFor(() => expect(patches).toContainEqual({ assignee: "sara" }));
    await user.type(screen.getByTestId("lead-note-pl_1"), "Called"); await user.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(notes).toContainEqual({ text: "Called" }));
  });
  it("filters by status through the query string", async () => {
    let seen = ""; server.use(http.get(`${B}/funnel`, () => HttpResponse.json(funnel)), http.get(B, ({ request }) => { seen = new URL(request.url).search; return HttpResponse.json([]); }));
    mount(); const user = userEvent.setup();
    await user.selectOptions(await screen.findByTestId("leads-filter-status"), "LIVE");
    await waitFor(() => expect(seen).toContain("status=LIVE"));
    expect(await screen.findByText("No leads yet")).toBeInTheDocument();
  });
});

const settings = (o: Record<string, unknown> = {}) => ({ enabled: true, channels: ["EMAIL", "WHATSAPP", "PUSH"], availableChannels: ["EMAIL", "WHATSAPP", "PUSH"], recipients: [
  { sub: "test-ops-1", name: "Ops Admin", roles: ["super_admin"], leadAlerts: true, channels: ["WHATSAPP", "PUSH"], hasPhone: true, hasEmail: false, lastSeenAt: "2026-11-24T10:00:00Z" },
  { sub: "ops-2", name: "Sara Ops", roles: ["ops_admin"], leadAlerts: true, channels: ["EMAIL"], hasPhone: false, hasEmail: false, lastSeenAt: "2026-11-23T10:00:00Z" }], ...o });

describe("lead alerts", () => {
  it("shows an unread badge on the Partner leads nav entry and hides it at zero", async () => {
    server.use(http.get(`${B}/unread`, () => HttpResponse.json({ count: 3 })));
    renderOps(<Routes><Route element={<OpsLayout />}><Route path="/x" element={<p>x</p>} /></Route></Routes>, { route: "/x" });
    const badges = await screen.findAllByTestId("nav-leads-badge"); expect(badges[0]).toHaveTextContent("3"); expect(badges[0]).toHaveAccessibleName("3 new leads");
  });
  it("opening the page marks leads as seen", async () => {
    let seen = 0; server.use(http.get(`${B}/funnel`, () => HttpResponse.json(funnel)), http.get(B, () => HttpResponse.json([])), http.get(`${B}/alerts`, () => HttpResponse.json(settings())), http.post(`${B}/seen`, () => { seen++; return HttpResponse.json({ count: 0 }); }));
    mount(); await waitFor(() => expect(seen).toBeGreaterThan(0));
  });
  it("a super admin changes the global switch, a channel and another person; the change is sent to the API", async () => {
    const sent: Array<[string, unknown]> = [];
    server.use(http.get(`${B}/funnel`, () => HttpResponse.json(funnel)), http.get(B, () => HttpResponse.json([])), http.post(`${B}/seen`, () => HttpResponse.json({ count: 0 })), http.get(`${B}/alerts`, () => HttpResponse.json(settings())),
      http.patch(`${B}/alerts`, async ({ request }) => { sent.push(["config", await request.json()]); return HttpResponse.json(settings()); }),
      http.patch(`${B}/alerts/recipients/ops-2`, async ({ request }) => { sent.push(["ops-2", await request.json()]); return HttpResponse.json({}); }));
    mount(); const user = userEvent.setup();
    await user.click(await screen.findByText("Alert settings"));
    await user.click(await screen.findByTestId("alerts-enabled")); await waitFor(() => expect(sent).toContainEqual(["config", { enabled: false }]));
    await user.click(screen.getByTestId("alerts-channel-EMAIL")); await waitFor(() => expect(sent).toContainEqual(["config", { channels: ["WHATSAPP", "PUSH"] }]));
    await user.click(screen.getByTestId("alerts-optin-ops-2")); await waitFor(() => expect(sent).toContainEqual(["ops-2", { leadAlerts: false }]));
    expect(screen.getByText("Sara Ops")).toBeInTheDocument(); expect(screen.getByText(/No phone or e-mail on file/)).toBeInTheDocument();
  });
});
