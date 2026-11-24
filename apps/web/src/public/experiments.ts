import type { TemplateCtx } from "./types";

/**
 * Experiment copy on the SERVER-RENDERED public pages (GRW-P3-A, SSR slot). The API decides the variant (consent, `kxe` cookie, running experiment, surface allowlist) and passes only
 * `variants[surface]` into the render input; this module maps a variant key to reviewed copy that lives in code (so copy review is a code review, not a database edit).
 * A variant without copy, an unknown surface or a missing assignment renders the control copy (the caller's `??` fallback). The surfaces here are the SSR marketing-copy
 * surfaces ONLY; emergency, price, consent, clinical, cancellation and fee text never goes through this function.
 */
type Copy = Record<"en" | "ar", Record<string, string>>;
export const VARIANT_COPY: Record<string, Record<string, Copy>> = {
  "landing.home.hero_copy": {
    b: {
      en: { h1: "Book a verified doctor in minutes", lead: "See real appointment times, read honest reviews and get a confirmed booking with the clinic." },
      ar: { h1: "احجز طبيبًا موثّقًا في دقائق", lead: "شاهد مواعيد حقيقية، واقرأ تقييمات صادقة، واحصل على حجز مؤكَّد من العيادة." },
    },
  },
  "landing.provider.cta_label": {
    b: { en: { cta: "Choose a time" }, ar: { cta: "اختر موعدًا" } },
  },
};
/** The only surfaces a page template may read (checked again on the API side against the experiment surface allowlist). */
export const SSR_VARIANT_SURFACES = Object.keys(VARIANT_COPY);

export function variantCopy(ctx: Pick<TemplateCtx, "variants" | "locale">, surface: string, field: string): string | undefined {
  const v = ctx.variants?.[surface];
  if (!v) return undefined;
  return VARIANT_COPY[surface]?.[v]?.[ctx.locale]?.[field];
}
