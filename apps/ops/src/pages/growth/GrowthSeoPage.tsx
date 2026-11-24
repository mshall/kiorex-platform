import { useState } from "react";
import { useTranslation } from "react-i18next";
import { fmtN } from "@/lib/growthFormat";
import { useRedirects, useSeoStatus, useSlugs } from "@/api/growth";
import { StatCard, StatusChip } from "@/components/kit";
import { DataTable } from "@/components/DataTable";
import { Input } from "@/components/ui/input";
import { CardSkeleton, ErrorState } from "@/components/states";
import { BarList } from "@/components/growth/BarList";
import { ConfigPanel } from "@/components/growth/ConfigPanel";
import { GrowthPage, MarketSelect, Section, selectCls, useGrowthMarket } from "@/components/growth/GrowthPage";
import { formatDateTime } from "@/lib/format";

/** SEO management: metadata and thin-page thresholds (versioned SEO config), robots and sitemap status, slug history and redirects. */
export default function GrowthSeoPage() {
  const { t, i18n } = useTranslation(); const g = useGrowthMarket();
  const st = useSeoStatus(g.market); const [q, setQ] = useState(""); const [type, setType] = useState("");
  const slugs = useSlugs(g.market, q, type); const redirects = useRedirects(g.market);
  const s = st.data;
  return (
    <GrowthPage section="seo" toolbar={<MarketSelect g={g} />}>
      {st.isLoading ? <CardSkeleton rows={2} /> : st.error ? <ErrorState error={st.error} onRetry={() => void st.refetch()} /> : s && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="seo-stats">
            <StatCard label={t("growth.seo.indexable")} value={fmtN(s.pages.indexable)} />
            <StatCard label={t("growth.seo.thin")} value={fmtN(s.pages.thin)} tone={s.pages.thin > 0 ? "warn" : "ok"} hint={t("growth.seo.thinHint")} />
            <StatCard label={t("growth.seo.shards")} value={s.sitemap.shards} hint={t("growth.seo.shardHint", { size: fmtN(s.sitemap.shardSize) })} />
            <StatCard label={t("growth.seo.slugs")} value={`${s.slugs.current}/${s.slugs.history}`} hint={t("growth.seo.slugsHint")} />
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            <Section title={t("growth.seo.thresholds")} id="seo-thr" hint={t("growth.seo.thresholdsHint")}>
              <dl className="grid gap-2 text-sm" data-testid="seo-thresholds">{(["minLiveProviders", "minUniqueBlocks", "maxSiblingSimilarityPercent"] as const).map((k) => <div key={k} className="flex justify-between gap-3 border-b border-border/50 py-1"><dt>{t(`growth.seo.thr.${k}`)}</dt><dd className="kx-label-num font-semibold">{s.thresholds[k]}</dd></div>)}</dl>
              {s.pages.thinReasons.length > 0 && <div className="mt-3"><h3 className="mb-1 text-sm font-semibold">{t("growth.seo.thinReasons")}</h3><BarList testid="thin-reasons" tone="pulse" rows={s.pages.thinReasons.map((r) => ({ label: r.reason, value: r.count }))} /></div>}
            </Section>
            <Section title={t("growth.seo.robotsSitemap")} id="seo-robots">
              <p className="flex flex-wrap items-center gap-2 text-sm" data-testid="seo-robots"><StatusChip tone={s.robots.mode === "ALLOW_PUBLIC" ? "success" : "warning"}>{t(`growth.seo.robotsMode.${s.robots.mode}`)}</StatusChip><span className="text-muted-foreground">{t("growth.seo.environment", { env: s.robots.environment })}</span></p>
              <p className="mt-2 text-xs text-muted-foreground">{t("growth.seo.robotsNote")}</p>
              <p className="mt-2 text-sm" data-testid="seo-sitemap">{t("growth.seo.sitemapLine", { pages: s.sitemap.indexablePages, shards: s.sitemap.shards })} · {t("growth.seo.lastRendered", { at: formatDateTime(s.sitemap.lastRenderedAt, i18n.language) })}</p>
              <div className="mt-3 rounded-xl bg-muted/50 p-3 text-xs" data-testid="seo-live">
                <b>{t("growth.seo.live")}</b>
                {s.live.reachable ? (<><p>{t("growth.seo.liveRobots", { status: s.live.robots?.status ?? "—" })}</p>{s.live.robots && <pre className="mt-1 overflow-x-auto" dir="ltr">{s.live.robots.lines.join("\n")}</pre>}<p>{t("growth.seo.liveSitemap", { status: s.live.sitemap?.status ?? "—", n: s.live.sitemap?.shards ?? 0 })}</p></>) : <p>{t("growth.seo.liveUnreachable")}</p>}
              </div>
            </Section>
          </div>
        </>)}
      <ConfigPanel kind="SEO" market={g.market} showScopePicker={g.show} />
      <Section title={t("growth.seo.slugHistory")} id="seo-slugs" hint={t("growth.seo.slugHistoryHint")}>
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <label className="text-sm"><span className="sr-only">{t("growth.seo.slugSearch")}</span><Input dir="ltr" className="w-64" placeholder={t("growth.seo.slugSearch")} value={q} onChange={(e) => setQ(e.target.value)} data-testid="slug-search" /></label>
          <select aria-label={t("growth.seo.entityType")} className={selectCls} value={type} onChange={(e) => setType(e.target.value)}><option value="">{t("growth.common.all")}</option>{["DOCTOR", "CLINIC", "PHARMACY", "LAB", "SPECIALTY", "CITY", "DISTRICT"].map((x) => <option key={x} value={x}>{x}</option>)}</select>
        </div>
        <DataTable caption={t("growth.seo.slugHistory")} rows={slugs.data ?? []} rowKey={(r) => r.id} empty={t("growth.common.noData")} columns={[
          { key: "t", header: t("growth.seo.entityType"), cell: (r) => r.entityType }, { key: "s", header: t("growth.seo.slug"), cell: (r) => <code className="text-xs">{r.slug}</code> },
          { key: "h", header: t("growth.seo.previous"), cell: (r) => r.history.length === 0 ? "—" : <ul className="space-y-0.5 text-xs">{r.history.map((h) => <li key={h.slug}><code>{h.slug}</code> → <code>{h.replacedBy ?? t("growth.seo.gone")}</code></li>)}</ul> },
          { key: "u", header: t("growth.seo.updated"), cell: (r) => <span className="text-xs">{formatDateTime(r.updatedAt, i18n.language)}</span> },
        ]} />
      </Section>
      <Section title={t("growth.seo.redirects")} id="seo-redirects" hint={t("growth.seo.redirectsHint")}>
        <DataTable caption={t("growth.seo.redirects")} rows={redirects.data ?? []} rowKey={(r) => r.id} empty={t("growth.common.noData")} columns={[
          { key: "f", header: t("growth.seo.from"), cell: (r) => <code className="text-xs">{r.from}</code> }, { key: "to", header: t("growth.seo.to"), cell: (r) => <code className="text-xs">{r.to ?? "—"}</code> },
          { key: "st", header: t("growth.seo.status"), cell: (r) => <StatusChip tone={r.status === 301 ? "info" : "neutral"}>{r.status}</StatusChip> }, { key: "at", header: t("growth.seo.updated"), cell: (r) => <span className="text-xs">{formatDateTime(r.supersededAt, i18n.language)}</span> },
        ]} />
      </Section>
    </GrowthPage>
  );
}
