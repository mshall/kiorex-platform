import AsyncStorage from "@react-native-async-storage/async-storage";
import { cachedBootstrap, loadBootstrap, validBootstrap } from "@/lib/bootstrap";

jest.mock("@/lib/config", () => ({ config: { apiOrigin: "https://api.example.test" } }));
const good = { defaultMarket: "EG", liveMarkets: ["EG"], showMarketSelector: false, locales: ["ar", "en"], apiEndpoint: "https://api.example.test/api/v1", capabilities: { deepLinks: true } };
beforeEach(async () => { await AsyncStorage.clear(); });

describe("bootstrap client", () => {
  it("validates the shape strictly", () => {
    expect(validBootstrap(good)).toBe(true);
    for (const bad of [null, {}, { ...good, defaultMarket: "egypt" }, { ...good, liveMarkets: ["EG", 3] }, { ...good, showMarketSelector: "no" }, "x"]) expect(validBootstrap(bad)).toBe(false);
  });
  it("fetches once, caches, and then serves the cache without a network call", async () => {
    const f = jest.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true, json: async () => good } as Response);
    expect(await loadBootstrap()).toEqual(good);
    expect(await cachedBootstrap()).toEqual(good);
    expect(await loadBootstrap()).toEqual(good);
    expect(f).toHaveBeenCalledTimes(1);
    expect(String(f.mock.calls[0]![0])).toBe("https://api.example.test/api/v1/bootstrap");
    f.mockRestore();
  });
  it("sends only a validated cc hint, never anything else", async () => {
    const f = jest.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true, json: async () => good } as Response);
    await loadBootstrap("sa");
    await loadBootstrap("https://evil.example");
    expect(String(f.mock.calls[0]![0])).toBe("https://api.example.test/api/v1/bootstrap?cc=sa");
    expect(String(f.mock.calls[1]![0])).toBe("https://api.example.test/api/v1/bootstrap");
    f.mockRestore();
  });
  it("network failure or a malformed answer returns the cache or null and never throws", async () => {
    const f = jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    expect(await loadBootstrap()).toBeNull();
    f.mockResolvedValue({ ok: true, json: async () => ({ nope: 1 }) } as Response);
    expect(await loadBootstrap()).toBeNull();
    f.mockRestore();
  });
  it("a cache older than a day is ignored", async () => {
    await AsyncStorage.setItem("kx.bootstrap.v1", JSON.stringify({ at: Date.now() - 25 * 3600_000, b: good }));
    expect(await cachedBootstrap()).toBeNull();
  });
});
