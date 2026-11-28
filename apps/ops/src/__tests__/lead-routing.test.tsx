import "@/lib/western-digits";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "@/test/mocks/server";
import { AuthContext, type AuthCtx } from "@/auth/AuthProvider";
import { configureApi } from "@/api/client";
import i18n from "@/i18n";
import { Toaster } from "@/components/ui/sonner";
import SiteLeadsPage from "@/pages/SiteLeadsPage";
import SiteLeadDetailPage from "@/pages/SiteLeadDetailPage";
import LeadRoutingPage from "@/pages/LeadRoutingPage";
import { LeadOnboardingDetailPage } from "@/pages/LeadOnboardingPages";
import { pathInEdition } from "@/lib/edition";

const L = "/api/v1/admin/leads"; const O = "/api/v1/admin/lead-onboarding";
const pick = (key: string, en: string, ar: string) => ({ key, en, ar, active: true });
const settings = { version: 1, updatedAt: null, updatedBy: null, isDefault: true, requirable: [], config: {
  providerTypes: [pick("CLINIC", "Clinic", "عيادة")], specialties: [], modules: [pick("CLINIC", "Kiorly Clinic", "كيورلي كلينيك")], markets: [{ ...pick("EG", "Egypt", "مصر"), dialCode: "+20", governorates: [] }],
  goLive: [], software: [], contactChannels: [], contactTimes: [], lostReasons: [], requiredFields: [], testMarkers: { emailDomains: [], namePrefixes: [] }, notifications: { applicantAck: true, teamAlert: true },
  statusLabels: { NEW: { en: "New", ar: "جديد" }, CONTACTED: { en: "Contacted", ar: "تم التواصل" }, QUALIFIED: { en: "Qualified", ar: "مؤهل" }, ONBOARDING: { en: "Onboarding", ar: "قيد الانضمام" }, WON: { en: "Won", ar: "ناجح" }, LOST: { en: "Lost", ar: "خاسر" } },
} };
const sla = (state: string, o: object = {}) => ({ state, since: "2026-11-28T06:00:00Z", workingMinutes: 300, remindAt: "2026-11-28T10:00:00Z", escalateAt: "2026-11-29T06:00:00Z", ...o });
const row = (o: Record<string, unknown> = {}) => ({ id: "ld_1", ref: "KL-AAAA2222", status: "NEW", mode: "CONNECTED", providerType: "CLINIC", legalName: "Nile Family Clinic", tradeName: null, contactName: "Dr Hoda", phoneMasked: "+20 10** ***567", hasEmail: true, market: "EG", governorate: null, city: null, modules: [], locale: "en", ownerSub: "u2", ownerName: "Mona", tags: [], isTest: false, duplicateOfId: null, createdAt: "2026-11-28T06:00:00Z", updatedAt: "2026-11-28T06:00:00Z", assignedVia: "ROUND_ROBIN", routingFlag: null, lastTouchedAt: null, remindedAt: null, escalatedAt: null, sla: sla("REMIND"), ...o });
const summary = (r: object = {}) => ({ byStatus: { NEW: 3, CONTACTED: 1, QUALIFIED: 0, ONBOARDING: 0, WON: 0, LOST: 0 }, newLastSevenDays: 3, unassignedOpen: 1, testLeads: 0, reminders: { enabled: true, untouched: 3, remind: 1, escalated: 1, mineDue: 1, noEligible: 1, ...r } });
const owners = [{ sub: "u2", name: "Mona", roles: ["ops_admin"] }];
const common = () => server.use(http.get(`${L}/settings`, () => HttpResponse.json(settings)), http.get(`${L}/owners`, () => HttpResponse.json(owners)), http.get(`${L}/summary`, () => HttpResponse.json(summary())));

