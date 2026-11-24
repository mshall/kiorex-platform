import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useConversation, useConversations, type ConversationRow } from "@/api/assistant";
import { useGrowthAccess } from "@/api/growth";
import { DataTable, type Column } from "@/components/DataTable";
import { StatusChip } from "@/components/kit";
import { CardSkeleton, EmptyState, ErrorState } from "@/components/states";
import { selectCls } from "@/components/growth/GrowthPage";
import { formatDateTime } from "@/lib/format";

/** GRW-P2-D conversation review. The list never shows a phone number or a subject. The transcript is REDACTED text (PHI patterns replaced, symptom messages shown as a marker, the assistant's answers as template names only) and opening it is audited. */
export default function ConversationsPage() {
  const { t, i18n } = useTranslation(); const [state, setState] = useState(""); const [open, setOpen] = useState<string | null>(null);
  const list = useConversations(state || undefined); const access = useGrowthAccess(); const canRead = !!access.data?.roles.some((r) => r === "support" || r === "super_admin");
  const cols: Column<ConversationRow>[] = [
    { key: "at", header: t("growth.whatsapp.conv.colStarted"), cell: (c) => formatDateTime(c.createdAt, i18n.language) },
    { key: "state", header: t("growth.whatsapp.conv.colState"), cell: (c) => <StatusChip tone={c.state === "HANDOFF" ? "warning" : c.state === "DONE" ? "success" : "neutral"}>{c.state}</StatusChip> },
    { key: "lang", header: t("growth.whatsapp.conv.colLang"), cell: (c) => c.language.toUpperCase() },
    { key: "turns", header: t("growth.whatsapp.conv.colTurns"), cell: (c) => <span className="tabular-nums">{c.turns}</span> },
    { key: "tokens", header: t("growth.whatsapp.conv.colTokens"), cell: (c) => <span className="tabular-nums">{c.tokens}</span> },
    { key: "who", header: t("growth.whatsapp.conv.colWho"), cell: (c) => (c.verified ? t("growth.whatsapp.conv.verified") : t("growth.whatsapp.conv.unverified")) },
    { key: "esc", header: t("growth.whatsapp.conv.colEscalation"), cell: (c) => (c.escalated ? <StatusChip tone="warning">{c.escalationStatus}</StatusChip> : "-") },
  ];
  return (
    <div className="space-y-4" data-testid="assistant-conversations">
      <label className="flex items-center gap-2 text-sm"><span className="text-muted-foreground">{t("growth.whatsapp.conv.colState")}</span>
        <select className={selectCls} value={state} onChange={(e) => setState(e.target.value)} data-testid="conv-state-filter"><option value="">{t("growth.whatsapp.conv.all")}</option>{["GREETING", "UNDERSTAND", "PICKING", "HOLDING", "CONFIRMING", "DONE", "HANDOFF", "CLOSED"].map((x) => <option key={x} value={x}>{x}</option>)}</select></label>
      {list.isLoading ? <CardSkeleton rows={3} /> : list.isError ? <ErrorState error={list.error} onRetry={() => void list.refetch()} /> : (
        <DataTable columns={cols} rows={list.data ?? []} rowKey={(c) => c.id} caption={t("growth.whatsapp.conv.caption")} onRowClick={canRead ? (c) => setOpen(c.id) : undefined} empty={<EmptyState title={t("growth.whatsapp.conv.empty")} hint={t("growth.whatsapp.conv.emptyHint")} />} />)}
      {!canRead && !access.isLoading && <p className="text-xs text-muted-foreground" data-testid="conv-readonly">{t("growth.whatsapp.conv.noTranscript")}</p>}
      {open && <Transcript id={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function Transcript({ id, onClose }: { id: string; onClose: () => void }) {
  const { t, i18n } = useTranslation(); const q = useConversation(id);
  return (
    <section className="kx-card space-y-3 p-5" aria-label={t("growth.whatsapp.conv.transcript")} data-testid="conv-transcript">
      <div className="flex items-center justify-between gap-2"><h2 className="text-lg font-semibold">{t("growth.whatsapp.conv.transcript")}</h2><button type="button" className="h-11 rounded-xl border border-input px-4 text-sm" onClick={onClose}>{t("growth.whatsapp.close")}</button></div>
      <p className="rounded-xl bg-info-soft p-3 text-sm text-info">{t("growth.whatsapp.conv.redactedNote")}</p>
      {q.isLoading ? <CardSkeleton rows={3} /> : q.isError || !q.data ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : (
        <ol className="space-y-2 text-sm">{q.data.turns.map((x) => (
          <li key={`${x.seq}-${x.direction}`} className={`rounded-xl p-3 ${x.direction === "IN" ? "bg-card" : "bg-accent/40"}`} dir="auto"><span className="me-2 text-xs text-muted-foreground">{formatDateTime(x.at, i18n.language)} · {x.direction === "IN" ? t("growth.whatsapp.conv.patient") : t("growth.whatsapp.conv.assistant")}</span>{x.direction === "IN" ? x.text : <code>{x.template}</code>}</li>))}</ol>)}
    </section>
  );
}
