import type { Page, Route } from "@playwright/test";

/** Mock Passport + mock API for the landing / entry / onboarding specs (no real stack needed). Everything the specs assert on is recorded in `state`. */
export const PASSPORT = "http://localhost:4400";
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (payload: Record<string, unknown>) => `${b64({ alg: "none", typ: "JWT" })}.${b64(payload)}.sig`;
const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

export interface MockState {
  authorizeQuery: URLSearchParams | null; authorizeCount: number; cancel: boolean;
  profile: Record<string, unknown>; prefs: { reminders: { consent: boolean; updatedAt: string | null }; analytics: { consent: boolean; textVersion: string | null; updatedAt: string | null }; marketing: Record<string, boolean> };
  profilePuts: Record<string, unknown>[]; prefsPuts: Record<string, unknown>[]; failNextProfilePut: boolean; marketLive: boolean;
}
export function newState(over: Partial<MockState> = {}): MockState {
  return {
    authorizeQuery: null, authorizeCount: 0, cancel: false,
    profile: { id: "p1", sub: "sub-new", phone: "+201000000000", email: null, nameEn: null, nameAr: null, dateOfBirth: null, gender: null, nationalIdLast4: null, preferredLocale: "ar", market: "EG", createdAt: new Date(Date.now() - 30_000).toISOString(), hasNationalId: false, noShowCount: 0 },
    prefs: { reminders: { consent: false, updatedAt: null }, analytics: { consent: false, textVersion: null, updatedAt: null }, marketing: {} },
    profilePuts: [], prefsPuts: [], failNextProfilePut: false, marketLive: false, ...over,
  };
}
const prefsView = (s: MockState) => ({ version: 1, draftWording: false, textVersions: { analytics: "v1", marketing: "v1" }, serviceMessages: [], reminders: s.prefs.reminders, analytics: s.prefs.analytics,
  marketing: { available: false, anyConsent: false, channels: ["WHATSAPP", "SMS", "EMAIL", "PUSH"].map((channel) => ({ channel, marketingConsent: !!s.prefs.marketing[channel], channelEnabled: true, suppressed: false, quietStart: null, quietEnd: null })) },
  quietHours: { start: null, end: null, defaultStart: 22, defaultEnd: 8, timezone: "Africa/Cairo" }, caps: { perDay: 1, perWeek: 3 }, withdrawalPropagationSeconds: 60 });

export async function mockStack(page: Page, s: MockState) {
  await page.route(`${PASSPORT}/**`, async (route) => {
    const u = new URL(route.request().url());
    if (u.pathname.endsWith("/.well-known/openid-configuration")) return json(route, { issuer: PASSPORT, authorization_endpoint: `${PASSPORT}/auth`, token_endpoint: `${PASSPORT}/token`, jwks_uri: `${PASSPORT}/jwks`, end_session_endpoint: `${PASSPORT}/session/end` });
    if (u.pathname === "/auth") {
      s.authorizeQuery = u.searchParams; s.authorizeCount += 1;
      const redirect = u.searchParams.get("redirect_uri")!; const state = u.searchParams.get("state")!;
      const loc = s.cancel ? `${redirect}?error=access_denied&state=${state}` : `${redirect}?code=abc&state=${state}`;
      return route.fulfill({ status: 302, headers: { location: loc } });
    }
    if (u.pathname === "/token") {
      const now = Math.floor(Date.now() / 1000); const nonce = s.authorizeQuery?.get("nonce");
      const claims = { iss: PASSPORT, sub: String(s.profile.sub), aud: "kiorex-web", exp: now + 900, iat: now, nonce, name: "Test" };
      return json(route, { access_token: jwt({ ...claims, kx_roles: ["patient"] }), token_type: "Bearer", id_token: jwt(claims), expires_in: 900, scope: "openid profile phone email" });
    }
    return json(route, {});
  });
  await page.route("**/api/v1/**", async (route) => {
    const req = route.request(); const u = new URL(req.url()); const p = u.pathname; const m = req.method();
    if (p.endsWith("/me/profile")) {
      if (m === "PUT") { if (s.failNextProfilePut) { s.failNextProfilePut = false; return json(route, { code: "BOOM", message: "x" }, 500); } const b = req.postDataJSON() as Record<string, unknown>; s.profilePuts.push(b); s.profile = { ...s.profile, ...b }; }
      return json(route, s.profile);
    }
    if (p.endsWith("/me/preferences")) {
      if (m === "PUT") {
        const b = req.postDataJSON() as { analytics?: boolean; reminders?: boolean; marketing?: Record<string, boolean> }; s.prefsPuts.push(b); const at = new Date().toISOString();
        if (b.analytics !== undefined) s.prefs.analytics = { consent: b.analytics, textVersion: "v1", updatedAt: at };
        if (b.reminders !== undefined) s.prefs.reminders = { consent: b.reminders, updatedAt: at };
        if (b.marketing) s.prefs.marketing = { ...s.prefs.marketing, ...b.marketing };
      }
      return json(route, prefsView(s));
    }
    if (p.endsWith("/markets")) return json(route, [{ code: "EG", live: s.marketLive, flag: "market.eg.live", state: s.marketLive ? "LIVE" : "AWAITING_GATE" }]);
    if (p.endsWith("/flags/effective")) return json(route, { flags: {} });
    if (p.endsWith("/me/dependants") || p.endsWith("/me/notifications") || p.endsWith("/specialties") || p.endsWith("/care-types")) return json(route, []);
    if (p.endsWith("/bookings") && m === "GET") return json(route, []);
    return json(route, {});
  });
}