const asRoles = (roles: string[], sub: string, route: string, lang: "en" | "ar" = "en") => {
  const ctx: AuthCtx = { status: "signedIn", user: { sub, name: "Ops", token: "t", roles }, login: async () => {}, logout: async () => {} } as AuthCtx;
  configureApi({ getToken: async () => "t" }); void i18n.changeLanguage(lang);
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><AuthContext.Provider value={ctx}><MemoryRouter initialEntries={[route]}><Routes>
    <Route path="/leads" element={<SiteLeadsPage />} /><Route path="/leads/routing" element={<LeadRoutingPage />} /><Route path="/leads/onboarding/:id" element={<LeadOnboardingDetailPage />} /><Route path="/leads/:id" element={<SiteLeadDetailPage />} />
  </Routes></MemoryRouter><Toaster /></AuthContext.Provider></QueryClientProvider>);
};

describe("Join requests: owner rotation and reminders in the console", () => {
  it("the routing page is part of the Kiorly admin edition", () => { expect(pathInEdition("kiorly", "/leads/routing")).toBe(true); });

  it("the list shows the reminder state and 'untouched since' of New requests only, the owner and how it was assigned, and the no-owner flag", async () => {
    common();
    server.use(http.get(L, () => HttpResponse.json({ total: 4, page: 1, pageSize: 25, items: [
      row(), row({ id: "ld_2", ref: "KL-BBBB3333", sla: sla("ESCALATED"), assignedVia: "HUMAN" }), row({ id: "ld_3", ref: "KL-CCCC4444", ownerSub: null, ownerName: null, assignedVia: null, routingFlag: "NO_ELIGIBLE_OWNER", sla: sla("OK") }),
      row({ id: "ld_4", ref: "KL-DDDD5555", status: "CONTACTED", sla: sla("OFF") }),
    ] })));
    asRoles(["ops_admin"], "u-ops", "/leads");
    const r1 = await screen.findByTestId("lead-sla-KL-AAAA2222"); expect(within(r1).getByText("Reminder due")).toBeInTheDocument(); expect(r1).toHaveTextContent(/Untouched since/);
    expect(within(screen.getByTestId("lead-sla-KL-BBBB3333")).getByText("Escalated")).toBeInTheDocument();
    expect(within(screen.getByTestId("lead-sla-KL-CCCC4444")).getByText("Within target")).toBeInTheDocument();
    expect(screen.queryByTestId("lead-sla-KL-DDDD5555")).toBeNull(); // not New: no clock
    expect(screen.getByTestId("lead-noowner-KL-CCCC4444")).toHaveTextContent("No eligible owner");
    expect(screen.getAllByText("Assigned by the rotation").length).toBe(2); // rows 1 and 4 (row 2 was assigned by a person)
  });

  it("the attention cards count, and the reminder filter goes to the API", async () => {
    common(); const seen: string[] = [];
    server.use(http.get(L, ({ request }) => { seen.push(new URL(request.url).search); return HttpResponse.json({ total: 0, page: 1, pageSize: 25, items: [] }); }));
    asRoles(["ops_admin"], "u-ops", "/leads"); const user = userEvent.setup();
    const cards = await screen.findByTestId("leads-reminders"); expect(cards).toHaveTextContent("New and untouched"); expect(cards).toHaveTextContent("No eligible owner"); expect(within(screen.getByTestId("leads-rem-due")).getByText("2")).toBeInTheDocument(); // 1 reminder + 1 escalated
    await user.click(screen.getByTestId("leads-rem-escalated")); await waitFor(() => expect(new URLSearchParams(seen.at(-1)).get("sla")).toBe("escalated"));
    await user.selectOptions(screen.getByTestId("leads-filter-sla"), "due"); await waitFor(() => expect(new URLSearchParams(seen.at(-1)).get("sla")).toBe("due"));
  });

  it("the cards are hidden when reminders are switched off", async () => {
    server.use(http.get(`${L}/settings`, () => HttpResponse.json(settings)), http.get(`${L}/owners`, () => HttpResponse.json(owners)), http.get(`${L}/summary`, () => HttpResponse.json(summary({ enabled: false }))), http.get(L, () => HttpResponse.json({ total: 0, page: 1, pageSize: 25, items: [] })));
    asRoles(["ops_admin"], "u-ops", "/leads"); await screen.findByTestId("leads-summary"); expect(screen.queryByTestId("leads-reminders")).toBeNull();
  });

  it("the request page explains the clock, who assigned the owner, a missing owner, and a lost request whose draft is still open", async () => {
    common();
    const detail = (o: object = {}) => ({ ...row(o), phone: null, email: null, contactRole: null, country: "EG", branches: null, staffCount: null, specialties: [], services: null, currentSoftware: null, licences: {}, goLive: null, contactChannel: null, contactTime: null, note: null, answers: {}, consentTextVersion: "draft-2", consentAt: "2026-11-28T06:00:00Z", sourceEnv: null, lostReason: null, duplicates: [],
      events: [{ id: "e1", kind: "ASSIGN", actor: "system:round-robin", actorName: null, data: { to: "u2", toName: "Mona", via: "ROUND_ROBIN" }, createdAt: "2026-11-28T06:00:00Z" }, { id: "e2", kind: "REMINDER", actor: "system", actorName: null, data: { level: "REMIND", target: "owner", recipients: 1, sent: 1 }, createdAt: "2026-11-28T10:00:00Z" }, { id: "e3", kind: "ROUTING", actor: "system:round-robin", actorName: null, data: { action: "NO_ELIGIBLE_OWNER" }, createdAt: "2026-11-28T06:00:00Z" }],
      allowedTransitions: ["CONTACTED"], onboardingRequest: null, onboardingDraftOn: ["ONBOARDING", "WON"], ...o });
    server.use(http.get(`${L}/ld_1`, () => HttpResponse.json(detail())), http.get(`${L}/ld_2`, () => HttpResponse.json(detail({ id: "ld_2", ownerSub: null, ownerName: null, assignedVia: null, routingFlag: "NO_ELIGIBLE_OWNER" }))),
      http.get(`${L}/ld_3`, () => HttpResponse.json(detail({ id: "ld_3", status: "LOST", sla: sla("OFF"), onboardingRequest: { id: "lor_1", status: "DRAFT", kind: "CLINIC", assigneeSub: null, assigneeName: null } }))));
    const a = asRoles(["ops_admin"], "u-ops", "/leads/ld_1");
    const panel = await screen.findByTestId("lead-sla-panel"); expect(panel).toHaveTextContent("Reminder due"); expect(panel).toHaveTextContent(/Reminder at .* escalation at/); expect(panel).toHaveTextContent("working hours");
    expect(screen.getByTestId("lead-assigned-via")).toHaveTextContent("Assigned by the rotation");
    const trail = screen.getByTestId("lead-trail"); expect(trail).toHaveTextContent("Assigned to Mona by the rotation"); expect(trail).toHaveTextContent("Reminder to the owner: 1 of 1 messages sent"); expect(trail).toHaveTextContent("Nobody eligible: left unassigned");
    a.unmount(); const b = asRoles(["ops_admin"], "u-ops", "/leads/ld_2");
    expect(await screen.findByTestId("lead-noowner-hint")).toHaveTextContent("found nobody who is active and eligible"); expect(screen.getByTestId("lead-noowner")).toBeInTheDocument(); b.unmount();
    asRoles(["ops_admin"], "u-ops", "/leads/ld_3");
    expect(await screen.findByTestId("lead-lost-draft-open")).toHaveTextContent("Only a reviewer can cancel it"); expect(screen.queryByTestId("lead-sla-panel")).toBeNull();
  });
});

