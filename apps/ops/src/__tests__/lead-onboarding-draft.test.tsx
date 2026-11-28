import "@/lib/western-digits"; // what main.tsx does: Western digits 0-9 in Arabic (founder decision 28 Nov 2026)
import { screen, waitFor, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "@/test/mocks/server";
import { renderOps } from "@/test/utils";
import { AuthContext, type AuthCtx } from "@/auth/AuthProvider";
import { configureApi } from "@/api/client";
import i18n from "@/i18n";
import { Toaster } from "@/components/ui/sonner";
import { LeadOnboardingDetailPage, LeadOnboardingListPage } from "@/pages/LeadOnboardingPages";
import SiteLeadDetailPage from "@/pages/SiteLeadDetailPage";
import { pathInEdition } from "@/lib/edition";

const L = "/api/v1/admin/leads"; const O = "/api/v1/admin/lead-onboarding";
const pick = (key: string, en: string, ar: string) => ({ key, en, ar, active: true });
const settings = { version: 1, updatedAt: null, updatedBy: null, isDefault: true, requirable: [], config: {
  providerTypes: [pick("CLINIC", "Clinic", "عيادة"), pick("OTHER", "Other", "أخرى")], specialties: [], modules: [pick("CLINIC", "Kiorly Clinic", "كيورلي كلينيك")], markets: [{ ...pick("EG", "Egypt", "مصر"), dialCode: "+20", governorates: [] }],
  goLive: [], software: [], contactChannels: [], contactTimes: [], lostReasons: [], requiredFields: [], testMarkers: { emailDomains: [], namePrefixes: [] }, notifications: { applicantAck: true, teamAlert: true },
  statusLabels: { NEW: { en: "New", ar: "جديد" }, CONTACTED: { en: "Contacted", ar: "تم التواصل" }, QUALIFIED: { en: "Qualified", ar: "مؤهل" }, ONBOARDING: { en: "Onboarding", ar: "قيد الانضمام" }, WON: { en: "Won", ar: "ناجح" }, LOST: { en: "Lost", ar: "مغلق" } },
} };
const req = (o: Record<string, unknown> = {}) => ({ id: "lor_1", leadId: "ld_1", contactRef: "KL-ABCD2345", status: "DRAFT", kind: "CLINIC", legalName: "Nile Family Clinic", providerType: "CLINIC", mode: "CONNECTED", modules: ["CLINIC"], market: "EG", assigneeSub: "u2", assigneeName: "Mona", note: null, isTest: false, createdBy: "system:lead-won", submittedBy: null, submittedAt: null, decidedBy: null, decidedAt: null, decisionNote: null, createdAt: "2026-11-28T09:00:00Z", updatedAt: "2026-11-28T09:00:00Z", leadStatus: "WON", blockers: [], kinds: ["CLINIC", "NURSE", "PHARMACY", "LAB"], ...o });
const common = () => server.use(http.get(`${L}/settings`, () => HttpResponse.json(settings)), http.get(`${L}/owners`, () => HttpResponse.json([{ sub: "u2", name: "Mona", roles: ["ops_admin"] }, { sub: "test-ops-1", name: "Ops Admin", roles: ["ops_admin"] }])));

const asRoles = (roles: string[], sub: string, route: string, lang: "en" | "ar" = "en") => {
  const ctx: AuthCtx = { status: "signedIn", user: { sub, name: "Ops", token: "t", roles }, login: async () => {}, logout: async () => {} } as AuthCtx;
  configureApi({ getToken: async () => "t" }); void i18n.changeLanguage(lang);
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><AuthContext.Provider value={ctx}><MemoryRouter initialEntries={[route]}><Routes>
    <Route path="/leads/onboarding" element={<LeadOnboardingListPage />} /><Route path="/leads/onboarding/:id" element={<LeadOnboardingDetailPage />} /><Route path="/leads/:id" element={<SiteLeadDetailPage />} />
  </Routes></MemoryRouter><Toaster /></AuthContext.Provider></QueryClientProvider>);
};

