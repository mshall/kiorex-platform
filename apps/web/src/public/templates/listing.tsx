import type { ListData, TemplateCtx } from "../types";
import { Breadcrumbs, Chips, Emergency, Faq, Pager, ProviderList, RatingBars } from "../components/parts";
import { registerTemplate } from "../registry";
import { metaFromTemplate, type TemplateKey } from "../seo/meta-templates";
import { listingBlocks } from "../seo/jsonld";
import { day } from "../format";
import { feeText, listVars, sep } from "./shared";

/**
 * Every generated listing: specialty hub, specialty in city, specialty in district, care type in district, city and district hubs, same-day and video hubs.
 * The intro sentence and the fact list are built from the page's real data (counts, fee range, languages, rating, next slot), so two pages are never the same
 * template with a name swapped; links go only to pages the API found indexable.
 */
const FAQ_GROUP: Record<ListData["kind"], string> = { hub: "list", city: "list", district: "list", "care-district": "care", "city-hub": "location", "district-hub": "location", "same-day": "sameDay", telemedicine: "tele" };
const INTRO: Record<ListData["kind"], string> = { hub: "hub", city: "city", district: "district", "care-district": "care", "city-hub": "cityHub", "district-hub": "districtHub", "same-day": "sameDay", telemedicine: "tele" };
const metaKey = (k: ListData["kind"]): TemplateKey => k;

function Intro({ d, ctx }: { d: ListData; ctx: TemplateCtx }) {
  const v = listVars(d, ctx);
  return <p className="kxp-intro">{ctx.t(`list.intro.${INTRO[d.kind]}`, { count: d.liveProviders, specialty: String(v.specialty ?? ""), city: String(v.city ?? ""), district: String(v.district ?? ""), care: String(v.care ?? ""), sameDay: d.sameDayCount })}</p>;
}

registerTemplate<ListData>({
  types: ["hub", "city", "district", "care-district", "city-hub", "district-hub", "same-day", "telemedicine"],
  Component: ({ data, ctx }) => {
    const l = data.links;
    return (
      <>
        <Breadcrumbs crumbs={data.crumbs} ctx={ctx} />
        <h1>{ctx.pick(data.title)}</h1>
        <Intro d={data} ctx={ctx} />
        <ul className="kxp-facts">
          <li>{ctx.t("list.count", { count: data.liveProviders })}</li>
          {data.sameDayCount > 0 && data.kind !== "same-day" ? <li>{ctx.t("list.sameDayCount", { count: data.sameDayCount })}</li> : null}
          {data.facets.feeRange ? <li className="kxp-num" suppressHydrationWarning>{feeText(data.facets.feeRange, ctx)}</li> : null}
          {data.facets.rating ? <li>{ctx.t("list.rating", { avg: data.facets.rating.average.toFixed(1), count: data.facets.rating.count })}</li> : null}
          {data.facets.languages.length ? <li>{ctx.t("list.languages", { list: data.facets.languages.join(sep(ctx)) })}</li> : null}
          {data.facets.nextSlotAt ? <li suppressHydrationWarning>{ctx.t("list.next")}: {day(data.facets.nextSlotAt, ctx.locale)}</li> : null}
        </ul>
        <h2 className="kxp-sr">{ctx.t("list.providers")}</h2>
        <ProviderList providers={data.providers} ctx={ctx} />
        <Pager p={data.pagination} ctx={ctx} />
        {data.specialtyMix.length ? <section><h2>{ctx.t("list.specialtyMix")}</h2><Chips items={data.specialtyMix} ctx={ctx} /></section> : null}
        <RatingBars buckets={data.ratingDistribution} ctx={ctx} />
        {l.availability.length ? <section><h2>{ctx.t("list.availability")}</h2><Chips items={l.availability} ctx={ctx} /></section> : null}
        {l.districts.length ? <section><h2>{ctx.t(data.kind === "district" || data.kind === "district-hub" ? "list.nearbyDistricts" : "list.districts")}</h2><Chips items={l.districts} ctx={ctx} /></section> : null}
        {l.cities.length ? <section><h2>{ctx.t("list.otherCities")}</h2><Chips items={l.cities} ctx={ctx} /></section> : null}
        {l.relatedSpecialties.length ? <section><h2>{ctx.t("list.relatedSpecialties")}</h2><Chips items={l.relatedSpecialties} ctx={ctx} /></section> : null}
        {l.parents.length ? <section><h2>{ctx.t("list.parents")}</h2><Chips items={l.parents} ctx={ctx} count={false} /></section> : null}
        <Faq group={FAQ_GROUP[data.kind]} ctx={ctx} />
        <Emergency ctx={ctx} />
      </>
    );
  },
  meta: (d, ctx) => metaFromTemplate(metaKey(d.kind), ctx, listVars(d, ctx)),
  jsonLd: (d, ctx) => {
    const m = metaFromTemplate(metaKey(d.kind), ctx, listVars(d, ctx));
    return listingBlocks(d, ctx.canonicalHost, ctx.locale, ctx.cc, ctx.path, m);
  },
});
