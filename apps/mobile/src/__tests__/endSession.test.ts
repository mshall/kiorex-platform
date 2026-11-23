import { buildEndSessionUrl, endPassportSession } from "@/auth/endSession";

const mockOpen = jest.fn(async (..._a: unknown[]) => ({ type: "success" }));
jest.mock("expo-web-browser", () => ({ openAuthSessionAsync: (...a: unknown[]) => mockOpen(...a), maybeCompleteAuthSession: jest.fn() }));
jest.mock("expo-auth-session", () => ({
  makeRedirectUri: ({ scheme, path }: { scheme: string; path: string }) => `${scheme}://${path}`,
  fetchDiscoveryAsync: async () => ({ endSessionEndpoint: "http://idp.test/session/end" }),
}));

describe("Passport end-session (sign-out leaves app and IdP consistent)", () => {
  beforeEach(() => mockOpen.mockClear());

  it("builds an RP-initiated logout URL with id_token_hint, client_id and the registered post-logout URI", () => {
    const u = new URL(buildEndSessionUrl("http://idp.test/session/end", { idToken: "a.b.c", clientId: "kiorex-mobile", postLogoutRedirectUri: "kiorex://auth/logout", state: "s1" }));
    expect(u.origin + u.pathname).toBe("http://idp.test/session/end");
    expect(u.searchParams.get("id_token_hint")).toBe("a.b.c");
    expect(u.searchParams.get("client_id")).toBe("kiorex-mobile");
    expect(u.searchParams.get("post_logout_redirect_uri")).toBe("kiorex://auth/logout");
    expect(u.searchParams.get("state")).toBe("s1");
  });

  it("omits the hint when the session has no id token (older sessions)", () => {
    const u = new URL(buildEndSessionUrl("http://idp.test/session/end", { clientId: "kiorex-mobile", postLogoutRedirectUri: "kiorex://auth/logout" }));
    expect(u.searchParams.has("id_token_hint")).toBe(false);
  });

  it("opens the system auth session at the IdP end-session endpoint and never throws", async () => {
    await endPassportSession("a.b.c");
    expect(mockOpen).toHaveBeenCalledTimes(1);
    const [url, redirect] = mockOpen.mock.calls[0] as [string, string];
    expect(url).toContain("http://idp.test/session/end?id_token_hint=a.b.c");
    expect(redirect).toBe("kiorex://auth/logout");
    mockOpen.mockRejectedValueOnce(new Error("offline"));
    await expect(endPassportSession("a.b.c")).resolves.toBeUndefined();
  });
});
