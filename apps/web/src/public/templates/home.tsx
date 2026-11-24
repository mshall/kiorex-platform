import type { HomeData } from "../types";
import { Chips, Faq, SearchBox, Emergency } from "../components/parts";
import { registerTemplate } from "../registry";
import { metaFromTemplate } from "../seo/meta-templates";
import { variantCopy } from "../experiments";
import { organization, website } from "../seo/jsonld";

/** Country page (the home of a market): real counts, the specialty and city hubs that pass the guard, availability hubs and care types. */
registerTemplate<HomeData>({
  types: ["home"],
  Component: ({ data, ctx }) => (
    <>
      <section className="kxp-hero">
        <h1>{variantCopy(ctx, "landing.home.hero_copy", "h1") ?? ctx.t("home.h1")}</h1>
        <p className="kxp-lead">{variantCopy(ctx, "landing.home.hero_copy", "lead") ?? ctx.t("home.lead")}</p>
        <SearchBox ctx={ctx} />
        {data.liveProviders > 0 ? <p className="kxp-muted">{ctx.t("home.live", { count: data.liveProviders })}</p> : <p className="kxp-muted">{ctx.t("home.empty")}</p>}
      </section>
      {data.specialties.length ? <section><h2>{ctx.t("home.specialties")}</h2><Chips items={data.specialties} ctx={ctx} /></section> : null}
      {data.cityHubs.length ? <section><h2>{ctx.t("home.cityHubs")}</h2><Chips items={data.cityHubs} ctx={ctx} /></section> : data.cities.length ? <section><h2>{ctx.t("home.cities")}</h2><Chips items={data.cities} ctx={ctx} /></section> : null}
      {data.availability.length ? <section><h2>{ctx.t("home.availability")}</h2><Chips items={data.availability} ctx={ctx} /></section> : null}
      {data.careTypes.length ? <section><h2>{ctx.t("home.care")}</h2><Chips items={data.careTypes} ctx={ctx} /></section> : null}
      {data.partners.pharmacies + data.partners.labs > 0 ? <p className="kxp-muted">{ctx.t("home.partners", { pharmacies: data.partners.pharmacies, labs: data.partners.labs })}</p> : null}
      <Faq group="home" ctx={ctx} />
      <Emergency ctx={ctx} />
    </>
  ),
  meta: (_d, ctx) => metaFromTemplate("home", ctx, {}),
  jsonLd: (_d, ctx) => [organization(ctx.canonicalHost), website(ctx.canonicalHost, ctx.locale, ctx.cc)],
});
