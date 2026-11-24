/* eslint-disable @typescript-eslint/no-explicit-any -- loosely typed fixtures and the import console wire shape (resolution tasks carry arbitrary context) */
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { Route, Routes } from "react-router-dom";
import { server } from "@/test/mocks/server";
import { renderOps } from "@/test/utils";
import OnboardingBatchPage from "@/pages/OnboardingBatchPage";

const B = "/api/v1/admin/onboarding/imports";
const batch = (o: Record<string, unknown> = {}) => ({ id: "b1", orgId: "org_1", orgName: "Al-Noor", status: "NEEDS_REVIEW", createdBy: "someone", requestedBy: null, createdAt: new Date().toISOString(), files: [], summary: { classification: [{ table: "tbl_patients", entity: "patients", score: 0.7, rows: 15 }], mappings: { patients: [{ field: "phone", column: "mobile", confidence: 1 }] }, stats: { rows: { patients: 13 }, blockers: 2, warnings: 1, tasksOpen: 3, filesMatched: 10, filesTotal: 20, mergedPatients: 0 } }, ...o });
const dup = { id: "t1", key: "dup:1001,1008", type: "DUPLICATE_PATIENT", severity: "BLOCKER", status: "OPEN", actions: ["MERGE", "KEEP_BOTH", "SKIP_ROW"], context: { members: [{ sourceKey: "1001", name: "أحمد م••• ح•••", phone: "•••••••5678" }, { sourceKey: "1008", name: "أحمد م••• ح•••", phone: "•••••••5678" }] }, suggestion: { keep: "1001" } };
const phone = { id: "t2", key: "val:patients:1004:phone", type: "INVALID_VALUE", severity: "BLOCKER", status: "OPEN", actions: ["EDIT_VALUE", "SKIP_ROW"], context: { field: "phone", rowRef: "1004", value: "012345" } };
const mount = (lang: "en" | "ar" = "en") => renderOps(<Routes><Route path="/onboarding/:id" element={<OnboardingBatchPage />} /></Routes>, { route: "/onboarding/b1", lang });

function mocks(tasks: unknown[], b = batch(), resolved: unknown[] = []) {
  server.use(
    http.get(`${B}/b1`, () => HttpResponse.json(b)),
    http.get(`${B}/b1/tasks`, () => HttpResponse.json({ total: tasks.length, page: 1, pageSize: 25, counts: [], items: tasks })),
    http.get(`${B}/b1/dry-run`, () => HttpResponse.json({ batchId: "b1", status: b.status, reportHash: "h1", canCommit: b.status === "READY", willCreate: { patients: 13, appointments: 3, visits: 4, billing: 2, documents: 14 }, filesToAttach: 14, mergedPatients: 1, skippedFiles: 1, openBlockers: 2, openWarnings: 1, ignoredWithReason: 0, targetMode: "mock", taskBreakdown: [] })),
    http.get(`${B}/b1/audit`, () => HttpResponse.json([])),
  );
  void resolved;
}

describe("organization onboarding console", () => {
  it("shows blockers with context and suggested fix; merge sends the kept record", async () => {
    mocks([dup, phone]); let body: any;
    server.use(http.post(`${B}/b1/tasks/t1/resolve`, async ({ request }) => { body = await request.json(); return HttpResponse.json({ ok: true, open: 1 }); }));
    mount();
    expect(await screen.findByTestId("task-DUPLICATE_PATIENT")).toBeInTheDocument();
    expect(screen.getByTestId("onb-tiles")).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole("radio")[1]); await userEvent.click(screen.getByTestId("act-merge"));
    await waitFor(() => expect(body).toEqual({ action: "MERGE", params: { keep: "1008" } }));
  });
  it("edit value is prefilled with nothing, and ignoring needs a reason", async () => {
    mocks([phone, { id: "t3", key: "x", type: "TABLE_UNCLASSIFIED", severity: "WARNING", status: "OPEN", actions: ["MAP_TABLE", "IGNORE"], ref: { table: "cities" }, context: { table: "cities", columns: ["id", "nm"], rows: 2 } }]); let body: any;
    server.use(http.post(`${B}/b1/tasks/t2/resolve`, async ({ request }) => { body = await request.json(); return HttpResponse.json({ ok: true, open: 0 }); }));
    mount();
    await userEvent.type(await screen.findByTestId("task-value"), "01099990000"); await userEvent.click(screen.getByTestId("act-edit"));
    await waitFor(() => expect(body).toMatchObject({ action: "EDIT_VALUE", params: { value: "01099990000" } }));
    expect(screen.getByTestId("act-ignore")).toBeDisabled();
    await userEvent.type(screen.getByTestId("ignore-reason"), "lookup table"); expect(screen.getByTestId("act-ignore")).toBeEnabled();
  });
  it("two-person rule: the requester cannot approve their own import", async () => {
    mocks([], batch({ status: "AWAITING_APPROVAL", requestedBy: "test-ops-1", createdBy: "test-ops-1" })); // renderOps signs in as test-ops-1 (super_admin)
    mount(); await userEvent.click(await screen.findByTestId("tab-commit"));
    expect(await screen.findByTestId("act-approve")).toBeDisabled(); expect(screen.getByTestId("two-person-note")).toBeInTheDocument();
  });
  it("another super admin can approve, then commit shows after approval; Arabic renders RTL labels", async () => {
    mocks([], batch({ status: "AWAITING_APPROVAL", requestedBy: "other", createdBy: "other2" })); let hit: any;
    server.use(http.post(`${B}/b1/approve`, async ({ request }) => { hit = await request.json(); return HttpResponse.json({ ok: true }); }));
    mount("ar"); await userEvent.click(await screen.findByTestId("tab-commit"));
    const btn = await screen.findByTestId("act-approve"); expect(btn).toBeEnabled(); expect(btn.textContent).toBe("موافقة");
    await userEvent.click(btn); await waitFor(() => expect(hit).toEqual({ reportHash: "h1" }));
  });
});
