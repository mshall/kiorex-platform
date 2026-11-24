import { useTranslation } from "react-i18next";
import { useLtv } from "@/api/cohorts";
import { StatusChip } from "@/components/kit";
import { CardSkeleton, ErrorState } from "@/components/states";
import { Section } from "@/components/growth/GrowthPage";
import { fmtN } from "@/lib/growthFormat";

const money = (minor: number) => fmtN(Math.round(minor / 100));
/** LTV estimates by source, campaign and platform: always labelled ESTIMATE, with n, horizon and an interval. No per-person value exists, and a group below 10 patients has no row. */
export default function LtvPage() {
  const { t } = useTranslation(); const q = useLtv();
  if (q.isLoading) return <CardSkeleton rows={4} />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const d = q.data!;
  return (
    <div className="space-y-5">
      <p className="rounded-xl border bg-card p-3 text-sm" data-testid="ltv-estimate-note"><StatusChip tone="warning" dot={false}>{t("growth.cohorts.estimate")}</StatusChip> {t("growth.cohorts.ltvNote", { months: d.policy.horizonMonths, pct: d.policy.intervalPercent })}</p>
      {d.rows.length === 0 ? <p className="rounded-xl border bg-card p-4 text-sm" data-testid="ltv-empty">{t("growth.cohorts.ltvEmpty")}</p> : (
        <Section title={t("growth.cohorts.ltvTitle")} id="coh-ltv" hint={t("growth.cohorts.ltvHint", { version: d.modelVersion })}>
          <div className="overflow-auto rounded-xl border" role="region" aria-label={t("growth.cohorts.ltvCaption")} tabIndex={0}>
            <table className="w-full min-w-[560px] border-separate border-spacing-0 text-start text-sm" data-testid="ltv-table">
              <caption className="sr-only">{t("growth.cohorts.ltvCaption")}</caption>
              <thead><tr>{["group", "estimate", "interval", "n", "horizon"].map((h) => <th key={h} scope="col" className="border-b bg-muted px-3 py-2.5 text-start text-xs font-semibold text-muted-foreground">{t(`growth.cohorts.ltvCol.${h}`)}</th>)}</tr></thead>
              <tbody>{d.rows.map((r) => (
                <tr key={`${r.dimension}-${r.value}`} data-testid={`ltv-row-${r.dimension}-${r.value ?? "all"}`}>
                  <th scope="row" className="border-b border-border/60 px-3 py-2.5 text-start font-medium">{r.dimension === "ALL" ? t("growth.cohorts.allPatients") : `${t(`growth.cohorts.dim.${r.dimension}`)}: ${r.value}`}</th>
                  <td className="border-b border-border/60 px-3 py-2.5 tabular-nums">{money(r.estimateMinor)} <span className="text-xs text-muted-foreground">{t("growth.cohorts.estimate")}</span></td>
                  <td className="border-b border-border/60 px-3 py-2.5 tabular-nums" data-testid="ltv-interval">{money(r.lowMinor)} - {money(r.highMinor)}</td>
                  <td className="border-b border-border/60 px-3 py-2.5 tabular-nums">{fmtN(r.n)}</td>
                  <td className="border-b border-border/60 px-3 py-2.5 tabular-nums">{t("growth.cohorts.months", { n: r.horizonMonths })}</td>
                </tr>))}</tbody>
            </table>
          </div>
        </Section>
      )}
      <Section title={t("growth.cohorts.methodTitle")} id="coh-method"><p className="text-sm">{t("growth.cohorts.method")}</p><p className="mt-2 text-xs text-muted-foreground" data-testid="ltv-policy">{t("growth.cohorts.policyLine", { source: d.policy.source, horizon: d.policy.horizonMonths, resamples: fmtN(d.policy.resamples), discount: d.policy.discountRateBp / 100 })}</p></Section>
    </div>
  );
}