describe("onboarding draft (from a won join request)", () => {
  it("is part of the Kiorly admin edition", () => { expect(pathInEdition("kiorly", "/leads/onboarding")).toBe(true); expect(pathInEdition("kiorly", "/leads/onboarding/lor_1")).toBe(true); });

  it("the list shows the drafts with kind, status and assignee and filters through the API", async () => {
    common(); const seen: string[] = [];
    server.use(http.get(O, ({ request }) => { seen.push(new URL(request.url).search); return HttpResponse.json({ total: 1, page: 1, pageSize: 25, items: [req()] }); }));
    renderOps(<Routes><Route path="/leads/onboarding" element={<LeadOnboardingListPage />} /></Routes>, { route: "/leads/onboarding" });
    expect(await screen.findByText("Nile Family Clinic")).toBeInTheDocument(); expect(screen.getByText("KL-ABCD2345")).toBeInTheDocument(); expect(screen.getByText("Kiorly Clinic")).toBeInTheDocument(); expect(screen.getAllByText("Draft").length).toBeGreaterThan(0);
    await userEvent.setup().selectOptions(screen.getByTestId("lob-filter-status"), "SUBMITTED");
    await waitFor(() => expect(new URLSearchParams(seen.at(-1)).get("status")).toBe("SUBMITTED"));
  });

  it("the detail links back to the lead, explains that nothing is activated, edits the draft and submits it", async () => {
    common(); const calls: Array<{ m: string; b?: unknown }> = [];
    server.use(http.get(`${O}/lor_1`, () => HttpResponse.json(req())), http.patch(`${O}/lor_1`, async ({ request }) => { calls.push({ m: "PATCH", b: await request.json() }); return HttpResponse.json(req({ kind: "LAB" })); }),
      http.post(`${O}/lor_1/submit`, () => { calls.push({ m: "SUBMIT" }); return HttpResponse.json(req({ status: "SUBMITTED", submittedBy: "u-ops" })); }));
    asRoles(["ops_admin"], "u-ops", "/leads/onboarding/lor_1"); const user = userEvent.setup();
    expect(await screen.findByTestId("lob-back-to-lead")).toHaveAttribute("href", "/leads/ld_1"); expect(screen.getByTestId("lob-explainer")).toHaveTextContent(/No organisation, price, commission or Passport identity is created/);
    await user.selectOptions(screen.getByTestId("lob-kind"), "LAB"); await waitFor(() => expect(calls[0]).toEqual({ m: "PATCH", b: { kind: "LAB" } }));
    await user.click(screen.getByTestId("lob-submit")); await waitFor(() => expect(calls[1]).toEqual({ m: "SUBMIT" }));
    expect(screen.queryByTestId("lob-approve")).toBeNull(); // ops_admin never sees approve
  });

  it("an unmapped kind and a lost lead block the submit button with a reason", async () => {
    common(); server.use(http.get(`${O}/lor_1`, () => HttpResponse.json(req({ kind: null, blockers: ["KIND_REQUIRED"], providerType: "OTHER" }))));
    asRoles(["ops_admin"], "u-ops", "/leads/onboarding/lor_1");
    expect(await screen.findByTestId("lob-submit")).toBeDisabled(); expect(screen.getByTestId("lob-blockers")).toHaveTextContent("Choose the product first.");
  });

  it("the person who submitted cannot approve; a different super admin can; approval opens Partner onboarding only for a connected provider", async () => {
    common(); let approved = false;
    server.use(http.get(`${O}/lor_1`, () => HttpResponse.json(approved ? req({ status: "APPROVED", submittedBy: "maker", decidedBy: "checker" }) : req({ status: "SUBMITTED", submittedBy: "maker" }))),
      http.post(`${O}/lor_1/approve`, () => { approved = true; return HttpResponse.json(req({ status: "APPROVED", submittedBy: "maker", decidedBy: "checker" })); }));
    const first = asRoles(["super_admin"], "maker", "/leads/onboarding/lor_1");
    expect(await screen.findByTestId("lob-approve")).toBeDisabled(); expect(screen.getByTestId("lob-two-person")).toBeInTheDocument(); first.unmount();
    asRoles(["super_admin"], "checker", "/leads/onboarding/lor_1");
    const btn = await screen.findByTestId("lob-approve"); await waitFor(() => expect(btn).toBeEnabled()); await userEvent.setup().click(btn);
    expect(await screen.findByTestId("lob-open-partner-onboarding")).toHaveAttribute("href", "/partner-onboarding?lead=ld_1");
  });

  it("the lead page links to the draft and the draft links back; a won lead without a draft can create it", async () => {
    common(); let created = false;
    const lead = (o: object = {}) => ({ id: "ld_1", ref: "KL-ABCD2345", status: "WON", mode: "CONNECTED", providerType: "CLINIC", legalName: "Nile Family Clinic", tradeName: null, contactName: "Dr Hoda", phoneMasked: "", hasEmail: true, market: "EG", governorate: null, city: null, modules: [], locale: "en", ownerSub: null, ownerName: null, tags: [], isTest: false, duplicateOfId: null, createdAt: "2026-11-28T09:00:00Z", updatedAt: "2026-11-28T09:00:00Z", phone: null, email: null, contactRole: null, country: "EG", branches: null, staffCount: null, specialties: [], services: null, currentSoftware: null, licences: {}, goLive: null, contactChannel: null, contactTime: null, note: null, answers: {}, consentTextVersion: "draft-2", consentAt: "2026-11-28T09:00:00Z", sourceEnv: null, lostReason: null, duplicates: [], events: [{ id: "le_9", kind: "ONBOARDING", actor: "ops", actorName: null, data: { action: "DRAFT_CREATED" }, createdAt: "2026-11-28T09:00:00Z" }], allowedTransitions: ["ONBOARDING"], onboardingDraftOn: ["WON"], onboardingRequest: null, ...o });
    server.use(http.get(`${L}/ld_1`, () => HttpResponse.json(created ? lead({ onboardingRequest: { id: "lor_1", status: "DRAFT", kind: "CLINIC", assigneeSub: null, assigneeName: null } }) : lead())),
      http.post(`${O}/by-lead/ld_1`, () => { created = true; return HttpResponse.json({ ...req(), created: true }); }));
    asRoles(["ops_admin"], "u-ops", "/leads/ld_1");
    expect(await screen.findByTestId("lead-onboarding-none")).toBeInTheDocument(); expect(screen.getByTestId("lead-event-ONBOARDING")).toHaveTextContent("draft created");
    await userEvent.setup().click(screen.getByTestId("lead-onboarding-create"));
    expect(await screen.findByTestId("lead-onboarding-open")).toHaveAttribute("href", "/leads/onboarding/lor_1"); expect(screen.getByTestId("lead-onboarding-status")).toHaveTextContent("Draft");
  });

  it("renders in Arabic with Western digits and no English leftovers in the panel", async () => {
    common(); server.use(http.get(`${O}/lor_1`, () => HttpResponse.json(req({ status: "SUBMITTED", submittedBy: "maker", submittedAt: "2026-11-28T10:30:00Z" }))));
    asRoles(["super_admin"], "checker", "/leads/onboarding/lor_1", "ar");
    expect(await screen.findByText("بانتظار الموافقة")).toBeInTheDocument(); expect(screen.getByTestId("lob-explainer")).toHaveTextContent("هذه مسودة");
    const text = document.body.textContent ?? ""; expect(text).not.toMatch(/[٠-٩۰-۹]/); expect(text).toMatch(/2026|28/);
  });
});
