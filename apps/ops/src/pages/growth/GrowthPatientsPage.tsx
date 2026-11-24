import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/api/errors";
import { useEvidence, useOverview } from "@/api/growth";
import { StatusChip } from "@/components/kit";
import { CardSkeleton } from "@/components/states";
import { BarList } from "@/components/growth/BarList";
import { DaysSelect, GrowthPage, MarketSelect, Section, useGrowthMarket } from "@/components/growth/GrowthPage";
import { DataTable } from "@/components/DataTable";
import { formatDateTime } from "@/lib/format";

/** Patient acquisition: who brought the bookings (origin, source, reason) and a read-only evidence viewer for one booking. */
export function EvidenceViewer({ initial = "" }: { initial?: string }) {
  const { t, i18n } = useTranslation();
  const [draft, setDraft] = useState(initial); const [id, setId] = useState(initial);
  const q = useEvidence(id);
  const go = (e: FormEvent) => { e.preventDefault(); setId(draft.trim()); };
  const notFound = q.error instanceof ApiError && q.error.status === 404;
  return (
    <div className="space-y-3" data-testid="evidence-viewer">
      <form onSubmit={go} className="flex flex-wrap items-end gap-2">
        <div className="space-y-1"><label htmlFor="ev-id" className="block text-sm font-medium">{t("growth.evidence.bookingId")}</label><Input id="ev-id" dir="ltr" className="w-72" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="kx_bk_…" data-testid="evidence-input" /></div>
        <Button type="submit" variant="outline" disabled={draft.trim().length < 4} data-testid="evidence-go"><Search aria-hidden="true" />{t("growth.evidence.lookup")}</Button>
      </form>
      {q.isFetching && <CardSkeleton rows={1} />}
      {notFound && <p role="status" className="text-sm text-muted-foreground" data-testid="evidence-none">{t("growth.evidence.none")}</p>}
      {q.error && !notFound && <p role="alert" className="text-sm text-destructive">{(q.error as Error).message}</p>}
      {q.data && (
        <div className="space-y-2 text-sm" data-testid="evidence-result">
          <p className="flex flex-wrap items-center gap-2"><StatusChip tone={q.data.decision.origin === "PROVIDER_LED" ? "success" : q.data.decision.origin === "MARKETPLACE" ? "info" : "neutral"}>{t(`growth.origin.${q.data.decision.origin}`, q.data.decision.origin)}</StatusChip><code>{q.data.decision.reason}</code><span className="text-muted-foreground">{formatDateTime(q.data.decision.createdAt, i18n.language)}</span></p>
          <p className="text-xs text-muted-foreground">{t("growth.evidence.policy")} <code>{q.data.decision.policyVersion}</code></p>
          <DataTable caption={t("growth.evidence.touches")} rows={q.data.touches} rowKey={(r) => r.id} empty={t("growth.evidence.noTouches")} columns={[
            { key: "k", header: t("growth.channels.colKind"), cell: (r) => t(`growth.sourceKind.${r.kind}`, r.kind) }, { key: "r", header: t("growth.channels.colRef"), cell: (r) => <code className="text-xs">{r.ref ?? "—"}</code> },
            { key: "at", header: t("growth.evidence.at"), cell: (r) => <span className="text-xs">{formatDateTime(r.occurredAt, i18n.language)}</span> }, { key: "d", header: t("growth.evidence.dwell"), cell: (r) => <span className="kx-label-num">{r.dwellMs ?? "—"}</span> },
            { key: "w", header: t("growth.evidence.winning"), cell: (r) => r.winning ? <StatusChip tone="success">{t("growth.common.yes")}</StatusChip> : "" },
          ]} />
        </div>)}
    </div>
  );
}

export default function GrowthPatientsPage() {
  const { t } = useTranslation(); const g = useGrowthMarket(); const [days, setDays] = useState(30);
  const q = useOverview(g.market, days);
  return (
    <GrowthPage section="patients" toolbar={<><MarketSelect g={g} /><DaysSelect value={days} onChange={setDays} /></>}>
      {q.isLoading ? <CardSkeleton rows={2} /> : q.data && (
        <div className="grid gap-4 xl:grid-cols-2">
          <Section title={t("growth.overview.origins")} id="pt-origins" hint={t("growth.overview.originsHint")}>{q.data.origins.length === 0 ? <p className="text-sm text-muted-foreground">{t("growth.common.noData")}</p> : <BarList testid="pt-origins-list" tone="ocean" rows={q.data.origins.map((x) => ({ label: t(`growth.origin.${x.origin}`, x.origin), value: x.count }))} />}</Section>
          <Section title={t("growth.overview.sources")} id="pt-sources">{q.data.touchesBySource.length === 0 ? <p className="text-sm text-muted-foreground">{t("growth.common.noData")}</p> : <BarList testid="pt-sources-list" tone="pulse" rows={q.data.touchesBySource.map((x) => ({ label: t(`growth.sourceKind.${x.sourceKind}`, x.sourceKind), value: x.count }))} />}</Section>
        </div>)}
      <Section title={t("growth.evidence.title")} id="pt-evidence" hint={t("growth.evidence.hint")}><EvidenceViewer /></Section>
    </GrowthPage>
  );
}
