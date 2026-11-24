import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useLandingPages } from "@/api/growth";
import { StatusChip } from "@/components/kit";
import { DataTable } from "@/components/DataTable";
import { CardSkeleton, ErrorState } from "@/components/states";
import { GrowthPage, MarketSelect, Section, selectCls, useGrowthMarket } from "@/components/growth/GrowthPage";
import { formatDateTime } from "@/lib/format";

/** Landing page management (read-only in Phase 1): the pages the site generated, whether each is indexable and why not. Editing page copy is not a Phase 1 feature. */
export default function GrowthLandingPage() {
  const { t, i18n } = useTranslation(); const g = useGrowthMarket();
  const [indexable, setIndexable] = useState(""); const [pageType, setPageType] = useState("");
  const q = useLandingPages(g.market, indexable, pageType);
  return (
    <GrowthPage section="landing" toolbar={<><MarketSelect g={g} />
      <label className="flex items-center gap-2 text-sm"><span className="text-muted-foreground">{t("growth.landing.filterIndexable")}</span><select className={selectCls} value={indexable} onChange={(e) => setIndexable(e.target.value)} data-testid="landing-filter-indexable"><option value="">{t("growth.common.all")}</option><option value="true">{t("growth.landing.indexable")}</option><option value="false">{t("growth.landing.noindex")}</option></select></label>
      <label className="flex items-center gap-2 text-sm"><span className="text-muted-foreground">{t("growth.landing.pageType")}</span><select className={selectCls} value={pageType} onChange={(e) => setPageType(e.target.value)}><option value="">{t("growth.common.all")}</option>{["HOME", "SPECIALTY_CITY", "SPECIALTY_DISTRICT", "CARE_TYPE_DISTRICT", "HUB", "DOCTOR", "CLINIC"].map((x) => <option key={x} value={x}>{x}</option>)}</select></label></>}>
      <Section title={t("growth.landing.pages")} id="lp-pages" hint={t("growth.landing.pagesHint", { total: q.data?.total ?? 0 })}>
        {q.isLoading ? <CardSkeleton rows={2} /> : q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : (
          <DataTable caption={t("growth.landing.pages")} rows={q.data?.items ?? []} rowKey={(r) => r.id} empty={t("growth.landing.empty")} columns={[
            { key: "t", header: t("growth.landing.pageType"), cell: (r) => <code className="text-xs">{r.pageType}</code> }, { key: "l", header: t("growth.landing.locale"), cell: (r) => r.locale },
            { key: "p", header: t("growth.landing.params"), cell: (r) => <code className="text-xs" dir="ltr">{Object.values(r.params).join(" / ") || "—"}</code> },
            { key: "i", header: t("growth.landing.state"), cell: (r) => <StatusChip tone={r.indexable ? "success" : "warning"}>{r.indexable ? t("growth.landing.indexable") : t("growth.landing.noindex")}</StatusChip> },
            { key: "w", header: t("growth.landing.reasons"), cell: (r) => r.reasons.length ? <span className="text-xs">{r.reasons.join(", ")}</span> : "—" },
            { key: "d", header: t("growth.seo.lastRenderedShort"), cell: (r) => <span className="text-xs">{formatDateTime(r.lastRenderedAt, i18n.language)}</span> },
          ]} />)}
      </Section>
    </GrowthPage>
  );
}
