import { createHmac } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { deriveIntakeSigningKey, newIntakeNonce } from "@kiorex/contracts";
import { API, signIn } from "./helpers";

/**
 * Ops "Partner leads" against the REAL local stack (Kiorex API :4000, Passport :4400, ops :5181). Leads are created through the real signed
 * partner endpoint, so nothing is mocked. Covers the list, filters, status change, assignee, notes, funnel, the lead-alert settings and the
 * unread nav badge, AR/EN (RTL), light/dark, 390 and 1440 widths and axe. Screenshots: _docs/test-flow/partner-leads/.
 */
const SECRET = process.env.PARTNER_LEAD_SIGNING_SECRET ?? "kiorex-dev-lead-signing-secret";
const SHOTS = process.env.SHOTS_DIR ? path.join(process.env.SHOTS_DIR, "partner-leads") : path.resolve(process.cwd(), "../../../_docs/test-flow/partner-leads"); // SHOTS_DIR: write elsewhere so a run never rewrites the tracked screenshots;
const AXE = [process.env.AXE_CORE_PATH, path.resolve(process.cwd(), "../../../kiorex-account/node_modules/axe-core/axe.min.js"), path.resolve(process.cwd(), "../../node_modules/axe-core/axe.min.js")].filter(Boolean).find((p) => existsSync(p as string)) as string | undefined;
const RUN = Date.now().toString(36);

async function postLead(request: import("@playwright/test").APIRequestContext, o: { kind: string; name: string; contact: string; note?: string }) {
  const orgRef = `e2e_${RUN}_${o.kind.toLowerCase()}_${Math.random().toString(36).slice(2, 6)}`;
  const body = JSON.stringify({ nonce: newIntakeNonce(), kind: o.kind, orgRef, orgName: o.name, contactName: o.contact, phone: "+201000007777", preferredTime: "MORNING", note: o.note, consent: true, locale: "en", market: "EG" });
  const ts = Math.floor(Date.now() / 1000);
  const sig = `sha256=${createHmac("sha256", deriveIntakeSigningKey(SECRET)).update(`${ts}.${body}`).digest("hex")}`;
  const r = await request.post(`${API}/api/v1/partners/v1/leads`, { data: body, headers: { "content-type": "application/json", "X-Kiorly-Timestamp": String(ts), "X-Kiorly-Signature": sig } });
  expect(r.status(), await r.text()).toBe(200);
  return orgRef;
}
async function axeSerious(page: Page) {
  await page.addScriptTag({ path: AXE! });
  return page.evaluate(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await (window as any).axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return r.violations.filter((v: any) => v.impact === "serious" || v.impact === "critical").map((v: any) => `${v.id}: ${v.nodes.slice(0, 3).map((n: any) => n.target.join(" ")).join(" | ")}`);
  });
}
const prefs = ([l, t]: string[]) => { try { localStorage.setItem("kx-lang", l!); localStorage.setItem("kx-theme", t!); } catch { /* storage unavailable */ } };

