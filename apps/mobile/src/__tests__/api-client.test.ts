// Regression: openapi-fetch (>=0.17) throws "onResponse: must return new Response() when modifying the response" if a middleware
// returns anything but a global Response. On React Native, fetch returns its own Response class, so the middleware must return nothing.
import { api, configureApi } from "@/api/client";

describe("api client middleware", () => {
  const original = globalThis.fetch;
  afterEach(() => { globalThis.fetch = original; });

  it("does not throw on a 200 and leaves the response untouched", async () => {
    // A Response-like object that is NOT instanceof the global Response (what RN's fetch yields).
    const foreign = { ok: true, status: 200, url: "http://x/api/v1/specialties", headers: new Headers({ "content-type": "application/json" }), clone() { return this; }, json: async () => [{ code: "x" }], text: async () => "[]" } as unknown as Response;
    configureApi({ getToken: async () => null });
    const res = await api.GET("/api/v1/specialties", { fetch: async () => foreign });
    expect(res.response).toBe(foreign);
  });

  it("calls onUnauthorized on 401 without throwing", async () => {
    const onUnauthorized = jest.fn();
    configureApi({ getToken: async () => null, onUnauthorized });
    const foreign = { ok: false, status: 401, url: "http://x", headers: new Headers({ "content-type": "application/json" }), clone() { return this; }, json: async () => ({}), text: async () => "{}" } as unknown as Response;
    await api.GET("/api/v1/specialties", { fetch: async () => foreign });
    expect(onUnauthorized).toHaveBeenCalled();
  });
});
