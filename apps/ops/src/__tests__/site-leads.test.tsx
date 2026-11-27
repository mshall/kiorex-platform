import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "@/test/mocks/server";
import { renderOps } from "@/test/utils";
import { AuthContext, type AuthCtx } from "@/auth/AuthProvider";
import { configureApi } from "@/api/client";
import i18n from "@/i18n";
import SiteLeadsPage from "@/pages/SiteLeadsPage";
import SiteLeadDetailPage from "@/pages/SiteLeadDetailPage";
import SiteLeadSettingsPage from "@/pages/SiteLeadSettingsPage";
import { Toaster } from "@/components/ui/sonner";
import { KIORLY_ROUTES, pathInEdition } from "@/lib/edition";

const B = "/api/v1/admin/leads";
const pick = (key: string, en: string, ar: string, active = true) => ({ key, en, ar, active });
const config = {
  providerTypes: [pick("CLINIC", "Clinic", "عيادة"), pick("LAB", "Laboratory", "معمل")], specialties: [pick("PEDIATRICS", "Paediatrics", "أطفال")], modules: [pick("CLINIC", "Kiorly Clinic", "كيورلي كلينيك")],
  markets: [{ ...pick("EG", "Egypt", "مصر"), dialCode: "+20", governorates: [pick("CAIRO", "Cairo", "القاهرة")] }], goLive: [pick("ASAP", "As soon as possible", "في أقرب وقت")], software: [], contactChannels: [pick("PHONE", "Phone call", "مكالمة")], contactTimes: [pick("EVENING", "Evening", "مساء")],
  lostReasons: [pick("LATER", "Not now", "ليس الآن")],
  statusLabels: { NEW: { en: "New", ar: "جديد" }, CONTACTED: { en: "Contacted", ar: "تم التواصل" }, QUALIFIED: { en: "Qualified", ar: "مؤهل" }, ONBOARDING: { en: "Onboarding", ar: "قيد الانضمام" }, WON: { en: "Won", ar: "تم" }, LOST: { en: "Lost", ar: "مغلق" } },
  requiredFields: ["modules"], testMarkers: { emailDomains: ["example.test"], namePrefixes: ["[TEST]"] }, notifications: { applicantAck: true, teamAlert: true },
};
const settings = { version: 2, updatedAt: "2026-11-28T10:00:00Z", updatedBy: "sup", isDefault: false, config, requirable: ["email", "modules", "city"] };
const row = (o: Record<string, unknown> = {}) => ({ id: "ld_1", ref: "KL-ABCD2345", status: "NEW", mode: "CONNECTED", providerType: "CLINIC", legalName: "Nile Family Clinic", tradeName: null, contactName: "Dr Hoda", phoneMasked: "+20••••4567", hasEmail: true, market: "EG", governorate: "CAIRO", city: "Nasr City", modules: ["CLINIC"], locale: "en", ownerSub: null, ownerName: null, tags: [], isTest: false, duplicateOfId: null, createdAt: "2026-11-28T09:00:00Z", updatedAt: "2026-11-28T09:00:00Z", ...o });
const detail = (o: Record<string, unknown> = {}) => ({ ...row(), phone: "+201001234567", email: "hoda@clinic.example.org", contactRole: "Owner", country: "EG", branches: 2, staffCount: 9, specialties: ["PEDIATRICS"], services: "Walk-ins", currentSoftware: "Paper", licences: { facilityLicence: "FL-77/2025" }, goLive: "ASAP", contactChannel: "PHONE", contactTime: "EVENING", note: "Call after 5", answers: { rooms: 4 }, consentTextVersion: "draft-2", consentAt: "2026-11-28T09:00:00Z", sourceEnv: "test", lostReason: null, duplicates: [{ id: "ld_0", ref: "KL-OLD22222", status: "NEW", legalName: "Nile Clinic", createdAt: "2026-11-01T09:00:00Z" }], events: [{ id: "le_1", kind: "CREATED", actor: "public", actorName: null, data: {}, createdAt: "2026-11-28T09:00:00Z" }], allowedTransitions: ["CONTACTED", "QUALIFIED", "LOST"], ...o });
const summary = { byStatus: { NEW: 3, CONTACTED: 1, QUALIFIED: 0, ONBOARDING: 0, WON: 2, LOST: 1 }, newLastSevenDays: 4, unassignedOpen: 2, testLeads: 1 };
const common = () => server.use(http.get(`${B}/settings`, () => HttpResponse.json(settings)), http.get(`${B}/summary`, () => HttpResponse.json(summary)), http.get(`${B}/owners`, () => HttpResponse.json([{ sub: "test-ops-1", name: "Ops Admin", roles: ["ops_admin"] }, { sub: "u2", name: "Mona", roles: ["ops_admin"] }])));

