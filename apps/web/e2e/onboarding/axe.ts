import { existsSync } from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";

export const AXE = [process.env.AXE_CORE_PATH, path.resolve(process.cwd(), "../../node_modules/axe-core/axe.min.js"), path.resolve(process.cwd(), "../../../kiorex-account/node_modules/axe-core/axe.min.js")].filter(Boolean).find((p) => existsSync(p as string)) as string | undefined;
export async function axe(page: Page) {
  await page.waitForTimeout(900); // the page fade-in (kx-page-in) blends colours while it runs
  await page.addScriptTag({ path: AXE! });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return page.evaluate(async () => (await (window as any).axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] }, rules: { "color-contrast": { enabled: true } } })).violations.map((v: any) => `${v.id}: ${v.nodes.slice(0, 3).map((n: any) => n.target.join(" ") + " [" + (n.any[0]?.message ?? "") + "]").join(" | ")}`));
}
