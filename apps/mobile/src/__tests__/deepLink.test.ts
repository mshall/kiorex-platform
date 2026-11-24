import { configuredHosts, HOME, parseClaimCode, parseInstallReferrer, resolveLink } from "@/lib/deepLink";

const o = { hosts: ["kiorex.com", "www.kiorex.com", "kiorly.link"], liveMarkets: ["EG"], defaultMarket: "EG" };
const r = (u: unknown, extra = {}) => resolveLink(u, { ...o, ...extra });

describe("deep link resolution (GRW-P1-H)", () => {
  it.each([
    ["https://kiorex.com/ar/eg/doctor/dr-amira-samy", { kind: "doctor", route: "/doctor/dr-amira-samy", cc: "eg", locale: "ar", requiresSignIn: false }],
    ["https://kiorex.com/en/eg/doctor/clx9a8b7c0001", { kind: "doctor", route: "/doctor/clx9a8b7c0001", locale: "en" }],
    ["https://www.kiorex.com/ar/eg/clinic/al-nour-clinic", { kind: "clinic", route: "/results?q=al%20nour%20clinic" }],
    ["https://kiorex.com/r/AB12CD34", { kind: "referral", route: "/r/AB12CD34", ref: { kind: "referral", code: "AB12CD34" } }],
    ["https://kiorex.com/q/7xk2m9qp", { kind: "provider", route: "/r/7XK2M9QP?k=p", ref: { kind: "provider", code: "7XK2M9QP" } }],
    ["https://kiorly.link/q/7XK2M9QP", { kind: "provider", route: "/r/7XK2M9QP?k=p" }],
    ["https://kiorex.com/appointment/apt_123", { kind: "appointment", route: "/appointment/apt_123", requiresSignIn: true }],
    ["https://kiorex.com/a/apt_123", { kind: "appointment", route: "/appointment/apt_123", requiresSignIn: true }],
    ["kiorex://doctor/dr-amira-samy", { kind: "doctor", route: "/doctor/dr-amira-samy" }],
    ["kiorex://r/AB12CD34?cc=eg", { kind: "referral", cc: "eg" }],
    ["kiorex://claim", { kind: "claim", route: "/claim" }],
    ["/ar/eg/doctor/dr-amira-samy?utm_source=x", { kind: "doctor", route: "/doctor/dr-amira-samy" }],
  ])("%s", (u, want) => { expect(r(u)).toMatchObject(want); });

  it("the existing Passport redirect and family visit-status scheme links keep working, scheme only, standard parameters only", () => {
    expect(r("kiorex://auth/callback?code=abc123&state=xyz&utm=1&to=https%3A%2F%2Fevil.example")).toMatchObject({ kind: "auth", route: "/auth/callback?code=abc123&state=xyz", requiresSignIn: false });
    expect(r("kiorex://auth/logout").route).toBe("/auth/logout");
    expect(r("kiorex://visit-status/abcdEFGH1234").route).toBe("/visit-status/abcdEFGH1234");
    for (const u of ["https://kiorex.com/auth/callback?code=a&state=b", "https://kiorex.com/visit-status/abcdEFGH1234", "kiorex://auth/callback/extra", "kiorex://auth/other", "kiorex://visit-status/short"]) expect(r(u).kind).toBe("home");
    expect(r("kiorex://auth/callback?code=%00bad").route).toBe("/auth/callback");
  });

  it("unknown paths open Home", () => {
    for (const u of ["https://kiorex.com/", "https://kiorex.com/about", "https://kiorex.com/ar/eg", "https://kiorex.com/ar/eg/pharmacy/x", "https://kiorex.com/ar/eg/doctor", "https://kiorex.com/ar/eg/doctor/a/b", "kiorex://unknown/thing", "", "   "]) expect(r(u)).toEqual(HOME);
    for (const u of [undefined, null, 5, {}, [], true]) expect(r(u)).toEqual(HOME);
  });

  it("hosts are an exact allow-list: look-alikes, userinfo, other schemes and http are Home", () => {
    for (const u of [
      "https://evil.example/ar/eg/doctor/x", "https://kiorex.com.evil.example/r/AB12CD34", "https://evilkiorex.com/r/AB12CD34", "https://kiorex.com@evil.example/r/AB12CD34",
      "https://evil.example@kiorex.com/r/AB12CD34", "https://kiorex.com%40evil.example/r/AB12CD34", "https://sub.kiorex.com/r/AB12CD34", "http://kiorex.com/r/AB12CD34",
      "ftp://kiorex.com/r/AB12CD34", "javascript:alert(1)", "data:text/html,x", "intent://kiorex.com/r/AB12CD34#Intent;scheme=https;end", "file:///etc/passwd", "//evil.example/r/AB12CD34", "https://kiorex.com:8443/r/AB12CD34",
    ]) expect({ u, t: r(u).kind }).toEqual({ u, t: "home" });
  });

  it("http is accepted only for localhost in development builds", () => {
    expect(resolveLink("http://localhost:5180/r/AB12CD34", { hosts: ["localhost:5180"], allowInsecureLocal: true }).kind).toBe("referral");
    expect(resolveLink("http://localhost:5180/r/AB12CD34", { hosts: ["localhost:5180"] }).kind).toBe("home");
    expect(resolveLink("http://evil.example/r/AB12CD34", { hosts: ["evil.example"], allowInsecureLocal: true }).kind).toBe("home");
  });

  it("malicious segments never become a route (traversal, encoded separators, double encoding, control characters, scripts, overlong)", () => {
    const bad = ["..", "%2e%2e", "%252e%252e", "a%2fb", "a%5cb", "a%00b", "a%0ab", "<script>alert(1)</script>", "%3Cscript%3E", "a b", "a%20b", "https%3A%2F%2Fevil.example", "javascript%3Aalert(1)", "x".repeat(81), "-lead", "a.b", "د-أمير", "%E0%A4%A"];
    for (const s of bad) for (const kind of ["doctor", "clinic", "appointment", "a"]) expect({ s, kind, t: r(`https://kiorex.com/ar/eg/${kind}/${s}`).kind }).toEqual({ s, kind, t: "home" });
    for (const s of ["abc", "ABC", "AB-CD", "AB12CD3456789ABCD", "%2e%2e", "a%2fb"]) expect(r(`https://kiorex.com/r/${s}`).kind).toBe("home");
    for (const s of ["7XK2M9QI", "7XK2M9QL", "7XK2M9QO", "7XK2M9QU", "7XK2M9Q", "7XK2M9QPP"]) expect(r(`https://kiorex.com/q/${s}`).kind).toBe("home");
    expect(r("https://kiorex.com/ar/eg/doctor/dr-x\u0000y").kind).toBe("home");
    expect(r("https://kiorex.com/ar/eg/doctor/dr-x\\..\\y").kind).toBe("home");
    expect(r(`https://kiorex.com/${"a/".repeat(3000)}`).kind).toBe("home");
  });

  it("URL-valued parameters are never followed or reflected in the route", () => {
    const evil = "https%3A%2F%2Fevil.example%2Fx";
    for (const name of ["to", "url", "redirect", "redirect_uri", "next", "return", "returnTo", "continue", "dest", "link", "u"]) {
      for (const u of [`https://kiorex.com/ar/eg/doctor/dr-x?${name}=${evil}`, `https://kiorex.com/r/AB12CD34?${name}=${evil}`, `kiorex://doctor/dr-x?${name}=${evil}`, `kiorex://appointment/apt_1?${name}=${evil}`]) {
        const t = r(u);
        expect(JSON.stringify(t)).not.toMatch(/evil|https?:|%3A|\/\//i);
        expect(t.route.startsWith("/")).toBe(true);
      }
    }
    // even a hostile cc value is never used
    expect(JSON.stringify(r("kiorex://r/AB12CD34?cc=https%3A%2F%2Fevil.example"))).not.toMatch(/evil/);
  });

  it("every route is an in-app path built from a template", () => {
    for (const u of ["https://kiorex.com/ar/eg/doctor/dr-x", "https://kiorex.com/r/AB12CD34", "kiorex://claim", "https://kiorex.com/ar/eg/clinic/a-b", "https://kiorex.com/a/apt_1", "https://kiorex.com/nope"]) expect(r(u).route).toMatch(/^\/(?!\/)[A-Za-z0-9/_?=&%.-]*$/);
  });

  it("market routing: the link market wins when live, a non-live market falls back to the live default, no bootstrap keeps the app market", () => {
    expect(r("https://kiorex.com/ar/sa/doctor/dr-x", { liveMarkets: ["EG", "SA"] }).cc).toBe("sa");
    expect(r("https://kiorex.com/ar/sa/doctor/dr-x").cc).toBe("eg"); // SA not live
    expect(r("https://kiorex.com/ar/zz/doctor/dr-x").cc).toBe("eg");
    expect(r("https://kiorex.com/ar/sa/doctor/dr-x", { liveMarkets: undefined }).cc).toBeUndefined();
    expect(r("https://kiorex.com/r/AB12CD34?cc=SA", { liveMarkets: ["EG", "SA"] }).cc).toBe("eg"); // cc must be lower-case alpha-2 in the link; upper-case value is normalised by path form only
  });

  it("deep links never carry or accept credentials: no token parameter is read", () => {
    const t = r("kiorex://appointment/apt_1?token=abc&access_token=xyz&code=123&sub=u1");
    expect(JSON.stringify(t)).not.toMatch(/abc|xyz|123|u1/);
    expect(t.requiresSignIn).toBe(true);
  });

  it("configured hosts come from the build env, bad entries are dropped", () => {
    expect(configuredHosts("kiorex.com, www.kiorex.com ,https://evil.example,bad host,staging.kiorex.com")).toEqual(["kiorex.com", "www.kiorex.com", "staging.kiorex.com"]);
    expect(configuredHosts(undefined)).toContain("kiorex.com");
  });
});

describe("install referrer and claim code", () => {
  it.each([
    ["kxref=p.7XK2M9QP", { kind: "provider", code: "7XK2M9QP" }],
    ["kxref=r.AB12CD34", { kind: "referral", code: "AB12CD34" }],
    ["utm_source=google-play&utm_medium=organic&kxref%3D=x", null],
    ["kxref=p.7XK2M9QP&utm_source=google-play&utm_medium=organic", { kind: "provider", code: "7XK2M9QP" }],
    ["utm_source=a&kxref=AB12CD3456", { kind: "referral", code: "AB12CD3456" }],
    ["kxref=7XK2M9QP", { kind: "provider", code: "7XK2M9QP" }],
  ])("%s", (raw, want) => { expect(parseInstallReferrer(raw)).toEqual(want); });
  it("rejects garbage and hostile referrers", () => {
    for (const raw of ["", "utm_source=google-play", "kxref=", "kxref=https%3A%2F%2Fevil.example", "kxref=p.7XK2M9QI", "kxref=p.AB", "kxref=r.%2e%2e", "kxref=x.AB12CD34", `kxref=r.${"A".repeat(40)}`, "A".repeat(600), undefined, null, 7, {}]) expect(parseInstallReferrer(raw as never)).toBeNull();
  });
  it("claim codes: spaces and dashes are tolerated, shape is strict", () => {
    expect(parseClaimCode(" 7xk2-m9qp ")).toEqual({ kind: "provider", code: "7XK2M9QP" });
    expect(parseClaimCode("AB12 CD3456")).toEqual({ kind: "referral", code: "AB12CD3456" });
    for (const raw of ["", "ab", "https://evil.example", "AB12/CD34", "<b>", "A".repeat(30), undefined]) expect(parseClaimCode(raw as never)).toBeNull();
  });
});