describe("join requests inbox", () => {
  it("lists requests with decoded labels, masked phone, flags and the status counters; filters go to the API", async () => {
    const seen: string[] = []; common();
    server.use(http.get(B, ({ request }) => { seen.push(new URL(request.url).search); return HttpResponse.json({ total: 2, page: 1, pageSize: 25, items: [row(), row({ id: "ld_2", ref: "KL-TEST2222", legalName: "Giza Lab Centre", isTest: true, duplicateOfId: "ld_1", status: "WON", providerType: "LAB", mode: "STANDALONE" })] }); }));
    renderOps(<Routes><Route path="/leads" element={<SiteLeadsPage />} /></Routes>, { route: "/leads" });
    expect(await screen.findByText("Nile Family Clinic")).toBeInTheDocument();
    expect(screen.getAllByText("+20••••4567")).toHaveLength(2); expect(screen.getAllByText("Test").length).toBeGreaterThan(0); expect(screen.getByText("Duplicate")).toBeInTheDocument();
    expect(await screen.findByTestId("leads-count-NEW")).toHaveTextContent("3");
    const user = userEvent.setup();
    await user.selectOptions(screen.getByTestId("leads-filter-type"), "LAB");
    await user.selectOptions(screen.getByTestId("leads-filter-mode"), "STANDALONE");
    await user.click(screen.getByTestId("leads-count-WON"));
    await waitFor(() => expect(seen.at(-1)).toMatch(/status=WON/));
    const last = new URLSearchParams(seen.at(-1)); expect(last.get("type")).toBe("LAB"); expect(last.get("mode")).toBe("STANDALONE");
    await user.type(screen.getByTestId("leads-filter-q"), "KL-TEST");
    await waitFor(() => expect(new URLSearchParams(seen.at(-1)).get("q")).toBe("KL-TEST"));
    expect(screen.queryByTestId("leads-filter-market")).toBeNull(); // one market: the selector stays hidden
  });
  it("exports the filtered list as CSV through the authenticated endpoint", async () => {
    common(); let url = "";
    server.use(http.get(B, () => HttpResponse.json({ total: 0, page: 1, pageSize: 25, items: [] })), http.get(`${B}/export.csv`, ({ request }) => { url = request.url; return new HttpResponse("﻿reference\r\n", { headers: { "content-type": "text/csv" } }); }));
    URL.createObjectURL = () => "blob:x"; URL.revokeObjectURL = () => undefined;
    renderOps(<Routes><Route path="/leads" element={<SiteLeadsPage />} /></Routes>, { route: "/leads?status=NEW&type=CLINIC" });
    await userEvent.setup().click(await screen.findByTestId("leads-export"));
    await waitFor(() => expect(url).toContain("status=NEW")); expect(url).toContain("type=CLINIC"); expect(url).not.toContain("page=");
    expect(await screen.findByText("CSV downloaded")).toBeInTheDocument();
  });
  it("renders in Arabic with Arabic status names", async () => {
    common(); server.use(http.get(B, () => HttpResponse.json({ total: 1, page: 1, pageSize: 25, items: [row()] })));
    renderOps(<Routes><Route path="/leads" element={<SiteLeadsPage />} /></Routes>, { route: "/leads", lang: "ar" });
    expect(await screen.findByText("طلبات الانضمام")).toBeInTheDocument(); expect((await screen.findAllByText("جديد")).length).toBeGreaterThan(0); expect(screen.getAllByText("عيادة").length).toBeGreaterThan(0);
  });
  it("is part of the Kiorly admin edition", () => { expect(KIORLY_ROUTES).toContain("/leads"); expect(pathInEdition("kiorly", "/leads/ld_1")).toBe(true); expect(pathInEdition("kiorly", "/leads/settings")).toBe(true); });
});

