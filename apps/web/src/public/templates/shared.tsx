import type { Bilingual, ListData, TemplateCtx } from "../types";
import { money } from "../format";
import type { MetaVars } from "../seo/meta-templates";

export const sep = (ctx: TemplateCtx) => (ctx.locale === "ar" ? "، " : ", ");
export const inWhere = (ctx: TemplateCtx, where: string): string => (where ? (ctx.locale === "ar" ? ` في ${where}` : ` in ${where}`) : "");

export function feeText(f: ListData["facets"]["feeRange"], ctx: TemplateCtx): string {
  return f ? ctx.t("list.fees", { min: money(f.minMinor, ctx.locale, f.currency), max: money(f.maxMinor, ctx.locale, f.currency) }) : "";
}

/** Template variables of a listing page: every value is real page data. */
export function listVars(d: ListData, ctx: TemplateCtx): MetaVars {
  const fees = feeText(d.facets.feeRange, ctx);
  const rating = d.facets.rating ? ctx.t("list.rating", { avg: d.facets.rating.average.toFixed(1), count: d.facets.rating.count }) : "";
  const pickOr = (b: Bilingual | null | undefined): string => (b ? ctx.pick(b) : "");
  return {
    specialty: pickOr(d.specialty?.label), city: pickOr(d.city), district: pickOr(d.district), count: d.liveProviders,
    care: d.careType === "PHYSIOTHERAPY" ? ctx.t("care.physiotherapy") : d.careType === "HOME_NURSING" ? ctx.t("care.homeNursing") : "",
    fees: fees ? `${fees}. ` : "", rating: rating ? `${rating}. ` : "",
  };
}
