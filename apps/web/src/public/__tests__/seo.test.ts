import { describe, expect, it } from "vitest";
import { buildMeta, buildTitle, clamp, DESCRIPTION_MAX, TITLE_MAX } from "../seo/meta";
import { breadcrumbs, itemList, organization, physician, website } from "../seo/jsonld";
import { card, doctor } from "./fixtures";

describe("meta shaping", () => {
  it("title keeps the brand suffix when it fits and never exceeds 60 characters", () => {
    expect(buildTitle("Dr Sara Hassan, Cardiology", "en")).toBe("Dr Sara Hassan, Cardiology | Kiorex");
    expect(buildTitle("د. سارة حسن، القلب", "ar")).toBe("د. سارة حسن، القلب | كيوريكس");
    const long = buildTitle("Consultant Interventional Cardiology and Cardiac Electrophysiology Practice in New Cairo", "en");
    expect(long.length).toBeLessThanOrEqual(TITLE_MAX);
    expect(long.endsWith("…")).toBe(true);
  });
  it("description is collapsed and clamped at a word boundary", () => {
    const d = buildMeta("T", `${"word ".repeat(80)}`, "en").description;
    expect(d.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
    expect(d.endsWith("…")).toBe(true);
    expect(clamp("  a   b  ", 10)).toBe("a b");
  });
  it("carries the og image only when given", () => {
    expect(buildMeta("T", "D", "en").ogImage).toBeUndefined();
    expect(buildMeta("T", "D", "en", "https://x.test/a.png").ogImage).toBe("https://x.test/a.png");
  });
});

describe("JSON-LD builders (ARCH section 5: only what the page shows, no contact data)", () => {
  const url = "https://kiorex.test/en/eg/doctor/sara-hassan";
  it("Physician has locality-level address only, no phone, street or coordinates", () => {
    const j = physician(doctor.provider, "https://kiorex.test", "en", "eg", url, { ratingMarkup: true, bookable: true });
    expect(j["@type"]).toBe("Physician");
    expect(j.address).toEqual({ "@type": "PostalAddress", addressLocality: "Maadi", addressRegion: "Cairo", addressCountry: "EG" });
    expect(JSON.stringify(j)).not.toMatch(/telephone|streetAddress|latitude|longitude|geo/);
    expect(j.isAcceptingNewPatients).toBe(true);
  });
  it("rating markup only when enabled AND reviews exist", () => {
    expect(physician(doctor.provider, "h", "en", "eg", url, { ratingMarkup: true, bookable: true }).aggregateRating).toMatchObject({ ratingValue: 4.6, reviewCount: 12 });
    expect(physician(doctor.provider, "h", "en", "eg", url, { ratingMarkup: false, bookable: true }).aggregateRating).toBeUndefined();
    expect(physician({ ...doctor.provider, rating: { average: 0, count: 0 } }, "h", "en", "eg", url, { ratingMarkup: true, bookable: true }).aggregateRating).toBeUndefined();
  });
  it("breadcrumbs need two items; the last item points at the page itself; item lists skip providers without a slug", () => {
    expect(breadcrumbs("https://k.test", doctor.crumbs.slice(0, 1), "en", "/x")).toBeNull();
    const b = breadcrumbs("https://k.test", doctor.crumbs, "en", "/en/eg/doctor/sara-hassan")!;
    expect((b.itemListElement as { item: string }[]).at(-1)!.item).toBe("https://k.test/en/eg/doctor/sara-hassan");
    const l = itemList([card(), card({ id: "x", slug: null })], "https://k.test", "en", "eg")!;
    expect(l.itemListElement).toHaveLength(1);
    expect(itemList([card({ slug: null })], "https://k.test", "en", "eg")).toBeNull();
  });
  it("organization and website blocks are plain and absolute", () => {
    expect(organization("https://k.test").url).toBe("https://k.test");
    expect(website("https://k.test", "ar", "eg").url).toBe("https://k.test/ar/eg");
  });
});
