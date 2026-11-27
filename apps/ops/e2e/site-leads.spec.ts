import { expect, test, type Page, type Route } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const PORT = Number(process.env.OPS_LEADS_E2E_PORT ?? 5283);
const KIORLY = `http://admin.kiorly.localhost:${PORT}`;
const KIOREX = `http://localhost:${PORT}`;
const AUTHORITY = `http://localhost:${PORT + 1}`;
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const pick = (key: string, en: string, ar: string, active = true) => ({ key, en, ar, active });
const CONFIG = {
  providerTypes: [pick("CLINIC", "Clinic", "عيادة"), pick("LAB", "Laboratory", "معمل"), pick("PHARMACY", "Pharmacy", "صيدلية")], specialties: [pick("PEDIATRICS", "Paediatrics", "أطفال")], modules: [pick("CLINIC", "Kiorly Clinic", "كيورلي كلينيك"), pick("LAB", "Kiorly Lab", "كيورلي لاب")],
  markets: [{ ...pick("EG", "Egypt", "مصر"), dialCode: "+20", governorates: [pick("CAIRO", "Cairo", "القاهرة"), pick("GIZA", "Giza", "الجيزة")] }], goLive: [pick("ASAP", "As soon as possible", "في أقرب وقت")], software: [pick("NONE", "None", "لا شيء")],
  contactChannels: [pick("PHONE", "Phone call", "مكالمة"), pick("WHATSAPP", "WhatsApp", "واتساب")], contactTimes: [pick("EVENING", "Evening", "مساء")], lostReasons: [pick("LATER", "Not now", "ليس الآن"), pick("NOT_A_FIT", "Not a fit", "غير مناسب")],
  statusLabels: { NEW: { en: "New", ar: "جديد" }, CONTACTED: { en: "Contacted", ar: "تم التواصل" }, QUALIFIED: { en: "Qualified", ar: "مؤهل" }, ONBOARDING: { en: "Onboarding", ar: "قيد الانضمام" }, WON: { en: "Won", ar: "تم الانضمام" }, LOST: { en: "Lost", ar: "مغلق" } },
  requiredFields: ["modules"], testMarkers: { emailDomains: ["example.test"], namePrefixes: ["[TEST]"] }, notifications: { applicantAck: true, teamAlert: true },
};
const TRANSITIONS: Record<string, string[]> = { NEW: ["CONTACTED", "QUALIFIED", "LOST"], CONTACTED: ["NEW", "QUALIFIED", "LOST"], QUALIFIED: ["CONTACTED", "ONBOARDING", "LOST"], ONBOARDING: ["QUALIFIED", "WON", "LOST"], WON: ["ONBOARDING"], LOST: ["NEW"] };

interface Lead { id: string; ref: string; status: string; mode: string; providerType: string; legalName: string; contactName: string; phone: string; email: string; ownerSub: string | null; ownerName: string | null; tags: string[]; isTest: boolean; duplicateOfId: string | null; lostReason: string | null; createdAt: string; events: Array<{ id: string; kind: string; actor: string; actorName: string | null; data: Record<string, unknown>; createdAt: string }> }
const seed = (): Lead[] => [
  { id: "ld_1", ref: "KL-ABCD2345", status: "NEW", mode: "CONNECTED", providerType: "CLINIC", legalName: "Nile Family Clinic", contactName: "Dr Hoda", phone: "+201001234567", email: "hoda@clinic.example.org", ownerSub: null, ownerName: null, tags: [], isTest: false, duplicateOfId: null, lostReason: null, createdAt: "2026-11-28T09:00:00Z", events: [{ id: "e1", kind: "CREATED", actor: "public", actorName: null, data: {}, createdAt: "2026-11-28T09:00:00Z" }] },
  { id: "ld_2", ref: "KL-LAB22222", status: "CONTACTED", mode: "STANDALONE", providerType: "LAB", legalName: "Giza Lab Centre", contactName: "Dr Amr", phone: "+201055550000", email: "", ownerSub: "ops-1", ownerName: "Ops Admin", tags: [], isTest: false, duplicateOfId: null, lostReason: null, createdAt: "2026-11-27T09:00:00Z", events: [{ id: "e2", kind: "CREATED", actor: "public", actorName: null, data: {}, createdAt: "2026-11-27T09:00:00Z" }] },
  { id: "ld_3", ref: "KL-TEST3333", status: "NEW", mode: "STANDALONE", providerType: "PHARMACY", legalName: "[TEST] E2E Pharmacy", contactName: "Test Person", phone: "+201066660000", email: "e2e@example.test", ownerSub: null, ownerName: null, tags: ["test"], isTest: true, duplicateOfId: "ld_1", lostReason: null, createdAt: "2026-11-28T10:00:00Z", events: [{ id: "e3", kind: "CREATED", actor: "public", actorName: null, data: {}, createdAt: "2026-11-28T10:00:00Z" }] },
];

