import type { ClinicData, DoctorData, HomeData, ListData, NotFoundData, TemplateCtx } from "../types";
import { Breadcrumbs, ProviderList, SearchBox, Stars } from "../components/parts";
import { registerTemplate } from "../registry";
import { buildMeta } from "../seo/meta";
import { breadcrumbs, listingBlocks, organization, physician, website } from "../seo/jsonld";
import { day, money } from "../format";

/**
 * Default templates: real, data-driven shells for every public page type. GRW-P1-F replaces them with the full template set (FAQ blocks, richer
 * structured data, nearby districts) through `registerTemplate`. They already render the content without JavaScript (view-source acceptance).
 */
const sep = (ctx: TemplateCtx) => (ctx.locale === "ar" ? "، " : ", ");

// ── home ──────────────────────────────────────────────────────────────────────────────────────────────────────
registerTemplate<HomeData>({
  types: ["home"],
  Component: ({ data, ctx }) => (
    <>
      <section className="kxp-hero">
        <h1>{ctx.t("home.h1")}</h1>
        <p className="kxp-lead">{ctx.t("home.lead")}</p>
        <SearchBox ctx={ctx} />
        {data.liveProviders > 0 ? <p className="kxp-muted">{ctx.t("home.live", { count: data.liveProviders })}</p> : <p className="kxp-muted">{ctx.t("home.empty")}</p>}
      </section>
      {data.specialties.length ? <section><h2>{ctx.t("home.specialties")}</h2><ul className="kxp-chips">{data.specialties.map((s) => <li key={s.path}><a href={s.path}>{ctx.pick(s.label)} <span className="kxp-muted">({s.count})</span></a></li>)}</ul></section> : null}
      {data.cities.length ? <section><h2>{ctx.t("home.cities")}</h2><ul className="kxp-chips">{data.cities.map((s) => <li key={s.path}><a href={s.path}>{ctx.pick(s.label)} <span className="kxp-muted">({s.count})</span></a></li>)}</ul></section> : null}
    </>
  ),
  meta: (_d, ctx) => buildMeta(ctx.t("meta.home.title"), ctx.t("meta.home.desc"), ctx.locale),
  jsonLd: (_d, ctx) => [organization(ctx.canonicalHost), website(ctx.canonicalHost, ctx.locale, ctx.cc)],
});

// ── listings: hub, city, district, care-district ────────────────────────────────────────────────────────────────
function feeText(d: ListData, ctx: TemplateCtx): string {
  const f = d.facets.feeRange;
  return f ? ctx.t("list.fees", { min: money(f.minMinor, ctx.locale, f.currency), max: money(f.maxMinor, ctx.locale, f.currency) }) : "";
}
registerTemplate<ListData>({
  types: ["hub", "city", "district", "care-district"],
  Component: ({ data, ctx }) => {
    const pages = Math.max(1, Math.ceil(data.liveProviders / data.pageSize));
    const base = ctx.path;
    return (
      <>
        <Breadcrumbs crumbs={data.crumbs} ctx={ctx} />
        <h1>{ctx.pick(data.title)}</h1>
        <ul className="kxp-facts">
          <li>{ctx.t("list.count", { count: data.liveProviders })}</li>
          {data.facets.feeRange ? <li className="kxp-num" suppressHydrationWarning>{feeText(data, ctx)}</li> : null}
          {data.facets.rating ? <li>{ctx.t("list.rating", { avg: data.facets.rating.average.toFixed(1), count: data.facets.rating.count })}</li> : null}
          {data.facets.languages.length ? <li>{ctx.t("list.languages", { list: data.facets.languages.join(sep(ctx)) })}</li> : null}
          {data.facets.nextSlotAt ? <li suppressHydrationWarning>{ctx.t("list.next")}: {day(data.facets.nextSlotAt, ctx.locale)}</li> : null}
        </ul>
        <ProviderList providers={data.providers} ctx={ctx} />
        {pages > 1 ? (
          <nav className="kxp-pager" aria-label={ctx.t("list.page", { n: data.page })}>
            {data.page > 1 ? <a rel="prev" href={data.page === 2 ? base : `${base}?page=${data.page - 1}`}>{ctx.t("list.prev")}</a> : <span />}
            <span>{ctx.t("list.page", { n: data.page })}</span>
            {data.page < pages ? <a rel="next" href={`${base}?page=${data.page + 1}`}>{ctx.t("list.nextPage")}</a> : <span />}
          </nav>
        ) : null}
        {data.related.length ? <section><h2>{ctx.t("list.related")}</h2><ul className="kxp-chips">{data.related.map((r) => <li key={r.path}><a href={r.path}>{ctx.pick(r.label)} <span className="kxp-muted">({r.count})</span></a></li>)}</ul></section> : null}
      </>
    );
  },
  meta: (d, ctx) => buildMeta(ctx.pick(d.title), ctx.t("meta.list.desc", { count: d.liveProviders, fees: d.facets.feeRange ? `${feeText(d, ctx)}. ` : "" }), ctx.locale),
  jsonLd: (d, ctx) => listingBlocks(d, ctx.canonicalHost, ctx.locale, ctx.cc, ctx.path),
});

