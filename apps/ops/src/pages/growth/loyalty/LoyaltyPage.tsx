import { useTranslation } from "react-i18next";
import { useLoyaltyRules, useLoyaltySummary, type Cell } from "@/api/loyalty";
import { Section } from "@/components/growth/GrowthPage";
import { StatCard, StatusChip } from "@/components/kit";
import { CardSkeleton, ErrorState } from "@/components/states";
import { fmtN } from "@/lib/growthFormat";

const MASK = "<10";
const cell = (v: Cell | undefined) => (v === null || v === undefined ? MASK : fmtN(v));

/** The loyalty overview (GRW-P4-D): where the programme stands, in aggregate. Every number is a count or a sum of 10 people or more; a smaller group shows as <10. There is no person, booking or balance of one person here. */
export default function LoyaltyPage() {
  const { t } = useTranslation(); const s = useLoyaltySummary(); const r = useLoyaltyRules();
  return (
    <div className="space-y-5">
      <p className="rounded-xl border bg-card p-3 text-sm" data-testid="loy-not-money">{t("growth.loyalty.notMoney")}</p>
      {r.data && (
        <div className="flex flex-wrap items-center gap-2" data-testid="loy-state">
          <StatusChip tone={r.data.flagOn ? "success" : "warning"}>{r.data.flagOn ? t("growth.loyalty.flagOn") : t("growth.loyalty.flagOff")}</StatusChip>
          <StatusChip tone={r.data.allZero ? "warning" : "success"} dot={false}>{r.data.allZero ? t("growth.loyalty.rulesZero") : t("growth.loyalty.rulesSet")}</StatusChip>
        </div>)}
      {r.data?.allZero && <p role="note" className="rounded-xl border border-warning/40 bg-warning/5 p-3 text-sm" data-testid="loy-zero-note" data-needs-human="true">{t("growth.loyalty.zeroNote")}</p>}
      <Section title={t("growth.loyalty.overview")} id="loy-overview" hint={t("growth.loyalty.overviewHint", { k: s.data?.k ?? 10 })}>
        {s.isLoading ? <CardSkeleton rows={2} /> : s.error || !s.data ? <ErrorState error={s.error} onRetry={() => void s.refetch()} /> : (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="loy-cards">
              <StatCard label={t("growth.loyalty.accounts")} value={cell(s.data.accounts)} />
              <StatCard label={t("growth.loyalty.outstanding")} value={cell(s.data.points.outstanding)} hint={t("growth.loyalty.points")} />
              <StatCard label={t("growth.loyalty.earned30")} value={cell(s.data.last30Days.earned.points)} hint={t("growth.loyalty.points")} />
              <StatCard label={t("growth.loyalty.expired30")} value={cell(s.data.last30Days.expired.points)} hint={t("growth.loyalty.points")} />
              <StatCard label={t("growth.loyalty.converted30")} value={cell(s.data.last30Days.converted.points)} hint={t("growth.loyalty.points")} />
              <StatCard label={t("growth.loyalty.reversed30")} value={cell(s.data.last30Days.reversed.points)} hint={t("growth.loyalty.points")} />
              <StatCard label={t("growth.loyalty.programsActive")} value={fmtN(s.data.partnerships.ACTIVE?.programs ?? 0)} />
              <StatCard label={t("growth.loyalty.programsDraft")} value={fmtN(s.data.partnerships.DRAFT?.programs ?? 0)} />
            </div>
            <p className="text-sm text-muted-foreground" data-testid="loy-suppressed">{s.data.suppressed.length ? t("growth.loyalty.suppressedNote", { k: s.data.k }) : t("growth.loyalty.noSuppression")}</p>
          </div>)}
      </Section>
      <Section title={t("growth.loyalty.howTitle")} id="loy-how">
        <ul className="list-disc space-y-1 ps-5 text-sm" data-testid="loy-how">{(["how1", "how2", "how3", "how4"] as const).map((k) => <li key={k}>{t(`growth.loyalty.${k}`)}</li>)}</ul>
      </Section>
    </div>
  );
}
