import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMarkets, type MarketRow } from "@/api/growth";
import { StatusChip } from "@/components/kit";
import { CardSkeleton, ErrorState } from "@/components/states";
import { ConfigPanel } from "@/components/growth/ConfigPanel";
import { GrowthPage, Section, selectCls } from "@/components/growth/GrowthPage";

const Row = ({ k, children }: { k: string; children: React.ReactNode }) => <div className="flex min-w-0 justify-between gap-3 border-b border-border/50 py-1.5 text-sm"><dt className="text-muted-foreground">{k}</dt><dd className="min-w-0 break-words text-end font-medium" dir="auto">{children}</dd></div>;

function MarketCard({ m }: { m: MarketRow }) {
  const { t, i18n } = useTranslation(); const ar = i18n.language.startsWith("ar");
  return (
    <Section title={`${m.code} · ${ar ? m.name.ar : m.name.en}`} id={`mk-${m.code}`} className="space-y-1">
      <p className="mb-2 flex flex-wrap items-center gap-2"><StatusChip tone={m.live ? "success" : "warning"} data-testid={`market-live-${m.code}`}>{m.live ? t("growth.markets.live") : t("growth.markets.notLive")}</StatusChip><span className="text-xs text-muted-foreground">{t("growth.markets.liveHint")}</span></p>
      <dl className="grid gap-x-8 md:grid-cols-2" data-testid={`market-${m.code}`}>
        <Row k={t("growth.markets.languages")}>{(m.locales ?? []).join(", ").toUpperCase()}</Row>
        <Row k={t("growth.markets.currency")}>{m.currency} ({m.phoneCode})</Row>
        <Row k={t("growth.markets.timeZone")}>{m.timeZone}</Row>
        <Row k={t("growth.markets.quietHours")}>{m.quietHours.start} - {m.quietHours.end}</Row>
        <Row k={t("growth.markets.consentRegime")}>{String(m.consent.regimeId)}</Row>
        <Row k={t("growth.markets.caps")}>{String(m.consent.maxMarketingPerDay)} / {String(m.consent.maxMarketingPerWeek)}</Row>
        <Row k={t("growth.markets.withdrawal")}>{t("growth.markets.seconds", { n: Number(m.consent.withdrawalPropagationSeconds) })}</Row>
        <Row k={t("growth.markets.retention")}>{t("growth.markets.retentionValue", { linked: Number(m.retention.touchEvidenceRetentionMonths), unlinked: Number(m.retention.unlinkedTouchRetentionMonths) })}</Row>
        <Row k={t("growth.markets.geography")}>{t("growth.markets.geoValue", { cities: m.geography.cities, districts: m.geography.districts })} · <code className="text-xs">{m.geography.geographyListRef ?? t("growth.markets.noGeoRef")}</code></Row>
        <Row k={t("growth.markets.licence")}>{m.marketing.marketingLicenceConfirmed ? t("growth.common.yes") : t("growth.markets.licenceNo")}</Row>
      </dl>
      <h3 className="pt-2 text-sm font-semibold">{t("growth.markets.marketingRules")}</h3>
      <ul className="space-y-1 text-sm" data-testid={`market-flags-${m.code}`}>{m.marketing.flags.map((f) => <li key={f.key} className="flex flex-wrap items-center gap-2"><code className="text-xs">{f.key}</code><StatusChip tone={f.effective ? "success" : "neutral"}>{f.effective ? t("growth.common.on") : t("growth.common.off")}</StatusChip>{!f.effective && <span className="text-xs text-muted-foreground">{f.reason}</span>}</li>)}</ul>
      <p className="pt-1 text-xs text-muted-foreground">{m.geography.note}</p>
    </Section>
  );
}

/** Market configurations: the facts every market needs, with the versioned MARKET_GROWTH and CONSENT_DEFAULTS configs editable below. Egypt is the only live market. */
export default function GrowthMarketsPage() {
  const { t } = useTranslation(); const q = useMarkets(); const [code, setCode] = useState<string>("");
  const rows = q.data ?? []; const current = code || rows.find((r) => r.live)?.code || rows[0]?.code || "EG";
  return (
    <GrowthPage section="markets" toolbar={rows.length > 1 ? <label className="flex items-center gap-2 text-sm"><span className="text-muted-foreground">{t("growth.common.market")}</span><select className={selectCls} value={current} onChange={(e) => setCode(e.target.value)} data-testid="markets-picker">{rows.map((r) => <option key={r.code} value={r.code}>{r.code}</option>)}</select></label> : undefined}>
      {q.isLoading ? <CardSkeleton rows={2} /> : q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : (
        <>
          {rows.filter((r) => r.code === current).map((m) => <MarketCard key={m.code} m={m} />)}
          <h2 className="pt-2 text-xl">{t("growth.markets.growthConfig")}</h2>
          <ConfigPanel kind="MARKET_GROWTH" market={current} />
          <h2 className="pt-2 text-xl">{t("growth.markets.consentConfig")}</h2>
          <ConfigPanel kind="CONSENT_DEFAULTS" market={current} showScopePicker={rows.filter((r) => r.live).length > 1} />
        </>)}
    </GrowthPage>
  );
}
