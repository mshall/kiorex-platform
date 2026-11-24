import { useTranslation } from "react-i18next";
import { usePayback } from "@/api/cohorts";
import { StatCard, StatusChip } from "@/components/kit";
import { CardSkeleton, ErrorState } from "@/components/states";
import { Section } from "@/components/growth/GrowthPage";
import { fmtN } from "@/lib/growthFormat";

const money = (minor: number) => fmtN(Math.round(minor / 100));
/** Payback of the blended CAC and LTV:CAC with the LTV interval. Without approved spend the page says so instead of inventing a CAC. */
export default function PaybackPage() {
  const { t } = useTranslation(); const q = usePayback();
  if (q.isLoading) return <CardSkeleton rows={3} />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const d = q.data!; const r = d.ltvToCac;
  return (
    <div className="space-y-5">
      <p className="rounded-xl border bg-card p-3 text-sm" data-testid="payback-note">{d.note}</p>
      <section className="grid gap-3 sm:grid-cols-2" aria-label={t("growth.cohorts.paybackSummary")}>
        <StatCard label={t("growth.cohorts.blendedCac")} value={<span data-testid="blended-cac">{d.blendedCacMinor === null ? t("growth.cohorts.notAvailable") : money(d.blendedCacMinor)}</span>} hint={t("growth.cohorts.blendedCacHint")} />
        <StatCard label={t("growth.cohorts.ltvCac")} value={<span data-testid="ltv-cac">{r ? `${r.estimate} (${r.low} - ${r.high})` : t("growth.cohorts.notAvailable")}</span>} hint={r ? t("growth.cohorts.ltvCacHint", { n: fmtN(r.n) }) : t("growth.cohorts.ltvCacNone")} />
      </section>
      {d.rows.length > 0 && (
        <Section title={t("growth.cohorts.paybackTitle")} id="coh-payback" hint={t("growth.cohorts.paybackHint")}>
          <div className="overflow-auto rounded-xl border" role="region" aria-label={t("growth.cohorts.paybackCaption")} tabIndex={0}>
            <table className="w-full min-w-[560px] border-separate border-spacing-0 text-start text-sm" data-testid="payback-table">
              <caption className="sr-only">{t("growth.cohorts.paybackCaption")}</caption>
              <thead><tr>{["cohort", "patients", "cac", "payback"].map((h) => <th key={h} scope="col" className="border-b bg-muted px-3 py-2.5 text-start text-xs font-semibold text-muted-foreground">{t(`growth.cohorts.pbCol.${h}`)}</th>)}</tr></thead>
              <tbody>{d.rows.map((r2) => r2.suppressed
                ? <tr key={r2.cohortMonth}><th scope="row" className="border-b border-border/60 px-3 py-2.5 text-start" dir="ltr">{r2.cohortMonth.slice(0, 7)}</th><td colSpan={3} className="border-b border-border/60 px-3 py-2.5 text-muted-foreground">{t("growth.cohorts.fewerThan10")}</td></tr>
                : <tr key={r2.cohortMonth} data-testid={`pb-${r2.cohortMonth.slice(0, 7)}`}>
                    <th scope="row" className="border-b border-border/60 px-3 py-2.5 text-start font-medium" dir="ltr">{r2.cohortMonth.slice(0, 7)}</th>
                    <td className="border-b border-border/60 px-3 py-2.5 tabular-nums">{fmtN(r2.patients)}</td>
                    <td className="border-b border-border/60 px-3 py-2.5 tabular-nums">{r2.cacMinor === null ? t("growth.cohorts.notAvailable") : money(r2.cacMinor)}</td>
                    <td className="border-b border-border/60 px-3 py-2.5">{r2.cacMinor === null ? "-" : r2.paybackMonth === null ? <StatusChip tone="warning" dot={false}>{t("growth.cohorts.notYet")}</StatusChip> : t("growth.cohorts.paybackMonth", { n: r2.paybackMonth })}</td>
                  </tr>)}</tbody>
            </table>
          </div>
        </Section>
      )}
    </div>
  );
}