describe("Owner and reminder settings page", () => {
  const view = (o: object = {}) => ({ version: 2, updatedAt: "2026-11-28T10:00:00Z", updatedBy: "sup", isDefault: false, workTimeZone: "Africa/Cairo",
    config: { roundRobin: { enabled: true, eligibleSubs: [], activeWithinDays: 30 }, reminders: { enabled: true, remindAfterWorkingHours: 4, escalateAfterWorkingHours: 8 }, workWeek: { days: [0, 1, 2, 3, 4], startHour: 9, endHour: 17 } },
    candidates: [{ sub: "u2", name: "Mona", roles: ["ops_admin"], active: true, listed: false, eligibleNow: true, lastSeenAt: "2026-11-28T09:00:00Z" }, { sub: "u3", name: "Karim", roles: ["kiorly_ops"], active: false, listed: false, eligibleNow: false, lastSeenAt: "2026-09-01T09:00:00Z" }],
    state: { lastSub: "u2", assignedCount: 5, updatedAt: null }, ...o });

  it("a super admin changes the list and thresholds and saves with the loaded version; the page says why someone is skipped", async () => {
    let sent: any = null;
    server.use(http.get(`${L}/routing`, () => HttpResponse.json(view())), http.put(`${L}/routing`, async ({ request }) => { sent = await request.json(); return HttpResponse.json(view({ version: 3 })); }));
    asRoles(["super_admin"], "sup", "/leads/routing"); const user = userEvent.setup();
    expect(await screen.findByTestId("rr-now-u2")).toHaveTextContent("Yes"); expect(screen.getByTestId("rr-now-u3")).toHaveTextContent("Inactive: skipped"); expect(screen.getByTestId("rr-state")).toHaveTextContent("5 assigned, last turn: Mona");
    await user.click(screen.getByTestId("rr-pick-u2")); // limit the rotation to Mona
    await user.clear(screen.getByTestId("rem-after")); await user.type(screen.getByTestId("rem-after"), "2");
    await user.click(screen.getByTestId("week-5")); // Friday works too
    await user.click(screen.getByTestId("routing-save"));
    await waitFor(() => expect(sent).not.toBeNull());
    expect(sent.version).toBe(2); expect(sent.config.roundRobin.eligibleSubs).toEqual(["u2"]); expect(sent.config.reminders).toMatchObject({ remindAfterWorkingHours: 2, escalateAfterWorkingHours: 8 }); expect(sent.config.workWeek.days).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("an escalation earlier than the reminder cannot be saved", async () => {
    server.use(http.get(`${L}/routing`, () => HttpResponse.json(view())));
    asRoles(["super_admin"], "sup", "/leads/routing"); const user = userEvent.setup();
    await user.clear(await screen.findByTestId("rem-escalate")); await user.type(screen.getByTestId("rem-escalate"), "1"); expect(screen.getByTestId("routing-save")).toBeDisabled();
  });

  it("ops_admin and the Kiorly roles read it but cannot save; a stale save reloads", async () => {
    server.use(http.get(`${L}/routing`, () => HttpResponse.json(view())));
    const a = asRoles(["ops_admin"], "u-ops", "/leads/routing"); expect(await screen.findByTestId("routing-readonly")).toBeInTheDocument(); expect(screen.queryByTestId("routing-save")).toBeNull(); expect(screen.getByTestId("rr-enabled")).toBeDisabled(); a.unmount();
    let gets = 0; server.use(http.get(`${L}/routing`, () => { gets++; return HttpResponse.json(view({ version: gets > 1 ? 3 : 2 })); }), http.put(`${L}/routing`, () => HttpResponse.json({ code: "ROUTING_CONFIG_STALE", message: "stale" }, { status: 409 })));
    asRoles(["super_admin"], "sup", "/leads/routing"); await userEvent.setup().click(await screen.findByTestId("routing-save"));
    await waitFor(() => expect(gets).toBeGreaterThan(1)); expect(await screen.findByText(/Someone saved first/)).toBeInTheDocument();
  });

  it("renders in Arabic with Western digits", async () => {
    server.use(http.get(`${L}/routing`, () => HttpResponse.json(view())));
    asRoles(["super_admin"], "sup", "/leads/routing", "ar");
    expect(await screen.findByText("المسؤول والتذكيرات", { selector: "h1" })).toBeInTheDocument(); expect(screen.getByTestId("rr-now-u3")).toHaveTextContent("غير نشط: يُتجاوز");
    const text = document.body.textContent ?? ""; expect(text).not.toMatch(/[٠-٩۰-۹]/); expect(text).toMatch(/5/);
  });
});

describe("Onboarding draft: cancel needs a reason; the enrolment code is shown once", () => {
  const req = (o: Record<string, unknown> = {}) => ({ id: "lor_1", leadId: "ld_1", contactRef: "KL-ABCD2345", status: "DRAFT", kind: "CLINIC", legalName: "Nile Family Clinic", providerType: "CLINIC", mode: "CONNECTED", modules: ["CLINIC"], market: "EG", assigneeSub: null, assigneeName: null, note: null, isTest: false, createdBy: "system:lead-won", submittedBy: null, submittedAt: null, decidedBy: null, decidedAt: null, decisionNote: null, createdAt: "2026-11-28T09:00:00Z", updatedAt: "2026-11-28T09:00:00Z", leadStatus: "ONBOARDING", blockers: [], kinds: ["CLINIC", "NURSE", "PHARMACY", "LAB"], enrolmentId: null, enrolmentIssuedAt: null, enrolmentIssuedBy: null, enrolment: null, ...o });
  const enrol = (status = "ACTIVE") => ({ id: "kxe_1", status, expiresAt: "2026-12-05T09:00:00Z", kind: "CLINIC" });

  it("a lost join request leaves the draft open and says so; cancelling asks for a reason and sends it", async () => {
    common(); const sent: unknown[] = [];
    server.use(http.get(`${O}/lor_1`, () => HttpResponse.json(req({ leadStatus: "LOST", blockers: ["LEAD_NOT_ACTIVE"] }))), http.post(`${O}/lor_1/cancel`, async ({ request }) => { sent.push(await request.json()); return HttpResponse.json(req({ status: "CANCELLED", leadStatus: "LOST", decisionNote: "lost interest" })); }));
    asRoles(["ops_admin"], "u-ops", "/leads/onboarding/lor_1"); const user = userEvent.setup();
    expect(await screen.findByTestId("lob-lead-lost")).toHaveTextContent("stays open until a reviewer cancels it"); expect(screen.getByTestId("lob-status")).toHaveTextContent("Draft");
    await user.click(screen.getByTestId("lob-cancel")); expect(screen.getByTestId("lob-cancel-hint")).toHaveTextContent("A reason is required"); expect(screen.getByTestId("lob-decide-confirm")).toBeDisabled();
    await user.type(screen.getByTestId("lob-reason"), "lost interest"); await user.click(screen.getByTestId("lob-decide-confirm"));
    await waitFor(() => expect(sent).toEqual([{ reason: "lost interest" }])); await waitFor(() => expect(screen.getByTestId("lob-status")).toHaveTextContent("Cancelled"));
  });

  it("approval shows the code once to the approver; hiding removes it; a reload never has it; a new code can be issued", async () => {
    common(); let approved = false; let n = 0;
    server.use(http.get(`${O}/lor_1`, () => HttpResponse.json(approved ? req({ status: "APPROVED", submittedBy: "maker", decidedBy: "checker", enrolmentId: "kxe_1", enrolment: enrol() }) : req({ status: "SUBMITTED", submittedBy: "maker" }))),
      http.post(`${O}/lor_1/approve`, () => { approved = true; return HttpResponse.json({ ...req({ status: "APPROVED", submittedBy: "maker", decidedBy: "checker", enrolmentId: "kxe_1", enrolment: enrol() }), enrolmentCode: "kxe_1.SECRETCODEVALUE", shownOnce: true }); }),
      http.post(`${O}/lor_1/enrolment`, () => { n++; return HttpResponse.json({ ...req({ status: "APPROVED", submittedBy: "maker", decidedBy: "checker", enrolmentId: "kxe_2", enrolment: { ...enrol(), id: "kxe_2" } }), enrolmentCode: "kxe_2.NEWCODEVALUE", shownOnce: true }); }));
    const first = asRoles(["super_admin"], "checker", "/leads/onboarding/lor_1"); const user = userEvent.setup();
    await user.click(await screen.findByTestId("lob-approve"));
    expect(await screen.findByTestId("lob-code")).toHaveTextContent("kxe_1.SECRETCODEVALUE"); expect(screen.getByTestId("lob-code-once")).toHaveTextContent("It is shown here once"); expect(screen.getByTestId("lob-enrolment-status")).toHaveTextContent("Ready, not used yet");
    await user.click(screen.getByTestId("lob-code-hide")); expect(screen.queryByTestId("lob-code")).toBeNull(); expect(document.body.textContent).not.toContain("SECRETCODEVALUE");
    await user.click(screen.getByTestId("lob-issue-code")); expect(await screen.findByTestId("lob-code")).toHaveTextContent("NEWCODEVALUE"); expect(n).toBe(1);
    first.unmount(); // a fresh page (reload) never has a code, only the state
    asRoles(["super_admin"], "checker", "/leads/onboarding/lor_1"); expect(await screen.findByTestId("lob-enrolment-status")).toBeInTheDocument(); expect(screen.queryByTestId("lob-code")).toBeNull(); expect(document.body.textContent).not.toContain("NEWCODEVALUE");
  });

  it("a used code cannot be re-issued here; a standalone request has no code; an approved draft approved before the feature can get one", async () => {
    common();
    server.use(http.get(`${O}/lor_1`, () => HttpResponse.json(req({ status: "APPROVED", submittedBy: "maker", decidedBy: "checker", enrolmentId: "kxe_1", enrolment: enrol("USED") }))), http.get(`${O}/lor_2`, () => HttpResponse.json(req({ id: "lor_2", mode: "STANDALONE", status: "APPROVED", submittedBy: "maker", decidedBy: "checker" }))), http.get(`${O}/lor_3`, () => HttpResponse.json(req({ id: "lor_3", status: "APPROVED", submittedBy: "maker", decidedBy: "checker" }))));
    const a = asRoles(["ops_admin"], "u-ops", "/leads/onboarding/lor_1"); expect(await screen.findByTestId("lob-enrolment-status")).toHaveTextContent("Used"); expect(screen.queryByTestId("lob-issue-code")).toBeNull(); a.unmount();
    const b = asRoles(["ops_admin"], "u-ops", "/leads/onboarding/lor_2"); expect(await screen.findByTestId("lob-approved")).toHaveTextContent("standalone"); expect(screen.queryByTestId("lob-enrolment")).toBeNull(); b.unmount();
    asRoles(["ops_admin"], "u-ops", "/leads/onboarding/lor_3"); expect(await screen.findByTestId("lob-enrolment-none")).toBeInTheDocument(); expect(screen.getByTestId("lob-issue-code")).toHaveTextContent("Issue the code");
  });

  it("renders in Arabic", async () => {
    common(); server.use(http.get(`${O}/lor_1`, () => HttpResponse.json(req({ leadStatus: "LOST" }))));
    asRoles(["ops_admin"], "u-ops", "/leads/onboarding/lor_1", "ar");
    expect(await screen.findByTestId("lob-lead-lost")).toHaveTextContent("تبقى هذه المسودة مفتوحة حتى يلغيها مراجع"); await userEvent.setup().click(screen.getByTestId("lob-cancel")); expect(screen.getByTestId("lob-cancel-hint")).toHaveTextContent("السبب مطلوب");
  });
});
