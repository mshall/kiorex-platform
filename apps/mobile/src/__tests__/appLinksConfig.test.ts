import fs from "node:fs";
import path from "node:path";
import { ANDROID_PATH_PATTERNS, androidIntentFilters, appLinkHost, iosAssociatedDomains } from "../../app.config";
import { bootstrapShouldShowSelector } from "./bootstrapHelpers";

describe("app link configuration (native rebuild required)", () => {
  it("iOS associated domain and verified Android intent filter point at the patient host only", () => {
    expect(iosAssociatedDomains()).toEqual(["applinks:kiorex.com"]);
    const f = androidIntentFilters()[0]!;
    expect(f.autoVerify).toBe(true);
    expect(f.category).toEqual(["BROWSABLE", "DEFAULT"]);
    for (const d of f.data) { expect(d.scheme).toBe("https"); expect(d.host).toBe("kiorex.com"); expect(d.pathPattern).not.toBe("/.*"); }
    expect(f.data.map((d) => d.pathPattern)).toEqual([...ANDROID_PATH_PATTERNS]);
  });
  it("the host can only be a bare host name from env", () => {
    expect(appLinkHost({ APP_LINK_HOST: "www.staging.kiorex.com" } as never)).toBe("www.staging.kiorex.com");
    expect(appLinkHost({ APP_LINK_HOST: "https://evil.example/x" } as never)).toBe("kiorex.com");
  });
  it("app.config wires both into the native config", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const cfg = require("../../app.config").default({ config: { name: "Kiorex", ios: { bundleIdentifier: "com.kiorex.app" }, android: { package: "com.kiorex.app" }, plugins: [] } });
    expect(cfg.ios.associatedDomains).toEqual(["applinks:kiorex.com"]);
    expect(cfg.android.intentFilters[0].autoVerify).toBe(true);
  });
  it("mirrors kiorex-account domains.json when the sibling repo is present", () => {
    const f = path.resolve(__dirname, "../../../../../kiorex-account/config/domains.json");
    if (!fs.existsSync(f)) return;
    const d = JSON.parse(fs.readFileSync(f, "utf8")).appLinks.patient;
    expect(d.androidPathPatterns).toEqual([...ANDROID_PATH_PATTERNS]);
    expect(d.androidPackage).toBe("com.kiorex.app");
  });
  it("one live market never shows a selector; several do", () => {
    expect(bootstrapShouldShowSelector({ defaultMarket: "EG", liveMarkets: ["EG"], showMarketSelector: false, locales: [] })).toBe(false);
    expect(bootstrapShouldShowSelector({ defaultMarket: "EG", liveMarkets: ["EG", "SA"], showMarketSelector: true, locales: [] })).toBe(true);
    expect(bootstrapShouldShowSelector({ defaultMarket: "EG", liveMarkets: ["EG"], showMarketSelector: true, locales: [] })).toBe(false);
    expect(bootstrapShouldShowSelector(null)).toBe(false);
  });
});