describe("join request detail", () => {
  const mount = () => renderOps(<Routes><Route path="/leads/:id" element={<SiteLeadDetailPage />} /></Routes>, { route: "/leads/ld_1" });
  it("shows decrypted contact data, answers, self-declared licences, duplicates and the trail", async () => {
    common(); server.use(http.get(`${B}/ld_1`, () => HttpResponse.json(detail())));
    mount();
    expect(await screen.findByTestId("lead-phone")).toHaveTextContent("+201001234567"); expect(screen.getByTestId("lead-email")).toHaveTextContent("hoda@clinic.example.org");
    expect(screen.getByText("Rooms")).toBeInTheDocument(); expect(screen.getByText("FL-77/2025")).toBeInTheDocument(); expect(screen.getByText(/Never checked against any authority/)).toBeInTheDocument();
    expect(within(screen.getByTestId("lead-duplicates")).getByText("KL-OLD22222")).toBeInTheDocument(); expect(screen.getByTestId("lead-event-CREATED")).toBeInTheDocument();
  });
  it("changes status (only allowed transitions are offered), marks lost with a reason, assigns, adds a note and a tag", async () => {
    common(); const calls: Array<{ m: string; b: unknown }> = [];
    server.use(http.get(`${B}/ld_1`, () => HttpResponse.json(detail())),
      http.patch(`${B}/ld_1`, async ({ request }) => { calls.push({ m: "PATCH", b: await request.json() }); return HttpResponse.json(detail()); }),
      http.post(`${B}/ld_1/notes`, async ({ request }) => { calls.push({ m: "NOTE", b: await request.json() }); return HttpResponse.json(detail()); }));
    mount(); const user = userEvent.setup();
    await screen.findByTestId("lead-to-CONTACTED"); expect(screen.queryByTestId("lead-to-WON")).toBeNull();
    await user.click(screen.getByTestId("lead-to-CONTACTED")); await waitFor(() => expect(calls[0]).toEqual({ m: "PATCH", b: { status: "CONTACTED" } }));
    await user.click(screen.getByTestId("lead-to-LOST")); await user.selectOptions(screen.getByTestId("lead-lost-reason"), "LATER"); await user.click(screen.getByTestId("lead-lost-confirm"));
    await waitFor(() => expect(calls[1]).toEqual({ m: "PATCH", b: { status: "LOST", lostReason: "LATER" } }));
    await user.click(screen.getByTestId("lead-assign-me")); await waitFor(() => expect(calls[2]).toEqual({ m: "PATCH", b: { ownerSub: "test-ops-1" } }));
    await user.type(screen.getByTestId("lead-note-input"), "Wants a demo"); await user.click(screen.getByTestId("lead-note-add")); await waitFor(() => expect(calls[3]).toEqual({ m: "NOTE", b: { text: "Wants a demo" } }));
    await user.type(screen.getByLabelText("Add tag"), "Priority{Enter}"); await waitFor(() => expect(calls[4]).toEqual({ m: "PATCH", b: { addTags: ["Priority"] } }));
  });
  it("a transition the API refuses shows a clear message", async () => {
    common(); server.use(http.get(`${B}/ld_1`, () => HttpResponse.json(detail())), http.patch(`${B}/ld_1`, () => HttpResponse.json({ code: "INVALID_TRANSITION", message: "no" }, { status: 409 })));
    mount(); await userEvent.setup().click(await screen.findByTestId("lead-to-QUALIFIED"));
    expect(await screen.findByText("That status change is not allowed from the current status")).toBeInTheDocument();
  });
});

const asRoles = (roles: string[]) => {
  const ctx: AuthCtx = { status: "signedIn", user: { sub: "u-ops", name: "Ops", token: "t", roles }, login: async () => {}, logout: async () => {} } as AuthCtx;
  configureApi({ getToken: async () => "t" }); void i18n.changeLanguage("en");
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><AuthContext.Provider value={ctx}><MemoryRouter initialEntries={["/leads/settings"]}><Routes><Route path="/leads/settings" element={<SiteLeadSettingsPage />} /></Routes></MemoryRouter><Toaster /></AuthContext.Provider></QueryClientProvider>);
};

