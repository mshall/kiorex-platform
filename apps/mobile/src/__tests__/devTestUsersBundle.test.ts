import { execFileSync } from "node:child_process";
import path from "node:path";
import { DEV_PATIENTS, DEV_OTP } from "../dev/testUsers";

describe("DEV ONLY test users (patient sign-in)", () => {
  it("lists only the synthetic +2010000010xx personas and the documented dev OTP", () => {
    expect(DEV_OTP).toBe("000000");
    expect(DEV_PATIENTS.length).toBeGreaterThanOrEqual(12);
    for (const p of DEV_PATIENTS) expect(p.phone).toMatch(/^\+2010000010\d\d$/);
  });
  it("are absent from a production bundle (and present in a dev export)", () => {
    expect(() => execFileSync("node", [path.join(__dirname, "../../scripts/check-no-dev-test-users.mjs")], { stdio: "pipe" })).not.toThrow();
  }, 240_000);
});
