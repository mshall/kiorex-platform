import { describe, expect, it } from "vitest";
import { render } from "../../entry-server";
import { SAMPLES, state, list, doctor } from "./fixtures";
import type { SsrInput } from "../types";

const toInput = (s: ReturnType<typeof state>): SsrInput => ({ ...s, site: s.site! });

describe("server entry: render(input) returns body HTML, metadata and JSON-LD for every page type", () => {
  for (const locale of ["en", "ar"] as const) {
    it(`renders all sample pages in ${locale} without throwing`, async () => {
      for (const s of SAMPLES(locale)) {
        const out = await render(toInput(s));
        expect(out.html).toContain("<h1");
        expect(out.html).toContain(`<main id="main"`);
        expect(out.html).not.toMatch(/<script/);
        expect(out.meta.title.length).toBeGreaterThan(3);
        expect(out.meta.title.length).toBeLessThanOrEqual(60);
        expect(out.meta.description.length).toBeLessThanOrEqual(155);
      }
    });
  }

  it("doctor: the content a crawler needs is in the HTML (name, specialty, location, fee, reviews, booking link) and the JSON-LD hook returns Physician and BreadcrumbList", async () => {
    const out = await render(toInput(state("en", "doctor", "/en/eg/doctor/sara-hassan", doctor)));
    for (const s of ["Dr Sara Hassan", "Cardiology", "Maadi, Cairo", "Nile Clinic", "Very thorough", 'href="/doctors/lst_a?book=1"', "Book an appointment"]) expect(out.html).toContain(s);
    expect(out.jsonLd.map((j) => (j as { "@type": string })["@type"])).toEqual(["Physician", "BreadcrumbList"]);
    expect((out.jsonLd[0] as { aggregateRating?: unknown }).aggregateRating).toMatchObject({ reviewCount: 12 });
    expect(out.meta.title).toBe("Dr Sara Hassan, Cardiology | Kiorex");
  });

  it("a paused listing replaces the booking CTA; Arabic pages are Arabic", async () => {
    const out = await render(toInput(state("ar", "doctor", "/ar/eg/doctor/sara-hassan", { ...doctor, bookable: false })));
    expect(out.html).toContain("لا يستقبل مقدّم الخدمة هذا حجوزات");
    expect(out.html).not.toContain("احجز موعدًا");
    expect(out.html).toContain("د. سارة حسن");
  });

  it("listing: provider without a slug renders without a link; pagination links and related facets are real hrefs", async () => {
    const out = await render(toInput(state("en", "city", "/en/eg/doctors/cardiology/cairo", { ...list, page: 2, pagination: { page: 2, pages: 3, prevPath: "/en/eg/doctors/cardiology/cairo", nextPath: "/en/eg/doctors/cardiology/cairo?page=3" } })));
    expect(out.html).toContain('href="/en/eg/doctor/sara-hassan"');
    expect(out.html).toContain("Dr No Slug");
    expect(out.html).not.toMatch(/href="\/en\/eg\/doctor\/null/);
    // pagination (GRW-P1-F): plain self-contained links, no rel=prev/next (search engines ignore them)
    expect(out.html).not.toMatch(/rel="(prev|next)"/);
    expect(out.html).toContain('href="/en/eg/doctors/cardiology/cairo?page=3"');
    expect(out.html).toContain('href="/en/eg/doctors/cardiology/cairo/maadi"');
  });

  it("refuses a path that is not the declared page type (the route table is shared with the API)", async () => {
    await expect(render(toInput(state("en", "doctor", "/en/eg/doctors/cardiology", doctor)))).rejects.toThrow(/route mismatch/);
    await expect(render(toInput(state("en", "doctor", "/en/eg/account", doctor)))).rejects.toThrow(/route mismatch/);
  });

  it("escapes data: a hostile name cannot inject markup", async () => {
    const evil = { ...doctor, provider: { ...doctor.provider, name: { en: '<img src=x onerror=alert(1)>', ar: "x" } } };
    const out = await render(toInput(state("en", "doctor", "/en/eg/doctor/sara-hassan", evil)));
    expect(out.html).not.toContain("<img src=x");
    expect(out.html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });
});

describe("GRW-P3-F computed internal links render in the server HTML", () => {
  const groups = [{ kind: "CLINIC", links: [{ label: { en: "Nile Clinic", ar: "عيادة النيل" }, path: "/en/eg/clinic/nile-clinic", count: 0 }] }, { kind: "NEIGHBOUR", links: [{ label: { en: "Cardiology in Dokki", ar: "القلب في الدقي" }, path: "/en/eg/doctors/cardiology/giza/dokki", count: 0 }] }];
  it("a nav with plain anchors grouped by role, in both languages, with the localised role headings", async () => {
    for (const locale of ["en", "ar"] as const) {
      const path = `/${locale}/eg/doctor/sara-hassan`;
      const out = await render(toInput(state(locale, "doctor", path, { ...doctor, computedLinks: groups })));
      expect(out.html).toContain("data-computed-links");
      expect(out.html).toContain('href="/en/eg/clinic/nile-clinic"'); expect(out.html).toContain('href="/en/eg/doctors/cardiology/giza/dokki"');
      expect(out.html).toContain(locale === "en" ? "More from Kiorex" : "المزيد من كيوركس");
      expect(out.html).toContain(locale === "en" ? "Nearby districts" : "مناطق مجاورة");
      expect(out.html).not.toMatch(/<script/);
    }
  });
  it("a page without computed links is unchanged (no empty nav)", async () => {
    const out = await render(toInput(state("en", "doctor", "/en/eg/doctor/sara-hassan", doctor)));
    expect(out.html).not.toContain("data-computed-links");
    const empty = await render(toInput(state("en", "doctor", "/en/eg/doctor/sara-hassan", { ...doctor, computedLinks: [] })));
    expect(empty.html).not.toContain("data-computed-links");
  });
});