describe("join flow settings", () => {
  it("a super admin edits a picklist, adds an option, makes a field required and saves with the loaded version", async () => {
    common(); let saved = null as { version: number; config: typeof config } | null;
    server.use(http.put(`${B}/settings`, async ({ request }) => { const b = (await request.json()) as { version: number; config: typeof config }; saved = b; return HttpResponse.json({ ...settings, version: 3, config: b.config }); }));
    renderOps(<Routes><Route path="/leads/settings" element={<SiteLeadSettingsPage />} /></Routes>, { route: "/leads/settings" });
    const user = userEvent.setup(); const save = await screen.findByTestId("set-save"); expect(save).toBeDisabled();
    await user.click(screen.getByText("Provider types", { selector: "summary" })); await user.click(screen.getByTestId("pick-add-providerTypes"));
    const row = screen.getByTestId("pick-providerTypes-2"); const [key, en, ar] = within(row).getAllByRole("textbox");
    await user.clear(key); await user.type(key, "dental"); await user.type(en, "Dental centre"); await user.type(ar, "مركز أسنان");
    await user.click(screen.getByText("Required fields", { selector: "summary" })); await user.click(screen.getByTestId("req-email"));
    await user.click(screen.getByTestId("set-save"));
    await waitFor(() => expect(saved).not.toBeNull());
    expect(saved!.version).toBe(2); expect(saved!.config.providerTypes.at(-1)).toMatchObject({ key: "DENTAL", en: "Dental centre", ar: "مركز أسنان", active: true });
    expect(saved!.config.requiredFields).toEqual(["modules", "email"]);
    expect(await screen.findByText("Settings saved")).toBeInTheDocument();
  });
  it("an ops admin can read but not change or delete anything", async () => {
    common(); asRoles(["ops_admin"]);
    expect(await screen.findByTestId("set-readonly")).toBeInTheDocument(); expect(screen.queryByTestId("set-save")).toBeNull(); expect(screen.queryByTestId("pick-add-providerTypes")).toBeNull(); expect(screen.queryByTestId("test-count")).toBeNull();
    expect(within(screen.getByTestId("pick-providerTypes-0")).getAllByRole("textbox")[1]).toHaveAttribute("readonly");
  });
  it("test data removal is a dry-run count first, then an explicit confirm", async () => {
    common(); const calls: unknown[] = [];
    server.use(http.post(`${B}/test/remove`, async ({ request }) => { const b = (await request.json()) as { confirm?: boolean }; calls.push(b); return HttpResponse.json({ dryRun: !b.confirm, count: 3 }); }));
    renderOps(<Routes><Route path="/leads/settings" element={<SiteLeadSettingsPage />} /></Routes>, { route: "/leads/settings" });
    const user = userEvent.setup(); await user.click(await screen.findByText("Test data markers", { selector: "summary" }));
    await user.click(screen.getByTestId("test-count")); expect(await screen.findByTestId("test-count-result")).toHaveTextContent("3 test requests will be deleted");
    await user.click(screen.getByTestId("test-delete")); await waitFor(() => expect(calls).toEqual([{ confirm: false }, { confirm: true }]));
    expect(await screen.findByText("3 test requests deleted")).toBeInTheDocument();
  });
  it("a stale save reloads the settings and says so", async () => {
    common(); server.use(http.put(`${B}/settings`, () => HttpResponse.json({ code: "LEAD_CONFIG_STALE", message: "stale" }, { status: 409 })));
    renderOps(<Routes><Route path="/leads/settings" element={<SiteLeadSettingsPage />} /></Routes>, { route: "/leads/settings" });
    const user = userEvent.setup(); await user.click(await screen.findByText("Required fields", { selector: "summary" })); await user.click(screen.getByTestId("req-city")); await user.click(screen.getByTestId("set-save"));
    expect(await screen.findByText("Someone saved first: reloaded, review and try again")).toBeInTheDocument();
  });
});
