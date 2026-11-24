import { useState } from "react";
import { useTranslation } from "react-i18next";
import { fmtN } from "@/lib/growthFormat";
import { useFairness, useShadowReport, type FairnessRow } from "@/api/growthFraud";
import { StatCard, StatusChip } from "@/components/kit";
import { DataTable } from "@/components/DataTable";
import { CardSkeleton, ErrorState } from "@/components/states";
import { Section, selectCls } from "@/components/growth/GrowthPage";

/** Precision and volume by rule while rules are in shadow, and the weekly fairness check. Precision stays hidden until a rule has 20 labelled cases. */
export default function ShadowReportPage() {
  const { t } = useTranslation(); const [days, setDays] = useState(90); const q = useShadowReport(days); const fair = useFairness();
  const cell = (v: number | "<10") => (v === "<10" ? "<10" : fmtN(v));
  const fairTable = (rows: FairnessRow[], caption: string) => (
    <DataTable caption={caption} rows={rows} rowKey={(r) => r.group} empty="—" columns={[
      { key: "g", header: t("growth.fraudV2.fairness.group"), cell: (r) => r.group }, { key: "t", header: t("growth.fraudV2.fairness.total"), cell: (r) => cell(r.total) }, { key: "h", header: t("growth.fraudV2.fairness.held"), cell: (r) => cell(r.held) },
      { key: "r", header: t("growth.fraudV2.fairness.rate"), cell: (r) => (r.rate === null ? "—" : `${(r.rate * 100).toFixed(1)}%`) }, { key: "f", header: "", cell: (r) => (r.flagged ? <StatusChip tone="warning">{t("growth.fraudV2.fairness.flagged")}</StatusChip> : null) },
    ]} />
  );
  return (
    <div className="space-y-5" data-testid="fraud-shadow-tab">
      <Section title={t("growth.fraudV2.shadow.title")} id="fr-shadow" hint={t("growth.fraudV2.shadow.hint")}>
        <label className="mb-3 flex items-center gap-2 text-sm"><span className="text-muted-foreground">{t("growth.fraudV2.shadow.days")}</span><select className={selectCls} value={days} onChange={(e) => setDays(Number(e.target.value))}>{[30, 90, 180].map((d) => <option key={d} value={d}>{d}</option>)}</select></label>
        {q.isLoading ? <CardSkeleton rows={3} /> : q.error || !q.data ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : (
          <>
            <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-3"><StatCard label={t("growth.fraudV2.wouldHold")} value={fmtN(q.data.wouldHaveBeenHeld)} /></div>
            <DataTable caption={t("growth.fraudV2.shadow.caption")} rows={q.data.rules} rowKey={(r) => r.ruleId} empty="—" columns={[
              { key: "r", header: t("growth.fraudV2.rule"), cell: (r) => <code className="text-xs">{r.ruleId}</code> }, { key: "f", header: t("growth.fraudV2.shadow.flagged"), cell: (r) => <span className="kx-label-num">{fmtN(r.flagged)}</span> },
              { key: "l", header: t("growth.fraudV2.shadow.labelled"), cell: (r) => <span className="kx-label-num">{fmtN(r.labelled)}</span> }, { key: "c", header: t("growth.fraudV2.shadow.confirmed"), cell: (r) => <span className="kx-label-num">{fmtN(r.confirmed)}</span> },
              { key: "d", header: t("growth.fraudV2.shadow.dismissed"), cell: (r) => <span className="kx-label-num">{fmtN(r.dismissed)}</span> },
              { key: "p", header: t("growth.fraudV2.shadow.precision"), cell: (r) => (r.precision === null ? <span className="text-xs text-muted-foreground" data-testid={`prec-${r.ruleId}`}>{t("growth.fraudV2.shadow.notEnough")}</span> : <span className="kx-label-num" data-testid={`prec-${r.ruleId}`}>{(r.precision * 100).toFixed(1)}%</span>) },
              { key: "w", header: t("growth.fraudV2.weight"), cell: (r) => <span className="kx-label-num">{r.weight}</span> },
            ]} />
          </>
        )}
      </Section>
      <Section title={t("growth.fraudV2.fairness.title")} id="fr-fair" hint={t("growth.fraudV2.fairness.hint")}>
        {fair.isLoading ? <CardSkeleton rows={2} /> : fair.error || !fair.data ? <ErrorState error={fair.error} onRetry={() => void fair.refetch()} /> : (
          <div className="grid gap-4 lg:grid-cols-2" data-testid="fraud-fairness">{fairTable(fair.data.language, t("growth.fraudV2.fairness.language"))}{fairTable(fair.data.city, t("growth.fraudV2.fairness.city"))}</div>
        )}
      </Section>
    </div>
  );
}