// ── doctor / nurse profile ─────────────────────────────────────────────────────────────────────────────────────
registerTemplate<DoctorData>({
  types: ["doctor", "nurse"],
  Component: ({ data, ctx }) => {
    const p = data.provider;
    const where = [p.area, p.governorate].filter(Boolean).join(sep(ctx));
    return (
      <article>
        <Breadcrumbs crumbs={data.crumbs} ctx={ctx} />
        <div className="kxp-profile">
          {p.photoUrl ? <img src={p.photoUrl} alt="" width={96} height={96} className="kxp-avatar" loading="eager" decoding="async" /> : <div className="kxp-avatar kxp-avatar-ph" aria-hidden="true" />}
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
          {p.homeVisit ? <><dt>{ctx.t("doctor.home")}</dt><dd>{p.coverageDistricts.length ? ctx.t("doctor.homeCoverage", { list: p.coverageDistricts.join(sep(ctx)) }) : ""}</dd></> : null}
        </dl>
        <section>
          <h2>{ctx.t("doctor.reviews")}</h2>
          {data.reviews.length ? <ul className="kxp-reviews">{data.reviews.map((r, i) => <li key={i}><span aria-hidden="true">{"★".repeat(r.rating)}</span> {r.text ?? ""}</li>)}</ul> : <p className="kxp-muted">{ctx.t("doctor.noReviews")}</p>}
        </section>
        {data.related.length ? <section><h2>{ctx.t("list.related")}</h2><ul className="kxp-chips">{data.related.map((r) => <li key={r.path}><a href={r.path}>{ctx.pick(r.label)}</a></li>)}</ul></section> : null}
      </article>
    );
  },
  meta: (d, ctx) => {
    const p = d.provider;
    const name = ctx.pick(p.name);
    const spec = p.specialty ? ctx.pick(p.specialty.label) : "";
    const where = [p.area, p.governorate].filter(Boolean).join(sep(ctx));
    const rating = p.rating.count ? `${ctx.t("list.rating", { avg: p.rating.average.toFixed(1), count: p.rating.count })}. ` : "";
    return buildMeta(spec ? ctx.t("meta.doctor.title", { name, specialty: spec }) : name, ctx.t("meta.doctor.desc", { name, specialty: spec, where: where ? (ctx.locale === "ar" ? ` في ${where}` : ` in ${where}`) : "", rating }), ctx.locale, p.photoUrl);
  },
  jsonLd: (d, ctx) => {
    const url = `${ctx.canonicalHost}${ctx.path}`;
    return [physician(d.provider, ctx.canonicalHost, ctx.locale, ctx.cc, url, { reviewMarkup: ctx.reviewMarkup, bookable: d.bookable }), breadcrumbs(ctx.canonicalHost, d.crumbs, ctx.locale, ctx.path)].filter(Boolean);
  },
});

// ── clinic ────────────────────────────────────────────────────────────────────────────────────────────────────
registerTemplate<ClinicData>({
  types: ["clinic"],
  Component: ({ data, ctx }) => (
    <>
      <Breadcrumbs crumbs={data.crumbs} ctx={ctx} />
      <h1>{ctx.pick(data.clinic.name)}</h1>
      {[data.clinic.area, data.clinic.governorate].filter(Boolean).length ? <p className="kxp-muted">{[data.clinic.area, data.clinic.governorate].filter(Boolean).join(sep(ctx))}</p> : null}
      <h2>{ctx.t("clinic.doctors")}</h2>
      {data.providers.length ? <ProviderList providers={data.providers} ctx={ctx} /> : <p className="kxp-muted">{ctx.t("clinic.none")}</p>}
    </>
  ),
  meta: (d, ctx) => {
    const where = [d.clinic.area, d.clinic.governorate].filter(Boolean).join(sep(ctx));
    return buildMeta(ctx.pick(d.clinic.name), ctx.t("meta.clinic.desc", { name: ctx.pick(d.clinic.name), count: d.liveProviders, where: where ? (ctx.locale === "ar" ? ` في ${where}` : ` in ${where}`) : "" }), ctx.locale);
  },
  jsonLd: (d, ctx) => {
    const medical = { "@context": "https://schema.org", "@type": "MedicalClinic", name: ctx.pick(d.clinic.name), url: `${ctx.canonicalHost}${ctx.path}`, address: { "@type": "PostalAddress", ...(d.clinic.area ? { addressLocality: d.clinic.area } : {}), ...(d.clinic.governorate ? { addressRegion: d.clinic.governorate } : {}), addressCountry: ctx.cc.toUpperCase() } };
    return [medical, breadcrumbs(ctx.canonicalHost, d.crumbs, ctx.locale, ctx.path)].filter(Boolean);
  },
});

// ── not found ───────────────────────────────────────────────────────────────────────────────────────────────────
registerTemplate<NotFoundData>({
  types: ["not-found", "pharmacy", "lab", "static"],
  Component: ({ ctx }) => (
    <section className="kxp-hero" data-testid="public-not-found">
      <h1>{ctx.t("notFound.title")}</h1>
      <p className="kxp-lead">{ctx.t("notFound.body")}</p>
      <SearchBox ctx={ctx} />
      <p><a className="kxp-btn" href={`/${ctx.locale}/${ctx.cc}`}>{ctx.t("notFound.home")}</a></p>
    </section>
  ),
  meta: (_d, ctx) => buildMeta(ctx.t("meta.notFound.title"), ctx.t("notFound.body"), ctx.locale),
  jsonLd: () => [],
});
