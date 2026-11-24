import { describe, expect, it } from "vitest";
import { render } from "../../entry-server";
import { doctor, home, state } from "./fixtures";
import { SSR_VARIANT_SURFACES, VARIANT_COPY } from "../experiments";
import type { SsrInput } from "../types";

const input = (s: ReturnType<typeof state>, experiments?: SsrInput["experiments"]): SsrInput => ({ ...s, site: s.site!, ...(experiments ? { experiments } : {}) });
const HOME = { "landing.home.hero_copy": { experiment: "home-hero-1", variant: "b" } };

describe("SSR experiment slots (GRW-P3-A)", () => {
  it("home hero: control copy without an assignment, variant copy with one, in both languages", async () => {
    for (const locale of ["en", "ar"] as const) {
      const ctl = await render(input(state(locale, "home", `/${locale}/eg`, home)));
      const b = await render(input(state(locale, "home", `/${locale}/eg`, home), HOME));
      const copy = VARIANT_COPY["landing.home.hero_copy"]!.b![locale];
      expect(b.html).toContain(copy.h1!); expect(b.html).toContain(copy.lead!);
      expect(ctl.html).not.toContain(copy.h1!);
      expect(b.html).not.toBe(ctl.html);
    }
  });
  it("provider CTA label: variant copy replaces only the label; the paused notice and the link stay", async () => {
    const x = { "landing.provider.cta_label": { experiment: "cta-1", variant: "b" } };
    const out = await render(input(state("en", "doctor", "/en/eg/doctor/sara-hassan", doctor), x));
    expect(out.html).toContain("Choose a time"); expect(out.html).toContain('href="/doctors/lst_a?book=1"'); expect(out.html).not.toContain("Book an appointment");
    const paused = await render(input(state("en", "doctor", "/en/eg/doctor/sara-hassan", { ...doctor, bookable: false }), x));
    expect(paused.html).not.toContain("Choose a time");
  });
  it("an unknown variant, an unknown surface or the wrong page type renders control", async () => {
    const ctl = await render(input(state("en", "home", "/en/eg", home)));
    expect((await render(input(state("en", "home", "/en/eg", home), { "landing.home.hero_copy": { experiment: "e", variant: "zzz" } }))).html).toBe(ctl.html);
    expect((await render(input(state("en", "home", "/en/eg", home), { "emergency.guidance": { experiment: "e", variant: "b" } }))).html).toBe(ctl.html);
    expect((await render(input(state("en", "home", "/en/eg", home), { "landing.provider.cta_label": { experiment: "e", variant: "b" } }))).html).toBe(ctl.html);
  });
  it("only marketing-copy surfaces have variant copy, and none of the copy touches price, fee, emergency or consent wording", () => {
    expect(SSR_VARIANT_SURFACES.sort()).toEqual(["landing.home.hero_copy", "landing.provider.cta_label"]);
    const all = JSON.stringify(VARIANT_COPY).toLowerCase();
    for (const w of ["egp", "fee", "price", "free", "emergency", "consent", "cure", "guarantee", "refund"]) expect(all).not.toContain(w);
  });
});
