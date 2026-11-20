// Push registration UI plumbing: enable -> POST /me/devices, disable -> DELETE /me/devices/{id}; fail-soft on denial.
const mockPost = jest.fn();
const mockDel = jest.fn();
jest.mock("@/api/client", () => ({
  api: { POST: (...a: unknown[]) => mockPost(...a), DELETE: (...a: unknown[]) => mockDel(...a) },
  send: async (p: Promise<{ data?: unknown; response: { ok: boolean; status: number } }>) => { const r = await p; if (!r.response.ok) throw Object.assign(new Error("x"), { status: r.response.status }); return r.data; },
}));
jest.mock("expo-notifications", () => ({
  getPermissionsAsync: async () => ({ granted: true }), requestPermissionsAsync: async () => ({ granted: true }),
  getDevicePushTokenAsync: async () => ({ data: "native-device-token-0123456789" }),
}));
jest.mock("expo-constants", () => ({ __esModule: true, default: { expoConfig: { version: "1.2.3" } } }));

import { disablePush, enablePush, pushEnabledLocally, pushPlatform } from "@/lib/push";

beforeEach(() => { mockPost.mockReset(); mockDel.mockReset(); });

describe("push registration (mobile settings toggle)", () => {
  it("registers this device through /me/devices and remembers its id", async () => {
    mockPost.mockResolvedValue({ data: { id: "dev1" }, response: { ok: true, status: 201 } });
    const r = await enablePush("en");
    expect(r).toEqual({ ok: true, deviceId: "dev1" });
    expect(mockPost).toHaveBeenCalledWith("/api/v1/me/devices", { body: expect.objectContaining({ platform: pushPlatform(), token: "native-device-token-0123456789", locale: "en", appVersion: "1.2.3" }) });
    expect(await pushEnabledLocally()).toBe("dev1");
  });
  it("reports failure without throwing when the API rejects", async () => {
    mockPost.mockResolvedValue({ data: undefined, response: { ok: false, status: 500 } });
    await expect(enablePush("ar")).resolves.toEqual({ ok: false, reason: "failed" });
  });
  it("removes the device and clears the local flag", async () => {
    mockDel.mockResolvedValue({ data: { ok: true }, response: { ok: true, status: 200 } });
    await expect(disablePush("dev1")).resolves.toBe(true);
    expect(mockDel).toHaveBeenCalledWith("/api/v1/me/devices/{id}", { params: { path: { id: "dev1" } } });
    expect(await pushEnabledLocally()).toBeNull();
  });
  it("treats an already-removed device (404) as disabled", async () => {
    mockDel.mockResolvedValue({ data: undefined, response: { ok: false, status: 404 } });
    await expect(disablePush("gone")).resolves.toBe(true);
  });
});
