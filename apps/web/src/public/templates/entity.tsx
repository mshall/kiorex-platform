import type { ClinicData, DoctorData, TemplateCtx } from "../types";
import { Breadcrumbs, Chips, Emergency, Faq, Picture, ProviderList, Stars } from "../components/parts";
import { registerTemplate } from "../registry";
import { metaFromTemplate } from "../seo/meta-templates";
import { imageModel } from "../seo/image";
import { breadcrumbs, medicalClinic, physician } from "../seo/jsonld";
import { day, money } from "../format";
import { feeText, inWhere, sep } from "./shared";

// ── doctor and nurse profile ──────────────────────────────────────────────────────────────────────────────────
const whereOf = (p: DoctorData["provider"], ctx: TemplateCtx) => [p.area, p.governorate].filter(Boolean).join(sep(ctx));

registerTemplate<DoctorData>({
  types: ["doctor", "nurse"],
  Component: ({ data, ctx }) => {
    const p = data.provider;
    const where = whereOf(p, ctx);
    const alt = [ctx.pick(p.name), p.specialty ? ctx.pick(p.specialty.label) : "", where].filter(Boolean).join(sep(ctx));
    const photo = imageModel({ url: p.photoUrl, alt, width: 96, height: 96, priority: true, cdn: ctx.imageCdn });
    return (
      <article>
        <Breadcrumbs crumbs={data.crumbs} ctx={ctx} />
        <div className="kxp-profile">
          {photo ? <Picture model={photo} className="kxp-avatar" /> : <div className="kxp-avatar kxp-avatar-ph" aria-hidden="true" />}
          <div>
            <h1>{ctx.pick(p.name)}</h1>
            {p.title ? <p className="kxp-muted">{ctx.pick(p.title)}</p> : null}
            {p.specialty ? <p className="kxp-lead">{ctx.pick(p.specialty.label)}</p> : null}
            <p><Stars avg={p.rating.average} count={p.rating.count} ctx={ctx} /></p>
          </div>
        </div>
        {data.bookable ? <p><a className="kxp-btn kxp-btn-lg" href={data.bookPath} rel="nofollow">{ctx.t("doctor.book")}</a></p> : <p className="kxp-notice" role="status">{ctx.t("doctor.paused")}</p>}
        <dl className="kxp-dl">
          {p.clinicName.en || p.clinicName.ar ? <><dt>{ctx.t("doctor.clinic")}</dt><dd>{ctx.pick(p.clinicName)}</dd></> : null}
          {where ? <><dt>{ctx.t("doctor.location")}</dt><dd>{where}</dd></> : null}
          {p.fee ? <><dt>{ctx.t("doctor.fees")}</dt><dd className="kxp-num" suppressHydrationWarning>{p.fee.minMinor === p.fee.maxMinor ? money(p.fee.minMinor, ctx.locale, p.fee.currency) : `${money(p.fee.minMinor, ctx.locale, p.fee.currency)} - ${money(p.fee.maxMinor, ctx.locale, p.fee.currency)}`}</dd></> : null}
          {p.languages.length ? <><dt>{ctx.t("doctor.languages")}</dt><dd>{p.languages.join(sep(ctx))}</dd></> : null}
          {p.nextSlotAt && data.bookable ? <><dt>{ctx.t("doctor.next")}</dt><dd suppressHydrationWarning>{day(p.nextSlotAt, ctx.locale)}<br /><span className="kxp-muted">{ctx.t("doctor.nextNote")}</span></dd></> : null}
          {p.homeVisit ? <><dt>{ctx.t("doctor.home")}</dt><dd>{p.coverageDistricts.length ? ctx.t("doctor.homeCoverage", { list: p.coverageDistricts.join(sep(ctx)) }) : ctx.t("doctor.homeYes")}</dd></> : null}
          {p.acceptsDeposit ? <><dt>{ctx.t("doctor.depositLabel")}</dt><dd>{ctx.t("doctor.deposit")}</dd></> : null}
        </dl>
        <section>
          <h2>{ctx.t("doctor.reviews")}</h2>
          {data.reviews.length ? <ul className="kxp-reviews">{data.reviews.map((r, i) => <li key={i}><span aria-hidden="true">{"★".repeat(r.rating)}</span> {r.text ?? ""}</li>)}</ul> : <p className="kxp-muted">{ctx.t("doctor.noReviews")}</p>}
        </section>
        {data.similar.length ? <section><h2>{ctx.t("doctor.similar")}</h2><ProviderList providers={data.similar} ctx={ctx} /></section> : null}
        {data.related.length ? <section><h2>{ctx.t("list.related")}</h2><Chips items={data.related} ctx={ctx} count={false} /></section> : null}
        <Faq group={data.kind === "nurse" ? "nurse" : "doctor"} ctx={ctx} />
        <Emergency ctx={ctx} />
      </article>
    );
  },
  meta: (d, ctx) => {
    const p = d.provider;
    const rating = p.rating.count ? `${ctx.t("list.rating", { avg: p.rating.average.toFixed(1), count: p.rating.count })}. ` : "";
    return metaFromTemplate(d.kind, ctx, { name: `${ctx.pick(p.name)}${d.homonym ? ` ${d.homonym}` : ""}`, specialty: p.specialty ? ctx.pick(p.specialty.label) : "", where: inWhere(ctx, whereOf(p, ctx)), rating }, p.photoUrl);
  },
  jsonLd: (d, ctx) => {
    const url = `${ctx.canonicalHost}${ctx.path}`;
    return [physician(d.provider, ctx.canonicalHost, ctx.locale, ctx.cc, url, { ratingMarkup: d.ratingMarkup && ctx.reviewMarkup, bookable: d.bookable }), breadcrumbs(ctx.canonicalHost, d.crumbs, ctx.locale, ctx.path)].filter(Boolean);
  },
});

