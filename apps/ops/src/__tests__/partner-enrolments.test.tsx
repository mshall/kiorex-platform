/* eslint-disable @typescript-eslint/no-explicit-any -- loosely typed fixtures and the import console wire shape (resolution tasks carry arbitrary context) */
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { Route, Routes } from "react-router-dom";
import { server } from "@/test/mocks/server";
import { renderOps } from "@/test/utils";
import PartnerOnboardingPage from "@/pages/PartnerOnboardingPage";

const E = "/api/v1/admin/onboarding/enrolments";
const row = (o: Record<string, unknown> = {}) => ({ id: "kxe_AAAAAAAA", kind: "PHARMACY", orgRef: null, label: "Nile Pharmacy", status: "ACTIVE", expiresAt: new Date(Date.now() + 86_400_000).toISOString(), createdBy: "ops", usedAt: null, createdAt: new Date().toISOString(), ...o });
const mount = () => renderOps(<Routes><Route path="/partner-onboarding" element={<PartnerOnboardingPage />} /></Routes>, { route: "/partner-onboarding" });

describe("enrolment codes panel", () => {
  it("creates a code, shows it once with a copy button, and the list never contains the code", async () => {
    let created: any; const rows = [row({ id: "kxe_OLDOLDOL", label: "Old", status: "USED" })];
    server.use(http.get("/api/v1/admin/onboarding/partners", () => HttpResponse.json([])), http.get(E, () => HttpResponse.json(rows)),
      http.post(E, async ({ request }) => { created = await request.json(); rows.unshift(row()); return HttpResponse.json({ ...row(), code: "kxe_AAAAAAAA.SECRETSECRETSECRETSECRETSECRETSECRETSEC", shownOnce: true }, { status: 201 }); }));
    mount(); const user = userEvent.setup();
    expect(await screen.findByTestId("pob-enrolments")).toBeInTheDocument();
    await user.type(screen.getByTestId("enrol-label"), "Nile Pharmacy"); await user.click(screen.getByTestId("enrol-create"));
    expect(await screen.findByTestId("enrol-code")).toHaveTextContent(/^kxe_AAAAAAAA\./);
    expect(created).toMatchObject({ kind: "PHARMACY", label: "Nile Pharmacy", ttlHours: 168 });
    expect(screen.getByTestId("enrol-once")).toHaveTextContent(/will not be shown again/i);
    expect(await screen.findByTestId("enrol-row-kxe_AAAAAAAA")).not.toHaveTextContent("SECRET");
  });
  it("revokes an active code; used codes have no revoke action", async () => {
    let revoked = ""; const rows = [row(), row({ id: "kxe_USEDUSED", status: "USED" })];
    server.use(http.get("/api/v1/admin/onboarding/partners", () => HttpResponse.json([])), http.get(E, () => HttpResponse.json(rows)), http.delete(`${E}/:id`, ({ params }) => { revoked = String(params.id); return HttpResponse.json(row({ status: "REVOKED" })); }));
    mount(); const user = userEvent.setup();
    await user.click(await screen.findByTestId("enrol-revoke-kxe_AAAAAAAA"));
    await waitFor(() => expect(revoked).toBe("kxe_AAAAAAAA"));
    expect(screen.queryByTestId("enrol-revoke-kxe_USEDUSED")).toBeNull();
  });
});
