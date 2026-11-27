import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

describe("no test-user or demo panel on the patient sign-in", () => {
  it("has no dev folder and the sign-in screen does not load one", () => {
    expect(existsSync(path.join(__dirname, "../dev"))).toBe(false);
    const src = readFileSync(path.join(__dirname, "../../app/sign-in.tsx"), "utf8");
    expect(src).not.toMatch(/DevTestUsers|dev\/|mockNote/);
  });
  it("is absent from the production bundle and the dev export", () => {
    expect(() => execFileSync("node", [path.join(__dirname, "../../scripts/check-no-dev-test-users.mjs")], { stdio: "pipe" })).not.toThrow();
  }, 240_000);
});
