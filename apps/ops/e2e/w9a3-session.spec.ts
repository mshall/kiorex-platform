import { writeFileSync } from "node:fs";
import { test } from "@playwright/test";
import { OPS_A, signInAs } from "./growth-helpers";

/** Utility, not a test of a page: signs the seeded ops persona in through the real Passport on the shared Vite (read only) and writes the oidc session JSON for PW_SESSION_JSON. */
test("capture the Passport session of the ops persona", async ({ page }) => {
  await signInAs(page, OPS_A, "/growth");
  const json = await page.evaluate(() => { const k = Object.keys(sessionStorage).find((x) => x.startsWith("oidc.user:")); return k ? sessionStorage.getItem(k) : null; });
  if (!json) throw new Error("no oidc session");
  writeFileSync(process.env.SESSION_OUT ?? "/tmp/w9a3-session.json", json);
});
