import { useState, type ReactNode } from "react";
import { KiorexLogo } from "@/brand/components/web/KiorexLogo";
import type { Crumb, ProviderCard, TemplateCtx } from "../types";
import { day, money } from "../format";

const homePath = (c: TemplateCtx) => `/${c.locale}/${c.cc}`;

export function PublicLayout({ ctx, children }: { ctx: TemplateCtx; children: ReactNode }) {
  const other = ctx.t("lang.otherCode");
  const switched = ctx.path.replace(/^\/(ar|en)\//, `/${other}/`);
  return (
    <>
      <a className="kxp-skip" href="#main">{ctx.t("skip")}</a>
      <header className="kxp-header">
        <div className="kxp-wrap kxp-header-row">
          <a href={homePath(ctx)} className="kxp-logo" aria-label={ctx.t("brand")}><KiorexLogo variant="lockup" tone="color" height={36} title="" /></a>
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