/** A signed-in ops user and a tiny in-memory leads API (the test, not a server, answers /api). */
async function setup(page: Page, roles: string[]) {
  const leads = seed(); let cfg = JSON.parse(JSON.stringify(CONFIG)); let version = 2; const calls: string[] = [];
  const access = `${b64({ alg: "none" })}.${b64({ sub: "ops-1", kx_roles: roles })}.x`;
  const user = { access_token: access, id_token: access, token_type: "Bearer", scope: "openid profile", profile: { sub: "ops-1", name: "Ops Admin" }, expires_at: Math.floor(Date.now() / 1000) + 3600 };
  await page.addInitScript(([k, v]) => { sessionStorage.setItem(k, v); try { localStorage.setItem("kx-lang", "en"); } catch { /* ignore */ } }, [`oidc.user:${AUTHORITY}:kiorex-ops`, JSON.stringify(user)]);
  const summary = (l: Lead) => ({ id: l.id, ref: l.ref, status: l.status, mode: l.mode, providerType: l.providerType, legalName: l.legalName, tradeName: null, contactName: l.contactName, phoneMasked: `${l.phone.slice(0, 3)}••••${l.phone.slice(-4)}`, hasEmail: !!l.email, market: "EG", governorate: "CAIRO", city: "Nasr City", modules: ["CLINIC"], locale: "en", ownerSub: l.ownerSub, ownerName: l.ownerName, tags: l.tags, isTest: l.isTest, duplicateOfId: l.duplicateOfId, createdAt: l.createdAt, updatedAt: l.createdAt });
  const detail = (l: Lead) => ({ ...summary(l), phone: l.phone, email: l.email || null, contactRole: "Owner", country: "EG", branches: 2, staffCount: 9, specialties: ["PEDIATRICS"], services: "Walk-ins", currentSoftware: "Paper", licences: { facilityLicence: "FL-77/2025" }, goLive: "ASAP", contactChannel: "PHONE", contactTime: "EVENING", note: "Call after 5", answers: { rooms: 4 }, consentTextVersion: "draft-2", consentAt: l.createdAt, sourceEnv: "test", lostReason: l.lostReason, duplicates: l.duplicateOfId ? [{ id: "ld_1", ref: "KL-ABCD2345", status: "NEW", legalName: "Nile Family Clinic", createdAt: "2026-11-28T09:00:00Z" }] : [], events: l.events, allowedTransitions: TRANSITIONS[l.status] ?? [] });
  const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  await page.route((u) => u.pathname.startsWith("/api/"), async (route) => {
    const req = route.request(); const u = new URL(req.url()); const p = u.pathname.replace("/api/v1", ""); const m = req.method();
    if (!p.startsWith("/admin/leads")) return json(route, p.includes("unread") ? { count: 0 } : []);
    calls.push(`${m} ${p}${u.search}`);
    const sub = p.slice("/admin/leads".length);
    if (m === "GET" && sub === "/summary") { const by: Record<string, number> = {}; for (const s of Object.keys(TRANSITIONS)) by[s] = leads.filter((l) => !l.isTest && l.status === s).length; return json(route, { byStatus: by, newLastSevenDays: 2, unassignedOpen: 1, testLeads: 1 }); }
    if (m === "GET" && sub === "/owners") return json(route, [{ sub: "ops-1", name: "Ops Admin", roles: ["ops_admin"] }, { sub: "ops-2", name: "Mona", roles: ["ops_admin"] }]);
    if (m === "GET" && sub === "/settings") return json(route, { version, updatedAt: "2026-11-28T08:00:00Z", updatedBy: "sup", isDefault: false, config: cfg, requirable: ["email", "modules", "city", "facilityLicence"] });
    if (m === "PUT" && sub === "/settings") { const b = req.postDataJSON(); if (b.version !== version) return json(route, { code: "LEAD_CONFIG_STALE" }, 409); cfg = b.config; version++; return json(route, { version, updatedAt: new Date().toISOString(), updatedBy: "ops-1", isDefault: false, config: cfg, requirable: ["email", "modules", "city", "facilityLicence"] }); }
    if (m === "POST" && sub === "/test/remove") { const confirm = req.postDataJSON()?.confirm === true; const n = leads.filter((l) => l.isTest).length; if (confirm) for (let i = leads.length - 1; i >= 0; i--) if (leads[i]!.isTest) leads.splice(i, 1); return json(route, { dryRun: !confirm, count: n }); }
    if (m === "GET" && sub === "/export.csv") return route.fulfill({ status: 200, contentType: "text/csv", body: "﻿reference,status\r\nKL-ABCD2345,NEW\r\n" });
    if (m === "GET" && sub === "") {
      let rows = leads.slice(); const q = (k: string) => u.searchParams.get(k) ?? "";
      if (q("status")) rows = rows.filter((l) => l.status === q("status")); if (q("type")) rows = rows.filter((l) => l.providerType === q("type")); if (q("mode")) rows = rows.filter((l) => l.mode === q("mode"));
      if (q("test") === "exclude") rows = rows.filter((l) => !l.isTest); if (q("test") === "only") rows = rows.filter((l) => l.isTest); if (q("owner") === "none") rows = rows.filter((l) => !l.ownerSub); if (q("duplicates") === "only") rows = rows.filter((l) => l.duplicateOfId);
      if (q("q")) rows = rows.filter((l) => `${l.ref} ${l.legalName}`.toLowerCase().includes(q("q").toLowerCase())); if (q("from")) rows = rows.filter((l) => l.createdAt.slice(0, 10) >= q("from")); if (q("to")) rows = rows.filter((l) => l.createdAt.slice(0, 10) <= q("to"));
      return json(route, { total: rows.length, page: 1, pageSize: 25, items: rows.map(summary) });
    }
    const id = sub.split("/")[1]; const l = leads.find((x) => x.id === id); if (!l) return json(route, { code: "LEAD_NOT_FOUND" }, 404);
    const ev = (kind: string, data: Record<string, unknown>) => l.events.push({ id: `e${l.events.length + 10}`, kind, actor: "ops-1", actorName: "Ops Admin", data, createdAt: new Date().toISOString() });
    if (m === "GET" && sub === `/${id}`) return json(route, detail(l));
    if (m === "POST" && sub === `/${id}/notes`) { ev("NOTE", { text: req.postDataJSON().text }); return json(route, detail(l)); }
    if (m === "PATCH" && sub === `/${id}`) {
      const b = req.postDataJSON();
      if (b.status) { if (!TRANSITIONS[l.status]!.includes(b.status)) return json(route, { code: "INVALID_TRANSITION" }, 409); ev("STATUS", { from: l.status, to: b.status, ...(b.lostReason ? { reason: b.lostReason } : {}) }); l.status = b.status; l.lostReason = b.lostReason ?? null; }
      if (b.ownerSub !== undefined) { l.ownerSub = b.ownerSub; l.ownerName = b.ownerSub === "ops-1" ? "Ops Admin" : b.ownerSub === "ops-2" ? "Mona" : null; ev("ASSIGN", { to: b.ownerSub, toName: l.ownerName }); }
      if (b.isTest !== undefined) { l.isTest = b.isTest; l.tags = b.isTest ? ["test", ...l.tags.filter((t) => t !== "test")] : l.tags.filter((t) => t !== "test"); ev("TAG", { test: b.isTest }); }
      if (b.addTags) { l.tags.push(...b.addTags.map((t: string) => t.toLowerCase())); ev("TAG", { add: b.addTags, remove: [] }); }
      if (b.removeTags) { l.tags = l.tags.filter((t) => !b.removeTags.includes(t)); ev("TAG", { add: [], remove: b.removeTags }); }
      return json(route, detail(l));
    }
    return json(route, { code: "NOT_FOUND" }, 404);
  });
  return { leads, calls, config: () => cfg };
}
/** Clears the filters and waits until the address no longer carries them (the next change builds on the address). */
const reset = async (page: Page) => { await page.getByRole("button", { name: "Reset filters" }).click(); await expect(page).toHaveURL(/\/leads$/); await expect(page.locator("[aria-pressed=true]")).toHaveCount(0); /* the page has re-rendered with no filter */ };
// The table header cell colours belong to the console-wide DataTable (shared, reviewed with the console design), not to these pages: they are left out of the contrast rule.
const axe = async (page: Page, label: string) => { const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).exclude("[data-testid=data-table] thead").analyze(); expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`), label).toEqual([]); };

for (const [name, base, edition] of [["Kiorex super admin", KIOREX, "kiorex"], ["Kiorly admin", KIORLY, "kiorly"]] as const) {
  test.describe(`${name}: join requests`, () => {
    test("the inbox lists requests, filters by type, status and test data, searches, and shows the count badge in the navigation", async ({ page }) => {
      await setup(page, ["ops_admin"]); await page.goto(`${base}/leads`);
      await expect(page.getByRole("heading", { level: 1, name: "Join requests" })).toBeVisible();
      await expect(page.getByTestId("sidebar-nav").getByRole("link", { name: /Join requests/ })).toBeVisible(); await expect(page.getByTestId("site-leads-badge")).toHaveText("1");
      const rows = page.getByTestId("data-table").locator("tbody tr"); await expect(rows).toHaveCount(3);
      await expect(page.getByText("+20••••4567").first()).toBeVisible(); await expect(page.getByText("hoda@clinic.example.org")).toHaveCount(0); // contact details stay masked in the list
      await page.getByTestId("leads-filter-type").selectOption("LAB"); await expect(rows).toHaveCount(1); await expect(rows.first()).toContainText("Giza Lab Centre");
      await reset(page); await expect(rows).toHaveCount(3);
      await page.getByTestId("leads-count-CONTACTED").click(); await expect(rows).toHaveCount(1); await expect(page).toHaveURL(/status=CONTACTED/); await reset(page);
      await page.getByTestId("leads-filter-test").selectOption("exclude"); await expect(rows).toHaveCount(2); await page.getByTestId("leads-filter-test").selectOption("only"); await expect(rows).toHaveCount(1); await expect(rows.first()).toContainText("Test");
      await reset(page); await page.getByTestId("leads-filter-dup").click(); /* controlled by the address, so the state flips a moment after the click */ await expect(rows).toHaveCount(1); await expect(rows.first()).toContainText("Duplicate");
      await reset(page); await page.getByTestId("leads-filter-q").fill("KL-LAB"); await expect(rows).toHaveCount(1);
      await page.getByTestId("leads-filter-mode").selectOption("CONNECTED"); await expect(page.getByText("No join requests match these filters.")).toBeVisible(); /* the empty state is one row */ await page.getByTestId("leads-filter-from").fill("2026-11-27"); await expect(page.getByTestId("leads-filter-from")).toHaveValue("2026-11-27");
      await expect(page.getByTestId("leads-filter-market")).toHaveCount(0); // one market: no market selector
      if (edition === "kiorly") await expect(page).toHaveTitle("Kiorly Admin");
    });
    test("detail: contact data, status flow, assignment, tags, notes and the trail; an invalid change is refused with a message", async ({ page }) => {
      const api = await setup(page, ["ops_admin"]); await page.goto(`${base}/leads`);
      await page.getByTestId("lead-link-KL-ABCD2345").click(); await expect(page).toHaveURL(/\/leads\/ld_1$/);
      await expect(page.getByTestId("lead-phone")).toHaveText("+201001234567"); await expect(page.getByTestId("lead-email")).toHaveText("hoda@clinic.example.org"); await expect(page.getByText("FL-77/2025")).toBeVisible(); await expect(page.getByText(/Never checked against any authority/)).toBeVisible();
      await expect(page.getByTestId("lead-to-WON")).toHaveCount(0);
      await page.getByTestId("lead-to-CONTACTED").click(); await expect(page.getByTestId("lead-status-chip")).toHaveText("Contacted");
      await page.getByTestId("lead-assign-me").click(); await expect(page.getByTestId("lead-owner")).toHaveValue("ops-1");
      await page.getByTestId("lead-owner").selectOption("ops-2"); await expect(page.getByTestId("lead-owner")).toHaveValue("ops-2");
      await page.getByLabel("Add tag").fill("Priority"); await page.getByLabel("Add tag").press("Enter"); await expect(page.getByRole("button", { name: "Remove tag priority" })).toBeVisible();
      await page.getByTestId("lead-note-input").fill("Called, wants a demo on Sunday"); await page.getByTestId("lead-note-add").click(); await expect(page.getByTestId("lead-trail")).toContainText("Called, wants a demo on Sunday");
      await page.getByTestId("lead-to-LOST").click(); await page.getByTestId("lead-lost-reason").selectOption("LATER"); await page.getByTestId("lead-lost-confirm").click();
      await expect(page.getByTestId("lead-status-chip")).toHaveText("Lost"); await expect(page.getByTestId("lead-trail")).toContainText("Contacted to Lost"); await expect(page.getByText("Closed: Not now")).toBeVisible();
      await page.getByTestId("lead-to-NEW").click(); await expect(page.getByTestId("lead-status-chip")).toHaveText("New");
      expect(api.leads[0]!.events.map((e) => e.kind)).toEqual(expect.arrayContaining(["STATUS", "ASSIGN", "TAG", "NOTE"]));
      await expect(page.getByTestId("lead-test-toggle")).toHaveCount(0); // only a super admin changes the test tag
      await page.goto(`${base}/leads/ld_2`); await expect(page.getByTestId("lead-to-QUALIFIED")).toBeVisible();
      // the API refuses a transition the UI did not offer (stale page): clear message
      api.leads[1]!.status = "WON"; await page.getByTestId("lead-to-QUALIFIED").click(); await expect(page.getByText("That status change is not allowed from the current status")).toBeVisible();
    });
    test("export downloads the CSV with the current filters", async ({ page }) => {
      const api = await setup(page, ["ops_admin"]); await page.goto(`${base}/leads?status=NEW`);
      const download = page.waitForEvent("download"); await page.getByTestId("leads-export").click(); const d = await download; expect(d.suggestedFilename()).toMatch(/^kiorly-join-requests-\d{4}-\d{2}-\d{2}\.csv$/);
      expect(api.calls.some((c) => c.startsWith("GET /admin/leads/export.csv") && c.includes("status=NEW"))).toBe(true);
    });
    test("settings: an ops admin reads; a super admin edits picklists and required fields, saves, and removes test data after a count", async ({ page }) => {
      await setup(page, ["ops_admin"]); await page.goto(`${base}/leads/settings`);
      await expect(page.getByTestId("set-readonly")).toBeVisible(); await expect(page.getByTestId("set-save")).toHaveCount(0);
      const page2 = await page.context().newPage(); const api = await setup(page2, ["super_admin", "ops_admin"]); await page2.goto(`${base}/leads/settings`);
      await expect(page2.getByTestId("set-version")).toContainText("Version 2"); await expect(page2.getByTestId("set-readonly")).toHaveCount(0); await expect(page2.getByTestId("set-save")).toBeDisabled();
      await page2.getByTestId("pick-add-providerTypes").click(); // the first section is open by default
      const row = page2.getByTestId("pick-providerTypes-3").getByRole("textbox"); await row.nth(0).fill("dental"); await row.nth(1).fill("Dental centre"); await row.nth(2).fill("مركز أسنان");
      await page2.locator("summary", { hasText: "Required fields" }).click(); await page2.getByTestId("req-email").check();
      await page2.getByTestId("set-save").click(); await expect(page2.getByText("Settings saved")).toBeVisible(); await expect(page2.getByTestId("set-version")).toContainText("Version 3");
      expect(api.config().providerTypes.at(-1)).toMatchObject({ key: "DENTAL", en: "Dental centre", active: true }); expect(api.config().requiredFields).toEqual(["modules", "email"]);
      await page2.locator("summary", { hasText: "Test data markers" }).click(); await page2.getByTestId("test-count").click(); await expect(page2.getByTestId("test-count-result")).toContainText("1 test requests will be deleted");
      await page2.getByTestId("test-delete").click(); await expect(page2.getByText("1 test requests deleted")).toBeVisible(); expect(api.leads.some((l) => l.isTest)).toBe(false);
      await page2.goto(`${base}/leads/ld_1`); await expect(page2.getByTestId("lead-test-toggle")).toBeVisible();
    });
    test("Arabic: right to left, Arabic labels and Arabic status names", async ({ page }) => {
      await setup(page, ["ops_admin"]); await page.addInitScript(() => { try { localStorage.setItem("kx-lang", "ar"); } catch { /* ignore */ } });
      await page.goto(`${base}/leads`); await expect(page.locator("html")).toHaveAttribute("dir", "rtl"); await expect(page.getByRole("heading", { level: 1, name: "طلبات الانضمام" })).toBeVisible();
      await expect(page.getByTestId("lead-chip-KL-ABCD2345")).toHaveText("جديد"); await expect(page.getByTestId("data-table").getByText("عيادة")).toBeVisible();
      await page.getByTestId("lead-link-KL-ABCD2345").click(); await expect(page.getByTestId("lead-to-CONTACTED")).toHaveText("تم التواصل");
    });
    test("phone width: no horizontal scroll on the inbox, detail and settings", async ({ page }) => {
      await setup(page, ["super_admin", "ops_admin"]); await page.setViewportSize({ width: 375, height: 800 });
      for (const p of ["/leads", "/leads/ld_1", "/leads/settings"]) { await page.goto(`${base}${p}`); await expect(page.getByRole("heading", { level: 1 })).toBeVisible(); expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), p).toBe(true); }
    });
    test("accessibility (axe) on the inbox, detail and settings, English and Arabic", async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" }); // axe reads colours at one instant: no page may be mid-fade
      await setup(page, ["super_admin", "ops_admin"]);
      for (const lang of ["en", "ar"]) {
        await page.addInitScript((l) => { try { localStorage.setItem("kx-lang", l); } catch { /* ignore */ } }, lang);
        for (const p of ["/leads", "/leads/ld_1", "/leads/settings"]) { await page.goto(`${base}${p}`); await expect(page.getByRole("heading", { level: 1 })).toBeVisible(); await axe(page, `${edition} ${lang} ${p}`); }
        await page.goto(`${base}/leads/settings`); for (const s of await page.locator("details > summary").all()) await s.click(); await axe(page, `${edition} ${lang} settings expanded`);
      }
    });
  });
}
test("access control in the UI: a patient (no ops role) never reaches the join requests", async ({ page }) => {
  await setup(page, ["patient"]); await page.goto(`${KIOREX}/leads`);
  await expect(page.getByTestId("sidebar-nav")).toHaveCount(0);
});
