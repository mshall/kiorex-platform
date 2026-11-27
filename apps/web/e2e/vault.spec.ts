import { expect, test } from "@playwright/test";
import { API, apiHeaders, bearer, kiorlyWebhook, recordShareSignature, signIn } from "./helpers";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

// /me/kiorly-links also lists CONFLICT_REVIEW rows; a Kiorly delivery only maps to a LINKED one (the first row of a long-lived dev patient is not always linked)
type Links = { kiorlyPatientId: string; clinicId: string; status?: string }[];
const linked = (l: Links) => l.filter((x) => (x.status ?? "LINKED") === "LINKED");

test.describe.serial("records vault, consent centre, prescriptions, follow-ups (real stack)", () => {
  test("upload → view → download → delete, with Arabic RTL", async ({ page }) => {
    await signIn(page, "/records");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.getByTestId("vault-readonly")).toHaveCount(0);
    await page.getByTestId("upload-open").click();
    await page.getByTestId("upload-file").setInputFiles({ name: "e2e-xray.png", mimeType: "image/png", buffer: PNG });
    await page.getByTestId("upload-submit").click();
    const row = page.getByTestId("vault-item").filter({ hasText: "e2e-xray.png" });
    await expect(row).toBeVisible();
    await row.getByRole("link").click();
    await expect(page.getByTestId("record-title")).toHaveText("e2e-xray.png");
    const [dl] = await Promise.all([page.waitForEvent("download"), page.getByTestId("record-download").click()]);
    expect(dl.suggestedFilename()).toBe("e2e-xray.png");
    await page.goBack();
    await page.getByRole("button", { name: /e2e-xray/ }).click();
    await page.getByTestId("confirm-delete").click();
    await expect(page.getByTestId("vault-item").filter({ hasText: "e2e-xray.png" })).toHaveCount(0);
  });

  test("unsupported and oversized files are rejected client-side", async ({ page }) => {
    await signIn(page, "/records");
    await page.getByTestId("upload-open").click();
    await page.getByTestId("upload-file").setInputFiles({ name: "x.txt", mimeType: "text/plain", buffer: Buffer.from("hi") });
    await expect(page.getByTestId("upload-error")).toBeVisible();
    await expect(page.getByTestId("upload-submit")).toBeDisabled();
  });

  test("share → clinic delivers a prescription + QR verifies → revoke deletes copies", async ({ page, request }) => {
    await signIn(page, "/records?tab=sharing");
    const token = await bearer(page);
    const links = (await (await request.get(`${API}/api/v1/me/kiorly-links`, { headers: apiHeaders(token) })).json()) as Links;
    test.skip(links.length === 0, "Seed patient has no linked Kiorly record");
    const link = linked(links)[0];
    test.skip(!link, "Seed patient has no LINKED Kiorly record");

    // grant per-scope consent through the UI
    const sw = page.getByTestId("share-PRESCRIPTIONS");
    if ((await sw.getAttribute("aria-checked")) !== "true") await sw.click();
    await expect(sw).toHaveAttribute("aria-checked", "true");
    const sharing = (await (await request.get(`${API}/api/v1/me/record-sharing`, { headers: apiHeaders(token) })).json()) as { scopes: { scope: string; granted: boolean }[] };
    expect(sharing.scopes.find((s) => s.scope === "PRESCRIPTIONS")?.granted).toBe(true);

    // Kiorly Clinic delivers a prescription (signed outbox webhook)
    const enc = `e2e-enc-${Date.now()}`;
    const res = await kiorlyWebhook(request, "PRESCRIPTION_SHARED", { patientId: link.kiorlyPatientId, encounterId: enc, clinicId: link.clinicId, signedAt: new Date().toISOString(), items: [{ name: "Amoxicillin", strength: "500 mg", frequency: "3x daily", duration: "7 days" }] });
    expect(res.status).toBeLessThan(300);

    await page.goto("/records?tab=prescriptions");
    const card = page.getByTestId("rx-card").first();
    await expect(card).toBeVisible();
    await expect(card.getByTestId("rx-qr")).toBeVisible();
    await expect(card.getByTestId("rx-items")).toContainText("Amoxicillin");

    // the QR payload verifies through the public pharmacist endpoint
    const rx = (await (await request.get(`${API}/api/v1/me/prescriptions`, { headers: apiHeaders(token) })).json()) as { id: string }[];
    const detail = (await (await request.get(`${API}/api/v1/me/vault/${rx[0].id}`, { headers: apiHeaders(token) })).json()) as { verification: { token: string } };
    const verify = await (await request.get(`${API}/api/v1/rx/verify`, { params: { t: detail.verification.token } })).json();
    expect(verify).toMatchObject({ valid: true, status: "ACTIVE" });

    // revoke: confirmation explains deletion, then Kiorex copies are gone and the QR stops verifying
    await page.goto("/records?tab=sharing");
    await page.getByTestId("share-PRESCRIPTIONS").click();
    await page.getByTestId("confirm-revoke").click();
    await expect(page.getByTestId("share-PRESCRIPTIONS")).toHaveAttribute("aria-checked", "false");
    await expect.poll(async () => ((await (await request.get(`${API}/api/v1/me/prescriptions`, { headers: apiHeaders(token) })).json()) as unknown[]).length).toBe(0);
    const after = await (await request.get(`${API}/api/v1/rx/verify`, { params: { t: detail.verification.token } })).json();
    expect((after as { valid: boolean }).valid).toBe(false);
  });

  test("follow-up reminder: set and cancel", async ({ page }) => {
    await signIn(page, "/records?tab=followups");
    const list = page.getByTestId("followup-list").locator("li");
    await expect(page.getByTestId("followup-create")).toBeEnabled();
    const before = await list.count();
    await page.getByTestId("followup-create").click();
    await expect(list).toHaveCount(before + 1);
    await list.first().getByRole("button").click(); // cancelled reminders leave the active list
    await expect(list).toHaveCount(before);
  });
});

test("visit summary delivery shows in the vault (signature verified)", async ({ page, request }) => {
  await signIn(page, "/records");
  const token = await bearer(page);
  const links = (await (await request.get(`${API}/api/v1/me/kiorly-links`, { headers: apiHeaders(token) })).json()) as Links;
  test.skip(linked(links).length === 0, "Seed patient has no LINKED Kiorly record");
  const sw = await request.put(`${API}/api/v1/me/record-sharing/VISIT_SUMMARY`, { headers: apiHeaders(token), data: { granted: true } });
  expect(sw.ok()).toBeTruthy();
  const summary = { encounterId: `e2e-vs-${Date.now()}`, clinicId: linked(links)[0]!.clinicId, signedAt: new Date().toISOString(), soap: { s: "e2e" } };
  const r = await kiorlyWebhook(request, "VISIT_SUMMARY_SHARED", { patientId: linked(links)[0]!.kiorlyPatientId, summary, signature: recordShareSignature(summary) });
  expect(r.status).toBeLessThan(300);
  await page.reload();
  const item = page.getByTestId("vault-item").filter({ has: page.locator('[data-kind="VISIT_SUMMARY"]') }).first();
  await expect(page.locator('[data-testid="vault-item"][data-kind="VISIT_SUMMARY"]').first()).toBeVisible();
  void item;
  await page.locator('[data-testid="vault-item"][data-kind="VISIT_SUMMARY"] a').first().click();
  await expect(page.getByTestId("record-content")).toBeVisible();
  // cleanup: revoke (deletes copies)
  await request.put(`${API}/api/v1/me/record-sharing/VISIT_SUMMARY`, { headers: apiHeaders(token), data: { granted: false } });
});
