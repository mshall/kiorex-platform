import { resolveLink, HOME } from "@/lib/deepLink";
import { normaliseInviteCode } from "@/modules/referral/api";
import { androidIntentFilters, ANDROID_PATH_PATTERNS } from "../../app.config";

const o = { hosts: ["kiorex.com", "www.kiorex.com", "kiorly.link"], liveMarkets: ["EG"], defaultMarket: "EG" };
const r = (u: unknown) => resolveLink(u, o);

/** GRW-P2-B3: the patient invite link opens /invite/<CODE> from the closed route table; nothing in the link is followed, the link never signs in. */
describe("invite deep links", () => {
  it.each([
    ["https://kiorex.com/ar/eg/invite/7K3M9QPX", { kind: "invite", route: "/invite/7K3M9QPX", requiresSignIn: false, locale: "ar", cc: "eg" }],
    ["https://kiorex.com/en/eg/invite/7k3m9qpx", { kind: "invite", route: "/invite/7K3M9QPX", locale: "en" }],
    ["https://kiorex.com/invite/7K3M9QPX", { kind: "invite", route: "/invite/7K3M9QPX" }],
    ["kiorex://invite/7K3M9QPX", { kind: "invite", route: "/invite/7K3M9QPX" }],
    ["/ar/eg/invite/7K3M9QPX?utm_source=whatsapp", { kind: "invite", route: "/invite/7K3M9QPX" }],
  ])("%s", (u, want) => { expect(r(u)).toMatchObject(want); });
  it.each([
    "https://kiorex.com/invite/7K3M9QPI", "https://kiorex.com/invite/7K3M9QP", "https://kiorex.com/invite/7K3M9QPXX", "https://kiorex.com/invite/https%3A%2F%2Fevil.example", "https://kiorex.com/invite/..%2F..%2Fx",
    "https://evil.example/invite/7K3M9QPX", "https://kiorex.com@evil.example/invite/7K3M9QPX", "http://kiorex.com/invite/7K3M9QPX", "https://kiorex.com/invite/7K3M9QPX/extra", "https://kiorex.com/invite",
  ])("a malformed or hostile invite link opens Home: %s", (u) => { expect(r(u)).toEqual(HOME); });
  it("the invite code is validated as Crockford base32 of eight characters and upper-cased", () => {
    expect(normaliseInviteCode(" 7k3m9qpx ")).toBe("7K3M9QPX"); expect(normaliseInviteCode("7K3M9QPU")).toBeNull(); expect(normaliseInviteCode(12345678)).toBeNull(); expect(normaliseInviteCode("")).toBeNull();
  });
  it("the Android intent filter and the association list claim invite paths and still never the whole host", () => {
    for (const p of ["/ar/..*/invite/.*", "/en/..*/invite/.*", "/invite/.*"]) expect(ANDROID_PATH_PATTERNS).toContain(p);
    expect(androidIntentFilters("kiorex.com")[0]!.data.map((d) => d.pathPattern)).not.toContain("/.*");
  });
});
