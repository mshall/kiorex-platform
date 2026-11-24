import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/api/errors";
import { useFraudReview, useFraudSignals, useFraudThresholds, useGrowthAccess, type FraudSignal } from "@/api/growth";
import { StatCard, StatusChip } from "@/components/kit";
import { DataTable } from "@/components/DataTable";
import { CardSkeleton, ErrorState } from "@/components/states";
import { GrowthPage, MarketSelect, Section, selectCls, useGrowthMarket } from "@/components/growth/GrowthPage";
import { formatDateTime } from "@/lib/format";

/** Fraud management: signals are evidence for review (never a verdict on a booking). Thresholds are shown read-only with where each one comes from. */
export default function GrowthFraudPage() {
  const { t, i18n } = useTranslation(); const g = useGrowthMarket(); const [status, setStatus] = useState("OPEN"); const [notes, setNotes] = useState<Record<string, string>>({});
  const q = useFraudSignals(g.market, status); const th = useFraudThresholds(g.market); const review = useFraudReview(); const can = useGrowthAccess().data?.capabilities.reviewFraud;
  const decide = (s: FraudSignal, st: "CONFIRMED" | "DISMISSED") => review.mutate({ id: s.id, status: st, note: notes[s.id]?.trim() || undefined }, { onSuccess: () => toast.success(t("growth.fraud.reviewed")), onError: (e) => toast.error(e instanceof ApiError ? `${e.code}: ${e.message}` : t("states.errorTitle")) });
  return (
    <GrowthPage section="fraud" toolbar={<><MarketSelect g={g} /><label className="flex items-center gap-2 text-sm"><span className="text-muted-foreground">{t("growth.fraud.queue")}</span><select className={selectCls} value={status} onChange={(e) => setStatus(e.target.value)} data-testid="fraud-filter">{["OPEN", "CONFIRMED", "DISMISSED", ""].map((s) => <option key={s} value={s}>{s ? t(`growth.fraud.status.${s}`) : t("growth.common.all")}</option>)}</select></label></>}>
      {q.isLoading ? <CardSkeleton rows={2} /> : q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : q.data && (
        <>
          <div className="grid grid-cols-3 gap-3" data-testid="fraud-counts">{(["OPEN", "CONFIRMED", "DISMISSED"] as const).map((s) => <StatCard key={s} label={t(`growth.fraud.status.${s}`)} value={q.data!.counts[s] ?? 0} tone={s === "OPEN" && (q.data!.counts.OPEN ?? 0) > 0 ? "warn" : undefined} />)}</div>
          <Section title={t("growth.fraud.signals")} id="fr-signals" hint={can ? t("growth.fraud.reviewHint") : t("growth.fraud.readOnlyHint")}>
            <DataTable caption={t("growth.fraud.signals")} rows={q.data.items} rowKey={(r) => r.id} empty={t("growth.fraud.empty")} columns={[
              { key: "r", header: t("growth.fraud.rule"), cell: (r) => <code className="text-xs">{r.ruleId}</code> }, { key: "sc", header: t("growth.fraud.score"), cell: (r) => <span className="kx-label-num">{r.score}</span> },
              { key: "su", header: t("growth.fraud.subject"), cell: (r) => <code className="text-xs">{r.subject}…</code> }, { key: "at", header: t("growth.audit.when"), cell: (r) => <span className="text-xs">{formatDateTime(r.createdAt, i18n.language)}</span> },
              { key: "st", header: t("growth.fraud.state"), cell: (r) => <StatusChip tone={r.reviewStatus === "OPEN" ? "warning" : r.reviewStatus === "CONFIRMED" ? "danger" : "neutral"}>{t(`growth.fraud.status.${r.reviewStatus}`)}</StatusChip> },
              { key: "a", header: t("growth.common.actions"), cell: (r) => r.reviewStatus !== "OPEN" ? <span className="text-xs text-muted-foreground">{r.reviewedBy} · {formatDateTime(r.reviewedAt, i18n.language)}{r.reviewNote ? ` · ${r.reviewNote}` : ""}</span> : can ? (
                <div className="flex flex-wrap items-center gap-1.5"><Input aria-label={t("growth.fraud.note")} placeholder={t("growth.fraud.note")} className="h-9 w-40" value={notes[r.id] ?? ""} maxLength={300} onChange={(e) => setNotes((n) => ({ ...n, [r.id]: e.target.value }))} />
                  <Button size="sm" variant="destructive" disabled={review.isPending} onClick={() => decide(r, "CONFIRMED")} data-testid={`fraud-confirm-${r.id}`}>{t("growth.fraud.confirm")}</Button><Button size="sm" variant="outline" disabled={review.isPending} onClick={() => decide(r, "DISMISSED")} data-testid={`fraud-dismiss-${r.id}`}>{t("growth.fraud.dismiss")}</Button></div>) : null },
            ]} />
          </Section>
        </>)}
      <Section title={t("growth.fraud.thresholds")} id="fr-thresholds" hint={th.data?.note}>
        {th.data && (<><DataTable caption={t("growth.fraud.thresholds")} rows={th.data.rules} rowKey={(r) => r.ruleId} columns={[
          { key: "r", header: t("growth.fraud.rule"), cell: (r) => <code className="text-xs">{r.ruleId}</code> }, { key: "s", header: t("growth.fraud.score"), cell: (r) => <span className="kx-label-num">{r.score}</span> },
          { key: "t", header: t("growth.fraud.threshold"), cell: (r) => <span className="text-xs">{r.threshold}</span> }, { key: "so", header: t("growth.fraud.source"), cell: (r) => <span className="text-xs">{r.source}</span> },
        ]} /><p className="mt-2 text-xs text-muted-foreground">{th.data.rule}</p></>)}
      </Section>
    </GrowthPage>
  );
}