test.describe.configure({ mode: "serial" });
test.describe("ops partner leads (real stack)", () => {
  test.setTimeout(180_000);
  let clinic: string; let lab: string;
  test.beforeAll(async ({ request }) => {
    mkdirSync(SHOTS, { recursive: true });
    clinic = `Nile Test Clinic ${RUN}`; lab = `Delta Test Lab ${RUN}`;
    await postLead(request, { kind: "CLINIC", name: clinic, contact: "Dr Hoda", note: "Call after 10" });
    await postLead(request, { kind: "LAB", name: lab, contact: "Eng Karim" });
  });

  test("unread badge, list, filters, status, assignee, note and funnel (EN, light, 1440)", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(prefs, ["en", "light"]);
    await signIn(page, "/flags");
    await page.goto("/partner-leads"); // the first visit also registers this ops person for lead alerts
    await page.getByRole("heading", { name: "Partner leads" }).first().waitFor();
    // the badge was counted for new leads the person had not opened; after opening the page it is gone
    await expect(page.getByTestId("nav-leads-badge")).toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByText(clinic)).toBeVisible(); await expect(page.getByText(lab)).toBeVisible();
    await page.screenshot({ path: path.join(SHOTS, "leads-en-light-1440.png"), fullPage: true });
    // funnel
    await expect(page.getByTestId("leads-funnel")).toBeVisible();
    expect(Number(await page.getByTestId("funnel-count-interested").innerText())).toBeGreaterThanOrEqual(2);
    // filters
    await page.getByTestId("leads-filter-kind").selectOption("LAB");
    await expect(page.getByText(lab)).toBeVisible(); await expect(page.getByText(clinic)).toHaveCount(0);
    await page.getByTestId("leads-filter-kind").selectOption("");
    await page.getByTestId("leads-filter-status").selectOption("CONTACTED");
    await expect(page.getByText(clinic)).toHaveCount(0);
    await page.getByTestId("leads-filter-status").selectOption("");
    // detail: status, assignee, note
    await page.getByRole("button", { name: clinic }).click();
    const detail = page.locator('[data-testid^="lead-detail-"]'); await expect(detail).toBeVisible();
    const id = (await detail.getAttribute("data-testid"))!.replace("lead-detail-", "");
    await page.getByTestId(`lead-status-${id}`).selectOption("CONTACTED");
    await expect(page.getByTestId(`lead-chip-${id}`)).toHaveText(/Contacted/i);
    await page.getByTestId(`lead-assignee-${id}`).fill(`sara.${RUN}`); await page.getByRole("button", { name: "Assign" }).click();
    await expect(page.getByRole("cell", { name: `sara.${RUN}` })).toBeVisible();
    await page.getByTestId(`lead-note-${id}`).fill(`Booked a call ${RUN}`); await page.getByRole("button", { name: "Add" }).click();
    await expect(page.getByText(`Booked a call ${RUN}`)).toBeVisible();
    await page.getByTestId("leads-filter-status").selectOption("CONTACTED"); await expect(page.getByText(clinic)).toBeVisible();
    await page.screenshot({ path: path.join(SHOTS, "leads-detail-en-light-1440.png"), fullPage: true });
    await page.reload(); await expect(page.getByText(clinic)).toBeVisible(); // persisted on the server
  });

  test("lead alert settings: the signed-in super admin is listed and can switch a channel", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(prefs, ["en", "light"]);
    await signIn(page, "/partner-leads");
    await page.getByText("Alert settings").click();
    await expect(page.getByTestId("alerts-enabled")).toBeChecked();
    await expect(page.locator('[data-testid^="alerts-recipient-"]').first()).toBeVisible();
    const push = page.getByTestId("alerts-channel-PUSH"); await expect(push).toBeEnabled();
    await push.click(); await expect(push).not.toBeChecked(); await push.click(); await expect(push).toBeChecked(); // saved on the server, then re-read
    await page.screenshot({ path: path.join(SHOTS, "alerts-en-light-1440.png"), fullPage: true });
  });

  test("a new lead raises the unread badge on the nav", async ({ page, request }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(prefs, ["en", "light"]);
    await signIn(page, "/flags");
    await postLead(request, { kind: "PHARMACY", name: `Badge Pharmacy ${RUN}`, contact: "Ph Mona" });
    await page.reload();
    await expect(page.getByTestId("nav-leads-badge").first()).toHaveText(/^[1-9]/, { timeout: 40_000 });
    await page.screenshot({ path: path.join(SHOTS, "nav-badge-en-light-1440.png") });
    await page.goto("/partner-leads"); await expect(page.getByTestId("nav-leads-badge")).toHaveCount(0, { timeout: 15_000 });
  });

  for (const lang of ["ar", "en"]) for (const theme of ["light", "dark"]) for (const width of [390, 1440]) {
    test(`renders ${lang} ${theme} at ${width}px without overflow, RTL where Arabic, axe clean`, async ({ page }) => {
      test.skip(!AXE, "axe-core not found (set AXE_CORE_PATH)");
      await page.setViewportSize({ width, height: width < 600 ? 844 : 900 });
      await page.addInitScript(prefs, [lang, theme]);
      await signIn(page, "/partner-leads");
      await page.getByTestId("leads-funnel").waitFor();
      await expect(page.locator("html")).toHaveAttribute("dir", lang === "ar" ? "rtl" : "ltr");
      await expect(page.locator("html")).toHaveClass(theme === "dark" ? /dark/ : /^(?!.*dark)/);
      await page.getByRole("button", { name: lab }).click();
      await page.getByText(lang === "ar" ? "إعدادات التنبيهات" : "Alert settings").click();
      await page.waitForTimeout(700);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, "page-level horizontal overflow").toBeLessThanOrEqual(0);
      expect(await axeSerious(page)).toEqual([]);
      await page.screenshot({ path: path.join(SHOTS, `leads-${lang}-${theme}-${width}.png`), fullPage: true });
    });
  }
});
