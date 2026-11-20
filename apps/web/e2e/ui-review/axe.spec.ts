import { expect, test, type Page } from "@playwright/test";
import { existsSync } from "node:fs";
import path from "node:path";
import { signIn } from "../helpers";

/** axe-core a11y gate on key screens, AR+EN x light+dark. axe-core is not a dependency of this repo: set AXE_CORE_PATH to axe.min.js
 *  (defaults to the copy in the sibling kiorex-account checkout) and the suite skips when it is missing. */
const CANDIDATES = [process.env.AXE_CORE_PATH, path.resolve(process.cwd(), "../../../kiorex-account/node_modules/axe-core/axe.min.js"), path.resolve(process.cwd(), "../../node_modules/axe-core/axe.min.js")].filter(Boolean) as string[];
const AXE = CANDIDATES.find((p) => existsSync(p));
const PAGES: string[] = ["/", "/search", "/appointments", "/records", "/services", "/account", "/pharmacy", "/lab"];
const LANGS = ["ar", "en"], THEMES = ["light", "dark"];

async function scan(page: Page) {
  await page.addScriptTag({ path: AXE! });
  return page.evaluate(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await (window as any).axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return r.violations.map((v: any) => ({ id: v.id, impact: v.impact, nodes: v.nodes.slice(0, 3).map((n: any) => n.target.join(" ")) }));
  });
}

test.describe("axe", () => {
  test.skip(!AXE, "axe-core not found (set AXE_CORE_PATH)");
  test.setTimeout(300_000);
  for (const lang of LANGS) for (const theme of THEMES) {
    test(`no serious violations ${lang} ${theme}`, async ({ page }) => {
      await page.addInitScript(([l, t]) => { try { localStorage.setItem("kx-lang", l); localStorage.setItem("kx-theme", t); } catch { /* storage unavailable */ } }, [lang, theme]);
      await signIn(page, PAGES[0]);
      const bad: string[] = [];
      for (const u of PAGES) {
        await page.goto(u); await page.waitForTimeout(900);
        const v = await scan(page);
        for (const x of v.filter((y: { impact: string }) => y.impact === "serious" || y.impact === "critical")) bad.push(`${u} ${x.id} (${x.impact}) ${x.nodes.join(" | ")}`);
      }
      expect(bad, bad.join("\n")).toEqual([]);
    });
  }
});
