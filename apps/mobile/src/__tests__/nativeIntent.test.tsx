import AsyncStorage from "@react-native-async-storage/async-storage";
import { redirectSystemPath } from "../../app/+native-intent";
import { getPendingRef } from "@/lib/linkRef";
import { peekPendingRoute, setPendingRoute, takePendingRoute } from "@/lib/pendingRoute";

jest.mock("@/lib/config", () => ({ config: { apiOrigin: "https://api.example.test" } }));
const go = (path: string) => redirectSystemPath({ path, initial: true });
beforeEach(async () => { await AsyncStorage.clear(); setPendingRoute(null); await AsyncStorage.setItem("kx.bootstrap.v1", JSON.stringify({ at: Date.now(), b: { defaultMarket: "EG", liveMarkets: ["EG"], showMarketSelector: false, locales: ["ar", "en"] } })); });

describe("native intent handler (all incoming links)", () => {
  it("maps doctor, clinic, referral and provider links to in-app routes", async () => {
    expect(await go("https://kiorex.com/ar/eg/doctor/dr-amira-samy")).toBe("/doctor/dr-amira-samy");
    expect(await go("https://kiorex.com/en/eg/clinic/al-nour")).toBe("/results?q=al%20nour");
    expect(await go("https://kiorex.com/r/AB12CD34")).toBe("/r/AB12CD34");
    expect(await go("https://kiorex.com/q/7xk2m9qp")).toBe("/r/7XK2M9QP?k=p");
    expect(await go("kiorex://claim")).toBe("/claim");
  });
  it("a referral link only becomes a pending ref on the device (no network)", async () => {
    const f = jest.spyOn(globalThis, "fetch");
    await go("https://kiorex.com/r/AB12CD34");
    expect(await getPendingRef()).toEqual({ kind: "referral", code: "AB12CD34" });
    expect(f).not.toHaveBeenCalled();
    f.mockRestore();
  });
  it("an appointment link opens Home and is held for after sign-in: it never signs in or reaches the screen directly", async () => {
    expect(await go("https://kiorex.com/appointment/apt_123")).toBe("/");
    expect(peekPendingRoute()).toBe("/appointment/apt_123");
    expect(takePendingRoute()).toBe("/appointment/apt_123");
    expect(takePendingRoute()).toBeNull();
  });
  it("unknown and malicious links open Home and store nothing", async () => {
    for (const p of ["https://evil.example/r/AB12CD34", "https://kiorex.com/ar/eg/doctor/..%2f..%2fx", "javascript:alert(1)", "/ar/eg/doctor/x?to=https://evil.example/x", "//evil.example", "https://kiorex.com/unknown"]) {
      const out = await go(p);
      expect(out === "/" || out === "/doctor/x").toBe(true);
      expect(out).not.toMatch(/evil|\/\//);
    }
    expect(await getPendingRef()).toBeNull();
    expect(peekPendingRoute()).toBeNull();
  });
  it("a link market that is not live falls back to the default market without error", async () => {
    expect(await go("https://kiorex.com/ar/sa/doctor/dr-x")).toBe("/doctor/dr-x");
  });
});
