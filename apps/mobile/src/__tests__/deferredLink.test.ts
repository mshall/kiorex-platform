import AsyncStorage from "@react-native-async-storage/async-storage";
import { claimCode, readInstallReferrerOnce } from "@/lib/deferred-link";
import { clearPendingRef, getPendingRef, sendPendingTouch, setPendingRef, touchBody } from "@/lib/linkRef";
import { setGrowthConsent, setGrowthConsentReader, getGrowthConsent } from "@/lib/growthConsent";

jest.mock("@/lib/config", () => ({ config: { apiOrigin: "https://api.example.test" } }));

beforeEach(async () => { await AsyncStorage.clear(); });

describe("Android install referrer (deferred deep link)", () => {
  it("reads once, parses strictly and only stores a pending ref (nothing is sent)", async () => {
    const get = jest.fn(async () => "utm_source=google-play&utm_medium=organic&kxref=p.7XK2M9QP");
    const f = jest.fn();
    const ref = await readInstallReferrerOnce("android", () => ({ getInstallReferrerAsync: get }));
    expect(ref).toEqual({ kind: "provider", code: "7XK2M9QP" });
    expect(await getPendingRef()).toEqual(ref);
    expect(f).not.toHaveBeenCalled();
    expect(await readInstallReferrerOnce("android", () => ({ getInstallReferrerAsync: get }))).toBeNull(); // second launch: never read again
    expect(get).toHaveBeenCalledTimes(1);
  });
  it("iOS and web never read a referrer; a failing module is a quiet null and still counts as read", async () => {
    const get = jest.fn(async () => "kxref=r.AB12CD34");
    expect(await readInstallReferrerOnce("ios", () => ({ getInstallReferrerAsync: get }))).toBeNull();
    expect(get).not.toHaveBeenCalled();
    expect(await readInstallReferrerOnce("android", () => ({ getInstallReferrerAsync: async () => { throw new Error("no play"); } }))).toBeNull();
    expect(await readInstallReferrerOnce("android", () => ({ getInstallReferrerAsync: get }))).toBeNull();
  });
  it("a hostile referrer string stores nothing", async () => {
    expect(await readInstallReferrerOnce("android", () => ({ getInstallReferrerAsync: async () => "kxref=https%3A%2F%2Fevil.example" }))).toBeNull();
    expect(await getPendingRef()).toBeNull();
  });
});

describe("claim code (iOS)", () => {
  it("stores a valid code and rejects an invalid one", async () => {
    expect(await claimCode("7xk2 m9qp")).toEqual({ kind: "provider", code: "7XK2M9QP" });
    expect(await getPendingRef()).toEqual({ kind: "provider", code: "7XK2M9QP" });
    await clearPendingRef();
    expect(await claimCode("https://evil.example")).toBeNull();
    expect(await getPendingRef()).toBeNull();
  });
});

describe("touch is sent only after consent", () => {
  const ok = () => jest.fn(async () => ({ status: 200 }) as Response);
  it("undecided and denied: no network call, the ref stays held", async () => {
    await setPendingRef({ kind: "referral", code: "AB12CD34" });
    const f = ok();
    expect(await sendPendingTouch(f as never)).toBe("no-consent");
    await setGrowthConsent("denied");
    expect(await sendPendingTouch(f as never)).toBe("no-consent");
    expect(f).not.toHaveBeenCalled();
  });
  it("granted: one POST with only the landing kind and the public code, then cleared", async () => {
    await setPendingRef({ kind: "provider", code: "7XK2M9QP" });
    await setGrowthConsent("granted");
    const f = ok();
    expect(await sendPendingTouch(f as never)).toBe("sent");
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.example.test/api/v1/growth/v1/touch");
    expect(JSON.parse(init.body as string)).toEqual({ landingKind: "PROVIDER_LINK", ref: "7XK2M9QP" });
    expect(Object.keys(init.headers as object).map((k) => k.toLowerCase())).not.toContain("authorization"); // never tied to the account
    expect(await sendPendingTouch(f as never)).toBe("none");
    expect(touchBody({ kind: "referral", code: "AB12CD34" })).toEqual({ landingKind: "REFERRAL", ref: "AB12CD34" });
  });
  it("a server error keeps the ref for a retry, a 4xx drops it", async () => {
    await setGrowthConsent("granted");
    await setPendingRef({ kind: "referral", code: "AB12CD34" });
    expect(await sendPendingTouch((async () => ({ status: 503 })) as never)).toBe("retry");
    expect(await getPendingRef()).not.toBeNull();
    expect(await sendPendingTouch((async () => { throw new Error("offline"); }) as never)).toBe("retry");
    expect(await sendPendingTouch((async () => ({ status: 400 })) as never)).toBe("sent");
    expect(await getPendingRef()).toBeNull();
  });
  it("the consent package can replace the reader", async () => {
    setGrowthConsentReader(async () => "granted");
    expect(await getGrowthConsent()).toBe("granted");
    setGrowthConsentReader(async () => null);
    expect(await getGrowthConsent()).toBeNull();
  });
  it("expired pending refs (older than 30 days) are ignored", async () => {
    await setPendingRef({ kind: "referral", code: "AB12CD34" }, Date.now() - 31 * 24 * 3600_000);
    expect(await getPendingRef()).toBeNull();
  });
});
