import axe from "axe-core";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { render } from "../../entry-server";
import { PublicApp } from "../PublicApp";
import en from "../locales/en.json";
import ar from "../locales/ar.json";
import { DEFAULT_TEMPLATES, renderTemplate, templateFor, type TemplateKey } from "../seo/meta-templates";
import { imageModel } from "../seo/image";
import { providerType, physician, validateJsonLd, FORBIDDEN_KEYS } from "../seo/jsonld";
import { clinic, doctor, home, lab, list, pharmacy, SAMPLES, state, card } from "./fixtures";
import type { SsrInput } from "../types";

const toInput = (s: ReturnType<typeof state>): SsrInput => ({ ...s, site: s.site! });
const strip = (html: string) => html.replace(/<style[\s\S]*?<\/style>/g, "");

/** Structure of a rendered page that must not change by accident: language, headings, links, JSON-LD types, FAQ count. Independent of ICU date formatting. */
async function outline(s: ReturnType<typeof state>) {
  const out = await render(toInput(s));
  const h = out.html;
  const all = (re: RegExp) => [...h.matchAll(re)].map((m) => m[1]!.replace(/<[^>]+>/g, "").trim());
  return {
    title: out.meta.title, description: out.meta.description,
    h1: all(/<h1[^>]*>([\s\S]*?)<\/h1>/g), h2: all(/<h2[^>]*>([\s\S]*?)<\/h2>/g),
    hrefs: [...new Set([...h.matchAll(/href="([^"]+)"/g)].map((m) => m[1]!))].sort(),
    faq: (h.match(/<details/g) ?? []).length, jsonLd: out.jsonLd.map((j) => (j as { "@type": string })["@type"]),
  };
}

describe("AR and EN structure snapshots for every public page type", () => {
  for (const locale of ["en", "ar"] as const) {
    for (const s of SAMPLES(locale)) {
      it(`${locale} ${s.type}`, async () => { expect(await outline(s)).toMatchSnapshot(); });
    }
  }
});

describe("metadata of every page type", () => {
  it("titles stay within 60 characters, descriptions within 155, and no placeholder or empty fragment leaks", async () => {
    for (const locale of ["en", "ar"] as const) {
      for (const s of SAMPLES(locale)) {
        const out = await render(toInput(s));
        expect(out.meta.title.length, `${locale} ${s.type}`).toBeLessThanOrEqual(60);
        expect(out.meta.description.length, `${locale} ${s.type}`).toBeLessThanOrEqual(155);
        for (const t of [out.meta.title, out.meta.description]) { expect(t).not.toMatch(/[{}]|undefined|null|NaN/); expect(t).not.toMatch(/\s{2,}|\s[,.،:;]/); }
      }
    }
  });
  it("titles are unique across the page types of one sample set (no duplicate-title pages)", async () => {
    const titles = new Map<string, string>();
    for (const s of SAMPLES("en").filter((x) => x.type !== "not-found")) {
      const t = (await render(toInput(s))).meta.title;
      expect(titles.has(t), `${s.type} duplicates ${titles.get(t)}`).toBe(false);
      titles.set(t, s.type);
    }
  });
  it("templates are overridable per locale from the versioned SEO config; a missing field keeps the default; unknown placeholders print nothing", async () => {
    const s = state("en", "city", "/en/eg/doctors/cardiology/cairo", list);
    const over = { ...s, site: { ...s.site!, templates: { en: { city: { title: "Heart doctors in {city} ({count})" } } } } };
    const out = await render(toInput(over));
    expect(out.meta.title).toBe("Heart doctors in Cairo (30) | Kiorex");
    expect(out.meta.description).toMatch(/^30 verified Cardiology doctors in Cairo/); // description untouched
    const ar = await render(toInput({ ...over, locale: "ar", path: "/ar/eg/doctors/cardiology/cairo" }));
    expect(ar.meta.title).toContain("أطباء"); // the Arabic default is not affected by an English override
    expect(templateFor("city", { locale: "en", templates: {} })).toEqual(DEFAULT_TEMPLATES.en.city);
    expect(renderTemplate("A {nope} B, {city}.", { city: "Cairo" })).toBe("A B, Cairo.");
    expect(renderTemplate("Fees. {fees}Book", {})).toBe("Fees. Book");
  });
  it("every default template uses only supported placeholders and is non-empty in both languages", () => {
    const ok = ["name", "specialty", "city", "district", "country", "clinic", "count", "fees", "rating", "where", "care", "brand"];
    for (const l of ["en", "ar"] as const) for (const [k, t] of Object.entries(DEFAULT_TEMPLATES[l])) for (const f of [t.title, t.description]) {
      expect(f.trim().length, `${l}.${k}`).toBeGreaterThan(5);
      for (const m of f.matchAll(/\{(\w+)\}/g)) expect(ok, `${l}.${k} {${m[1]}}`).toContain(m[1]);
      if (f === t.title) expect(f).not.toContain("{brand}");
    }
    expect(Object.keys(DEFAULT_TEMPLATES.en).sort()).toEqual(Object.keys(DEFAULT_TEMPLATES.ar).sort());
    const keys: TemplateKey[] = ["home", "hub", "city", "district", "care-district", "city-hub", "district-hub", "same-day", "telemedicine", "doctor", "nurse", "clinic", "pharmacy", "lab"];
    expect(Object.keys(DEFAULT_TEMPLATES.en).sort()).toEqual([...keys].sort());
  });
});

describe("FAQ blocks", () => {
  const groups: Record<string, number> = { home: 3, list: 3, care: 3, location: 3, sameDay: 3, tele: 3, doctor: 3, nurse: 3, clinic: 2, pharmacy: 2, lab: 2 };
  it("every FAQ question and answer exists in AR and EN, with no medical claim wording", () => {
    for (const [g, n] of Object.entries(groups)) for (let i = 1; i <= n; i++) for (const f of ["q", "a"]) {
      const k = `faq.${g}.${i}.${f}`;
      expect((en as Record<string, string>)[k], k).toBeTruthy();
      expect((ar as Record<string, string>)[k], k).toBeTruthy();
      expect((en as Record<string, string>)[k]).not.toMatch(/\b(cure|cures|guarantee|guaranteed|best|safest|painless|miracle|100%)\b/i);
    }
    expect(Object.keys(en).filter((k) => k.startsWith("faq.") && k !== "faq.title")).toHaveLength(Object.values(groups).reduce((a, b) => a + b, 0) * 2);
  });
  it("every template with a FAQ renders it as native details with the emergency pointer on the page", async () => {
    for (const s of SAMPLES("en").filter((x) => x.type !== "not-found")) {
      const out = await render(toInput(s));
      expect((out.html.match(/<details/g) ?? []).length, s.type).toBeGreaterThanOrEqual(2);
      expect(out.html, s.type).toContain("In an emergency call 123");
    }
  });
});

describe("JSON-LD of every page type is valid, honest and private", () => {
  it("validates, uses only the allowed types, and carries no contact, address or coordinate fields", async () => {
    for (const locale of ["en", "ar"] as const) for (const s of SAMPLES(locale)) {
      const out = await render(toInput(s));
      for (const j of out.jsonLd) expect(validateJsonLd(j), `${locale} ${s.type}`).toEqual([]);
      const text = JSON.stringify(out.jsonLd);
      for (const k of FORBIDDEN_KEYS) expect(text, `${s.type} ${k}`).not.toContain(`"${k}"`);
    }
  });
  it("picks the honest type: physician, dentist, nurse and physiotherapist are not all Physician; pharmacy is Pharmacy, lab is MedicalBusiness", async () => {
    expect(providerType({ kind: "doctor", profession: null })).toBe("Physician");
    expect(providerType({ kind: "doctor", profession: "DENTIST" })).toBe("Dentist");
    expect(providerType({ kind: "doctor", profession: "PHYSIOTHERAPIST" })).toBe("MedicalBusiness");
    expect(providerType({ kind: "nurse", profession: "NURSE" })).toBe("MedicalBusiness");
    expect((await render(toInput(state("en", "pharmacy", "/en/eg/pharmacy/nile-pharmacy", pharmacy)))).jsonLd[0]).toMatchObject({ "@type": "Pharmacy" });
    expect((await render(toInput(state("en", "lab", "/en/eg/lab/nile-lab", lab)))).jsonLd[0]).toMatchObject({ "@type": "MedicalBusiness" });
    expect((await render(toInput(state("en", "clinic", "/en/eg/clinic/nile-clinic", clinic)))).jsonLd[0]).toMatchObject({ "@type": "MedicalClinic" });
  });
  it("aggregateRating only when the page passes the review policy AND the site enables it; never fabricated", async () => {
    const withPolicy = await render(toInput(state("en", "doctor", "/en/eg/doctor/sara-hassan", doctor)));
    expect(JSON.stringify(withPolicy.jsonLd)).toContain("AggregateRating");
    const noPolicy = await render(toInput(state("en", "doctor", "/en/eg/doctor/sara-hassan", { ...doctor, ratingMarkup: false })));
    expect(JSON.stringify(noPolicy.jsonLd)).not.toContain("AggregateRating");
    const s = state("en", "doctor", "/en/eg/doctor/sara-hassan", doctor);
    const off = await render(toInput({ ...s, site: { ...s.site!, reviewMarkup: false } }));
    expect(JSON.stringify(off.jsonLd)).not.toContain("AggregateRating");
    const zero = physician({ ...doctor.provider, rating: { average: 0, count: 0 } }, "h", "en", "eg", "u", { ratingMarkup: true, bookable: true });
    expect(zero.aggregateRating).toBeUndefined();
    expect(validateJsonLd({ "@context": "https://schema.org", "@type": "AggregateRating", ratingValue: 9, reviewCount: 0 }).length).toBeGreaterThan(0);
    expect(validateJsonLd({ "@context": "https://schema.org", "@type": "Physician", name: "x", telephone: "+20100" }).map((i) => i.message)).toContain("forbidden property telephone");
    expect(validateJsonLd({ "@context": "https://schema.org", "@type": "Product" }).length).toBe(1);
  });
});

describe("what a visitor-facing page may contain", () => {
  it("no phone number, e-mail, street address, coordinates, token, script or auth data in any page in either language", async () => {
    for (const locale of ["en", "ar"] as const) for (const s of SAMPLES(locale)) {
      const html = strip((await render(toInput(s))).html);
      expect(html, `${locale} ${s.type}`).not.toMatch(/tel:|mailto:|\+?20\s?1\d{9}|\b0?1[0125]\d{8}\b|[\w.-]+@[\w-]+\.[a-z]{2,}|streetAddress|latitude|longitude|authorization|bearer |access_token|<script/i);
    }
  });
  it("pagination uses plain links without rel=prev or rel=next", async () => {
    const out = await render(toInput(state("en", "city", "/en/eg/doctors/cardiology/cairo", { ...list, page: 2, pagination: { page: 2, pages: 3, prevPath: "/en/eg/doctors/cardiology/cairo", nextPath: "/en/eg/doctors/cardiology/cairo?page=3" } })));
    expect(out.html).not.toMatch(/rel="(prev|next)"/);
    expect(out.html).toContain("Page 2 of 3");
  });
  it("the listing shows real rating counts and never an empty distribution", async () => {
    const out = await render(toInput(state("en", "city", "/en/eg/doctors/cardiology/cairo", list)));
    expect(out.html).toContain("How patients rated these providers");
    const none = await render(toInput(state("en", "city", "/en/eg/doctors/cardiology/cairo", { ...list, ratingDistribution: [] })));
    expect(none.html).not.toContain("How patients rated");
  });
  it("home links to the city, availability and care hubs and lists partner counts only when partners exist", async () => {
    const out = await render(toInput(state("en", "home", "/en/eg", home)));
    for (const h of ["/en/eg/locations/cairo", "/en/eg/same-day/cardiology", "/en/eg/home-nursing/cairo/maadi"]) expect(out.html).toContain(`href="${h}"`);
    expect(out.html).toContain("Partner pharmacies: 2");
    const none = await render(toInput(state("en", "home", "/en/eg", { ...home, partners: { pharmacies: 0, labs: 0 } })));
    expect(none.html).not.toContain("Partner pharmacies");
  });
});

describe("images", () => {
  it("no CDN: the original with width, height, alt and eager loading for the LCP image", () => {
    const m = imageModel({ url: "https://img.kiorly.test/p.jpg", alt: "Dr Sara", width: 96, height: 96, priority: true })!;
    expect(m.sources).toEqual([]);
    expect(m.img).toMatchObject({ width: 96, height: 96, alt: "Dr Sara", loading: "eager", decoding: "async", fetchPriority: "high" });
  });
  it("with a CDN: AVIF and WebP sources at three widths, JPEG fallback, lazy loading by default", () => {
    const m = imageModel({ url: "https://img.kiorly.test/p.jpg", alt: "x", width: 96, height: 96, cdn: "https://img.kiorex.test/" })!;
    expect(m.sources.map((s) => s.type)).toEqual(["image/avif", "image/webp"]);
    expect(m.sources[0]!.srcSet).toBe("https://img.kiorex.test/image?url=https%3A%2F%2Fimg.kiorly.test%2Fp.jpg&w=96&f=avif 96w, https://img.kiorex.test/image?url=https%3A%2F%2Fimg.kiorly.test%2Fp.jpg&w=192&f=avif 192w, https://img.kiorex.test/image?url=https%3A%2F%2Fimg.kiorly.test%2Fp.jpg&w=288&f=avif 288w");
    expect(m.img.loading).toBe("lazy");
    expect(m.img.fetchPriority).toBeUndefined();
  });
  it("refuses non-https and malformed URLs", () => {
    for (const url of ["http://x.test/a.jpg", "javascript:alert(1)", "https://x.test/a b.jpg", "", null]) expect(imageModel({ url, alt: "a", width: 1, height: 1 })).toBeNull();
  });
  it("the doctor page renders the photo as a picture with alt text when a photo exists", async () => {
    const withPhoto = { ...doctor, provider: { ...doctor.provider, photoUrl: "https://img.kiorly.test/p.jpg" } };
    const s = state("en", "doctor", "/en/eg/doctor/sara-hassan", withPhoto);
    const out = await render(toInput({ ...s, site: { ...s.site!, imageCdn: "https://img.kiorex.test" } }));
    expect(out.html).toContain("<picture>");
    expect(out.html).toMatch(/<img[^>]+alt="Dr Sara Hassan, Cardiology, Maadi, Cairo"/);
    expect(out.html).toMatch(/width="96"[^>]*height="96"|height="96"[^>]*width="96"/);
  });
});

describe("accessibility of the doctor and listing pages (axe, WCAG A and AA rules that jsdom can evaluate)", () => {
  for (const type of ["doctor", "city", "home"] as const) {
    it(`${type} page has no axe violations`, async () => {
      const s = SAMPLES("en").find((x) => x.type === type)!;
      document.documentElement.lang = "en";
      document.body.innerHTML = `<div id="root">${renderToString(createElement(PublicApp, { state: s }))}</div>`;
      const r = await axe.run(document.body, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } });
      expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.html).join(" | ")}`)).toEqual([]);
    });
  }
  it("card helper stays valid", () => { expect(card().slug).toBe("sara-hassan"); });
});
