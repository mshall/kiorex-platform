import { useState, type ReactNode } from "react";
import { KiorexLogo } from "@/brand/kiorex-logo/KiorexLogo.web";
import type { ComputedLinkGroup, Crumb, FacetLink, PaginationData, ProviderCard, RatingBucket, TemplateCtx } from "../types";
import type { ImageModel } from "../seo/image";
import { day, money } from "../format";
import { ConsentIsland } from "./ConsentIsland";

const homePath = (c: TemplateCtx) => `/${c.locale}/${c.cc}`;

export function PublicLayout({ ctx, children }: { ctx: TemplateCtx; children: ReactNode }) {
  const other = ctx.t("lang.otherCode");
  const switched = ctx.path.replace(/^\/(ar|en)\//, `/${other}/`);
  return (
    <>
      <a className="kxp-skip" href="#main">{ctx.t("skip")}</a>
      <header className="kxp-header">
        <div className="kxp-wrap kxp-header-row">
          <a href={homePath(ctx)} className="kxp-logo" aria-label={ctx.t("brand")}><KiorexLogo variant="full" theme="light" height={64} title="" /></a>
          <nav className="kxp-nav" aria-label="Primary">
            <a href="/search">{ctx.t("nav.search")}</a>
            <a href={switched} hrefLang={other} lang={other} className="kxp-lang">{ctx.t("lang.other")}</a>
          </nav>
        </div>
      </header>
      <main id="main" className="kxp-wrap kxp-main">{children}</main>
      <footer className="kxp-footer">
        <div className="kxp-wrap">
          <p>{ctx.t("footer.line")}</p>
          <p className="kxp-muted">{ctx.t("footer.emergency")}</p>
        </div>
      </footer>
      <ConsentIsland ctx={ctx} />
    </>
  );
}

export function Breadcrumbs({ crumbs, ctx }: { crumbs: Crumb[]; ctx: TemplateCtx }) {
  if (crumbs.length < 2) return null;
  return (
    <nav aria-label="Breadcrumb" className="kxp-crumbs">
      <ol>
        {crumbs.map((c, i) => (
          <li key={i}>{c.path && i < crumbs.length - 1 ? <a href={c.path}>{ctx.pick(c.label)}</a> : <span aria-current={i === crumbs.length - 1 ? "page" : undefined}>{ctx.pick(c.label)}</span>}</li>
        ))}
      </ol>
    </nav>
  );
}

/** Interactive island: a controlled search box that submits to the SPA search (full navigation). Plain HTML form without JS. */
export function SearchBox({ ctx }: { ctx: TemplateCtx }) {
  const [q, setQ] = useState("");
  return (
    <form action="/search" method="get" role="search" className="kxp-search">
      <label htmlFor="kxp-q" className="kxp-sr">{ctx.t("search.label")}</label>
      <input id="kxp-q" name="q" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={ctx.t("search.placeholder")} autoComplete="off" enterKeyHint="search" />
      <button type="submit" className="kxp-btn">{ctx.t("search.submit")}</button>
    </form>
  );
}

export function Stars({ avg, count, ctx }: { avg: number; count: number; ctx: TemplateCtx }) {
  if (!count) return <span className="kxp-muted">{ctx.t("card.noRating")}</span>;
  return <span className="kxp-rating"><span aria-hidden="true">★</span> <strong>{avg.toFixed(1)}</strong> <span className="kxp-muted">{ctx.t("card.reviews", { count })}</span></span>;
}

export const providerHref = (p: ProviderCard, ctx: TemplateCtx): string | null => (p.slug ? `/${ctx.locale}/${ctx.cc}/${p.kind}/${p.slug}` : null);

export function ProviderList({ providers, ctx }: { providers: ProviderCard[]; ctx: TemplateCtx }) {
  return (
    <ul className="kxp-cards">
      {providers.map((p) => {
        const href = providerHref(p, ctx);
        const where = [p.area, p.governorate].filter(Boolean).join(", ");
        return (
          <li key={p.id} className="kxp-card">
            <h3 className="kxp-card-title">{href ? <a href={href}>{ctx.pick(p.name)}</a> : ctx.pick(p.name)}</h3>
            {p.specialty ? <p className="kxp-muted">{ctx.pick(p.specialty.label)}</p> : null}
            {where ? <p className="kxp-muted">{where}</p> : null}
            <p><Stars avg={p.rating.average} count={p.rating.count} ctx={ctx} /></p>
            {p.fee ? <p className="kxp-num" suppressHydrationWarning>{ctx.t("list.fees", { min: money(p.fee.minMinor, ctx.locale, p.fee.currency), max: money(p.fee.maxMinor, ctx.locale, p.fee.currency) })}</p> : null}
            <p className="kxp-muted" suppressHydrationWarning>{p.nextSlotAt ? `${ctx.t("list.next")}: ${day(p.nextSlotAt, ctx.locale)}` : ctx.t("list.noSlot")}</p>
            {href ? <a href={href} className="kxp-link">{ctx.t("card.view")}</a> : null}
          </li>
        );
      })}
    </ul>
  );
}

// ── GRW-P1-F building blocks ──────────────────────────────────────────────────────────────────────────────────

/** Pagination: plain links, self-referencing canonical per page, NO rel prev/next (search engines ignore them; removed on purpose). */
export function Pager({ p, ctx }: { p: PaginationData; ctx: TemplateCtx }) {
  if (p.pages <= 1) return null;
  return (
    <nav className="kxp-pager" aria-label={ctx.t("list.pages")}>
      {p.prevPath ? <a href={p.prevPath}>{ctx.t("list.prev")}</a> : <span />}
      <span aria-current="page">{ctx.t("list.pageOf", { n: p.page, total: p.pages })}</span>
      {p.nextPath ? <a href={p.nextPath}>{ctx.t("list.nextPage")}</a> : <span />}
    </nav>
  );
}

export function Chips({ items, ctx, count = true }: { items: FacetLink[]; ctx: TemplateCtx; count?: boolean }) {
  if (!items.length) return null;
  return <ul className="kxp-chips">{items.map((s) => <li key={s.path}><a href={s.path}>{ctx.pick(s.label)}{count && s.count ? <> <span className="kxp-muted">({s.count})</span></> : null}</a></li>)}</ul>;
}

/** Question and answer pairs written once per template (CMO review pending); native <details>, no script. Answers never state medical claims. */
export function Faq({ group, ctx, vars, n = 3 }: { group: string; ctx: TemplateCtx; vars?: Record<string, string | number>; n?: number }) {
  const items = Array.from({ length: n }, (_, i) => ({ q: ctx.t(`faq.${group}.${i + 1}.q`, vars), a: ctx.t(`faq.${group}.${i + 1}.a`, vars) }));
  return (
    <section className="kxp-faq" aria-labelledby="kxp-faq-h">
      <h2 id="kxp-faq-h">{ctx.t("faq.title")}</h2>
      {items.map((x, i) => <details key={i}><summary>{x.q}</summary><p>{x.a}</p></details>)}
    </section>
  );
}

/** Real star counts of visible reviews; renders nothing when there are none. */
export function RatingBars({ buckets, ctx }: { buckets: RatingBucket[]; ctx: TemplateCtx }) {
  const total = buckets.reduce((s, b) => s + b.count, 0);
  if (!total) return null;
  return (
    <section>
      <h2>{ctx.t("list.distribution")}</h2>
      <table className="kxp-bars"><tbody>
        {buckets.map((b) => (
          <tr key={b.stars}><th scope="row">{ctx.t("list.stars", { n: b.stars })}</th><td><svg className="kxp-bar" viewBox="0 0 100 8" preserveAspectRatio="none" aria-hidden="true" focusable="false"><rect width={Math.round((b.count / total) * 100)} height="8" /></svg></td><td className="kxp-num">{b.count}</td></tr>
        ))}
      </tbody></table>
    </section>
  );
}

/** Responsive picture: AVIF and WebP sources when an image CDN is configured, always width and height, alt text, lazy unless it is the LCP image. */
export function Picture({ model, className }: { model: ImageModel | null; className?: string }) {
  if (!model) return null;
  const { img, sources } = model;
  const tag = <img src={img.src} srcSet={img.srcSet} sizes={img.sizes} width={img.width} height={img.height} alt={img.alt} loading={img.loading} decoding={img.decoding} fetchPriority={img.fetchPriority} className={className} />;
  return sources.length ? <picture>{sources.map((s) => <source key={s.type} type={s.type} srcSet={s.srcSet} sizes={img.sizes} />)}{tag}</picture> : tag;
}

export const Emergency = ({ ctx }: { ctx: TemplateCtx }) => <p className="kxp-notice" role="note">{ctx.t("footer.emergency")}</p>;

/** GRW-P3-F: the internal links the SEO automation computed for this page (clinic, doctors, hubs, neighbours), grouped by role. Plain anchors in the server HTML; absent when there are none. */
export function ComputedLinks({ groups, ctx }: { groups?: ComputedLinkGroup[]; ctx: TemplateCtx }) {
  if (!groups?.length) return null;
  return (
    <nav aria-label={ctx.t("links.computed")} className="kxp-computed" data-computed-links="">
      <h2>{ctx.t("links.computed")}</h2>
      {groups.map((g) => <section key={g.kind} data-links-kind={g.kind}><h3>{ctx.t(`links.kind.${g.kind}`)}</h3><Chips items={g.links} ctx={ctx} count={false} /></section>)}
    </nav>
  );
}
