import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useCohortRetention, useCohortTable, useCohortValues, type Basis, type Dimension, type Masked } from "@/api/cohorts";
import { StatCard } from "@/components/kit";
import { CardSkeleton, ErrorState } from "@/components/states";
import { Section, selectCls } from "@/components/growth/GrowthPage";
import { fmtN } from "@/lib/growthFormat";

const money = (v: Masked) => (v === "<10" ? "<10" : fmtN(Math.round(v / 100)));
const ym = (d: string) => d.slice(0, 7);
/** A rate cell: opacity follows the rate, the figure is always printed (colour is never the only signal). */
const shade = (rate: number | "<10" | null) => (typeof rate === "number" ? { backgroundColor: `color-mix(in srgb, var(--brand-ocean, #0e7490) ${Math.max(6, Math.min(80, rate))}%, transparent)` } : undefined);

/** Cohort table and retention heatmap. Basis, dimension and value are selectable; every cell under 10 people reads "fewer than 10" and carries no money. */
export default function CohortsPage() {
  const { t } = useTranslation(); const [basis, setBasis] = useState<Basis>("FIRST_COMPLETED"); const [dimension, setDimension] = useState<Dimension>("ALL"); const [value, setValue] = useState("");
  const values = useCohortValues(dimension); const sel = { basis, dimension, value: dimension === "ALL" ? undefined : value };
  const table = useCohortTable(sel); const ret = useCohortRetention(sel);
  const small = t("growth.cohorts.fewerThan10");
  return (
    <div className="space-y-5">
      <p className="rounded-xl border bg-card p-3 text-sm" data-testid="cohort-privacy">{t("growth.cohorts.privacy")}</p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm"><span className="block text-muted-foreground">{t("growth.cohorts.basis")}</span><select className={selectCls} value={basis} onChange={(e) => setBasis(e.target.value as Basis)} data-testid="cohort-basis"><option value="FIRST_COMPLETED">{t("growth.cohorts.basisFirst")}</option><option value="REGISTRATION">{t("growth.cohorts.basisRegistration")}</option></select></label>
        <label className="text-sm"><span className="block text-muted-foreground">{t("growth.cohorts.dimension")}</span><select className={selectCls} value={dimension} onChange={(e) => { setDimension(e.target.value as Dimension); setValue(""); }} data-testid="cohort-dimension">{(["ALL", "SOURCE", "CAMPAIGN", "PLATFORM"] as const).map((d) => <option key={d} value={d}>{t(`growth.cohorts.dim.${d}`)}</option>)}</select></label>
        {dimension !== "ALL" && <label className="text-sm"><span className="block text-muted-foreground">{t("growth.cohorts.value")}</span><select className={selectCls} value={value} onChange={(e) => setValue(e.target.value)} data-testid="cohort-value"><option value="">{t("growth.cohorts.pick")}</option>{(values.data?.values ?? []).map((v) => <option key={v} value={v}>{v}</option>)}</select></label>}
      </div>
      {table.isLoading || ret.isLoading ? <CardSkeleton rows={4} /> : table.error ? <ErrorState error={table.error} onRetry={() => void table.refetch()} /> : table.data && ret.data && (
        <>
          {table.data.rows.length === 0 ? <p className="rounded-xl border bg-card p-4 text-sm" data-testid="cohort-empty">{t("growth.cohorts.empty")}</p> : (
            <>
              <section className="grid gap-3 sm:grid-cols-3" aria-label={t("growth.cohorts.summary")}>
                <StatCard label={t("growth.cohorts.cohorts")} value={<span data-testid="cohort-count">{fmtN(table.data.rows.length)}</span>} hint={t("growth.cohorts.cohortsHint")} />
                <StatCard label={t("growth.cohorts.patients")} value={<span data-testid="cohort-patients">{fmtN(table.data.rows.reduce((s, r) => s + (typeof r.patients === "number" ? r.patients : 0), 0))}</span>} hint={t("growth.cohorts.patientsHint")} />
                <StatCard label={t("growth.cohorts.visits")} value={<span data-testid="cohort-visits">{table.data.visitsPerPatientM3 === null ? small : String(table.data.visitsPerPatientM3)}</span>} hint={t("growth.cohorts.visitsHint")} />
              </section>
              <Section title={t("growth.cohorts.tableTitle")} id="coh-table" hint={t("growth.cohorts.tableHint")}>
                <div className="max-h-[60vh] overflow-auto rounded-xl border" role="region" aria-label={t("growth.cohorts.tableCaption")} tabIndex={0}>
                  <table className="w-full min-w-[640px] border-separate border-spacing-0 text-start text-sm" data-testid="cohort-table">
                    <caption className="sr-only">{t("growth.cohorts.tableCaption")}</caption>
                    <thead><tr>{["cohort", "patients", "m0", "m1", "m2", "m3"].map((h) => <th key={h} scope="col" className="sticky top-0 border-b bg-muted px-3 py-2.5 text-start text-xs font-semibold text-muted-foreground">{t(`growth.cohorts.col.${h}`)}</th>)}</tr></thead>
                    <tbody>{table.data.rows.map((r) => (
                      <tr key={r.cohortMonth} data-testid={`cohort-row-${ym(r.cohortMonth)}`}>
                        <th scope="row" className="border-b border-border/60 px-3 py-2.5 text-start font-medium" dir="ltr">{ym(r.cohortMonth)}</th>
                        <td className="border-b border-border/60 px-3 py-2.5 tabular-nums" data-testid={`cohort-n-${ym(r.cohortMonth)}`}>{r.suppressed ? small : fmtN(r.patients)}</td>
                        {[0, 1, 2, 3].map((i) => { const c = r.suppressed ? undefined : r.months.find((m) => m.monthIndex === i); return <td key={i} className="border-b border-border/60 px-3 py-2.5 tabular-nums" data-testid={`cohort-cell-${ym(r.cohortMonth)}-${i}`}>{r.suppressed ? small : c ? <>{c.retained === "<10" ? small : fmtN(c.retained)}<span className="block text-xs text-muted-foreground">{c.revenueMinor === "<10" ? "" : money(c.revenueMinor)}</span></> : <span aria-label={t("growth.cohorts.notObserved")}>-</span>}</td>; })}
                      </tr>))}</tbody>
                  </table>
                </div>
              </Section>
              <Section title={t("growth.cohorts.heatTitle")} id="coh-heat" hint={t("growth.cohorts.heatHint")}>
                <div className="overflow-auto rounded-xl border" role="region" aria-label={t("growth.cohorts.heatCaption")} tabIndex={0}>
                  <table className="w-full min-w-[520px] border-separate border-spacing-0 text-start text-sm" data-testid="cohort-heatmap">
                    <caption className="sr-only">{t("growth.cohorts.heatCaption")}</caption>
                    <thead><tr><th scope="col" className="border-b bg-muted px-3 py-2.5 text-start text-xs font-semibold text-muted-foreground">{t("growth.cohorts.col.cohort")}</th>{Array.from({ length: Math.max(1, ...ret.data.rows.map((r) => r.cells.length)) }, (_, i) => <th key={i} scope="col" className="border-b bg-muted px-3 py-2.5 text-start text-xs font-semibold text-muted-foreground">{t("growth.cohorts.month", { n: i })}</th>)}</tr></thead>
                    <tbody>{ret.data.rows.map((r) => <tr key={r.cohortMonth}><th scope="row" className="border-b border-border/60 px-3 py-2.5 text-start font-medium" dir="ltr">{ym(r.cohortMonth)}</th>{r.suppressed ? <td className="border-b border-border/60 px-3 py-2.5 text-muted-foreground" colSpan={4}>{small}</td> : r.cells.map((c) => <td key={c.monthIndex} className="border-b border-border/60 px-3 py-2.5 tabular-nums" style={shade(c.rate)} data-testid={`heat-${ym(r.cohortMonth)}-${c.monthIndex}`}>{c.rate === "<10" ? small : c.rate === null ? "-" : `${fmtN(c.rate)}%`}</td>)}</tr>)}</tbody>
                  </table>
                </div>
              </Section>
            </>
          )}
        </>
      )}
    </div>
  );
}