// ── clinic ────────────────────────────────────────────────────────────────────────────────────────────────────
registerTemplate<ClinicData>({
  types: ["clinic"],
  Component: ({ data, ctx }) => {
    const where = [data.clinic.area, data.clinic.governorate].filter(Boolean).join(sep(ctx));
    return (
      <>
        <Breadcrumbs crumbs={data.crumbs} ctx={ctx} />
        <h1>{ctx.pick(data.clinic.name)}</h1>
        {where ? <p className="kxp-muted">{where}</p> : null}
        <p className="kxp-intro">{ctx.t("clinic.intro", { count: data.liveProviders, specialties: data.specialties.map((s) => ctx.pick(s.label)).join(sep(ctx)) })}</p>
        <ul className="kxp-facts">
          {data.facets.feeRange ? <li className="kxp-num" suppressHydrationWarning>{feeText(data.facets.feeRange, ctx)}</li> : null}
          {data.facets.languages.length ? <li>{ctx.t("list.languages", { list: data.facets.languages.join(sep(ctx)) })}</li> : null}
          {data.facets.rating ? <li>{ctx.t("list.rating", { avg: data.facets.rating.average.toFixed(1), count: data.facets.rating.count })}</li> : null}
          {data.facets.nextSlotAt ? <li suppressHydrationWarning>{ctx.t("list.next")}: {day(data.facets.nextSlotAt, ctx.locale)}</li> : null}
        </ul>
        <h2>{ctx.t("clinic.doctors")}</h2>
        {data.providers.length ? <ProviderList providers={data.providers} ctx={ctx} /> : <p className="kxp-muted">{ctx.t("clinic.none")}</p>}
        {data.links.length ? <section><h2>{ctx.t("list.related")}</h2><Chips items={data.links} ctx={ctx} count={false} /></section> : null}
        <Faq group="clinic" ctx={ctx} n={2} />
        <Emergency ctx={ctx} />
      </>
    );
  },
  meta: (d, ctx) => {
    const where = [d.clinic.area, d.clinic.governorate].filter(Boolean).join(sep(ctx));
    return metaFromTemplate("clinic", ctx, { name: `${ctx.pick(d.clinic.name)}${d.homonym ? ` ${d.homonym}` : ""}`, count: d.liveProviders, where: inWhere(ctx, where) });
  },
  jsonLd: (d, ctx) => [medicalClinic(d, ctx.canonicalHost, ctx.locale, ctx.cc, `${ctx.canonicalHost}${ctx.path}`), breadcrumbs(ctx.canonicalHost, d.crumbs, ctx.locale, ctx.path)].filter(Boolean),
});
