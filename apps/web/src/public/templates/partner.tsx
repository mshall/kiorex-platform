import type { PartnerData } from "../types";
import { Breadcrumbs, Chips, Emergency, Faq } from "../components/parts";
import { registerTemplate } from "../registry";
import { metaFromTemplate } from "../seo/meta-templates";
import { breadcrumbs, partnerBusiness } from "../seo/jsonld";

/** Pharmacy and lab pages (partner registry LIVE and the feature flag effective). Only the public name is known: the page explains what Kiorex offers with this partner, nothing invented. */
registerTemplate<PartnerData>({
  types: ["pharmacy", "lab"],
  Component: ({ data, ctx }) => (
    <article>
      <Breadcrumbs crumbs={data.crumbs} ctx={ctx} />
      <h1>{ctx.pick(data.partner.name)}</h1>
      <p className="kxp-lead">{ctx.t(`${data.kind}.lead`, { name: ctx.pick(data.partner.name) })}</p>
      <h2>{ctx.t(`${data.kind}.stepsTitle`)}</h2>
      <ol className="kxp-steps"><li>{ctx.t(`${data.kind}.step1`)}</li><li>{ctx.t(`${data.kind}.step2`)}</li><li>{ctx.t(`${data.kind}.step3`)}</li></ol>
      <p><a className="kxp-btn" href={data.kind === "pharmacy" ? "/pharmacy" : "/lab"} rel="nofollow">{ctx.t(`${data.kind}.cta`)}</a></p>
      {data.others.length ? <section><h2>{ctx.t(`${data.kind}.others`)}</h2><Chips items={data.others} ctx={ctx} count={false} /></section> : null}
      <Faq group={data.kind} ctx={ctx} n={2} />
      <Emergency ctx={ctx} />
    </article>
  ),
  meta: (d, ctx) => metaFromTemplate(d.kind, ctx, { name: ctx.pick(d.partner.name) }),
  jsonLd: (d, ctx) => [partnerBusiness(d, ctx.locale, ctx.cc, `${ctx.canonicalHost}${ctx.path}`), breadcrumbs(ctx.canonicalHost, d.crumbs, ctx.locale, ctx.path)].filter(Boolean),
});
