import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAckEscalation, useCloseEscalation, useEscalation, useEscalations, type EscalationRow } from "@/api/assistant";
import { useGrowthAccess } from "@/api/growth";
import { DataTable, type Column } from "@/components/DataTable";
import { StatusChip } from "@/components/kit";
import { CardSkeleton, EmptyState, ErrorState } from "@/components/states";
import { formatDateTime } from "@/lib/format";

/** GRW-P2-D escalation queue with SLA timers. Acknowledge and close are never behind a flag: a patient is waiting for a person (closing hands the chat back to the assistant). */
export default function EscalationsPage() {
  const { t, i18n } = useTranslation(); const list = useEscalations(); const ack = useAckEscalation(); const close = useCloseEscalation(); const access = useGrowthAccess(); const [open, setOpen] = useState<string | null>(null);
  const can = !!access.data?.roles.some((r) => r === "support" || r === "super_admin");
  const cols: Column<EscalationRow>[] = [
    { key: "created", header: t("growth.whatsapp.esc.colCreated"), cell: (e) => formatDateTime(e.createdAt, i18n.language) },
    { key: "reason", header: t("growth.whatsapp.esc.colReason"), cell: (e) => t(`growth.whatsapp.esc.reason.${e.reason}`, { defaultValue: e.reason }) },
    { key: "status", header: t("growth.whatsapp.esc.colStatus"), cell: (e) => <StatusChip tone={e.status === "CLOSED" ? "success" : e.overdue ? "danger" : "warning"}>{t(`growth.whatsapp.esc.status.${e.status}`)}</StatusChip> },
    { key: "sla", header: t("growth.whatsapp.esc.colSla"), cell: (e) => (e.status === "CLOSED" ? "-" : <span data-testid="esc-sla" className={`tabular-nums ${e.overdue ? "font-semibold text-danger" : ""}`}>{e.overdue ? t("growth.whatsapp.esc.overdue", { n: Math.abs(e.minutesLeft) }) : t("growth.whatsapp.esc.left", { n: e.minutesLeft })}</span>) },
    { key: "act", header: "", cell: (e) => (can && e.status !== "CLOSED" ? <span className="flex gap-2">
      <button type="button" className="h-11 rounded-xl border border-input px-3 text-sm" onClick={(ev) => { ev.stopPropagation(); setOpen(e.id); }} data-testid="esc-view">{t("growth.whatsapp.esc.view")}</button>
      {e.status === "OPEN" && <button type="button" className="h-11 rounded-xl border border-input px-3 text-sm" disabled={ack.isPending} onClick={(ev) => { ev.stopPropagation(); ack.mutate(e.id); }} data-testid="esc-ack">{t("growth.whatsapp.esc.ack")}</button>}
      <button type="button" className="h-11 rounded-xl bg-primary px-3 text-sm font-semibold text-primary-foreground" disabled={close.isPending} onClick={(ev) => { ev.stopPropagation(); close.mutate(e.id); }} data-testid="esc-close">{t("growth.whatsapp.esc.close")}</button></span> : null) },
  ];
  return (
    <div className="space-y-4" data-testid="assistant-escalations">
      <p className="rounded-xl bg-info-soft p-3 text-sm text-info">{t("growth.whatsapp.esc.note")}</p>
      {list.isLoading ? <CardSkeleton rows={3} /> : list.isError ? <ErrorState error={list.error} onRetry={() => void list.refetch()} /> : (
        <DataTable columns={cols} rows={list.data ?? []} rowKey={(e) => e.id} caption={t("growth.whatsapp.esc.caption")} empty={<EmptyState title={t("growth.whatsapp.esc.empty")} hint={t("growth.whatsapp.esc.emptyHint")} />} />)}
      {!can && !access.isLoading && <p className="text-xs text-muted-foreground">{t("growth.whatsapp.esc.readOnly")}</p>}
      {open && <Detail id={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
function Detail({ id, onClose }: { id: string; onClose: () => void }) {
  const { t } = useTranslation(); const q = useEscalation(id);
  return (
    <section className="kx-card space-y-3 p-5" data-testid="esc-detail" aria-label={t("growth.whatsapp.conv.transcript")}>
      <div className="flex items-center justify-between"><h2 className="text-lg font-semibold">{t("growth.whatsapp.conv.transcript")}</h2><button type="button" className="h-11 rounded-xl border border-input px-4 text-sm" onClick={onClose}>{t("growth.whatsapp.close")}</button></div>
      <p className="rounded-xl bg-info-soft p-3 text-sm text-info">{t("growth.whatsapp.conv.redactedNote")}</p>
      {q.isLoading ? <CardSkeleton rows={2} /> : q.isError || !q.data ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : (
        <ol className="space-y-2 text-sm">{q.data.transcript.map((x) => <li key={`${x.seq}-${x.direction}`} className="rounded-xl bg-card p-3" dir="auto"><span className="me-2 text-xs text-muted-foreground">{x.direction === "IN" ? t("growth.whatsapp.conv.patient") : t("growth.whatsapp.conv.assistant")}</span>{x.direction === "IN" ? x.text : <code>{x.template}</code>}</li>)}</ol>)}
    </section>
  );
}
