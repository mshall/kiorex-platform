import { useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useSuppressionActions, useSuppressions, type SuppressionRow } from "@/api/lifecycle";
import { useGrowthAccess } from "@/api/growth";
import { DataTable, type Column } from "@/components/DataTable";
import { CardSkeleton, EmptyState, ErrorState } from "@/components/states";
import { GrowthPage } from "@/components/growth/GrowthPage";
import { FormField, StatusChip } from "@/components/kit";
import { formatDateTime } from "@/lib/format";

const input = "h-11 w-full rounded-xl border border-input bg-card px-3 text-sm";

/** The suppression list: channel, reason, hash tail (never the address). Adding is one person; lifting needs a second person and written consent evidence. */
export default function SuppressionPage() {
  const { t, i18n } = useTranslation(); const list = useSuppressions(true); const acts = useSuppressionActions(); const access = useGrowthAccess(); const can = !!access.data?.capabilities.manage;
  const [address, setAddress] = useState(""); const [channel, setChannel] = useState("ALL"); const [note, setNote] = useState(""); const [evidence, setEvidence] = useState(""); const [lifting, setLifting] = useState<string | null>(null); const [msg, setMsg] = useState<string | null>(null);
  const cols: Column<SuppressionRow>[] = [
    { key: "channel", header: t("growth.lifecycle.colChannels"), cell: (r) => t(`growth.lifecycle.channel.${r.channel}`, { defaultValue: r.channel }) },
    { key: "reason", header: t("growth.lifecycle.colReason"), cell: (r) => <StatusChip tone={r.reason === "MANUAL" ? "warning" : "neutral"}>{r.reason}</StatusChip> },
    { key: "tail", header: t("growth.lifecycle.colHash"), cell: (r) => <span className="font-mono text-xs" dir="ltr">…{r.hashTail}</span> },
    { key: "at", header: t("growth.lifecycle.colAdded"), cell: (r) => <span className="text-xs">{formatDateTime(r.createdAt, i18n.language)}</span> },
    { key: "act", header: "", cell: (r) => can ? <button type="button" className="h-9 rounded-lg border px-3 text-xs font-semibold hover:bg-accent" onClick={() => { setLifting(r.id); setMsg(null); }} data-testid={`lift-${r.id}`}>{t("growth.lifecycle.lift")}</button> : null },
  ];
  const onAdd = (e: React.FormEvent) => { e.preventDefault(); acts.add.mutate({ address, channel, note }, { onSuccess: () => { setAddress(""); setNote(""); setMsg(t("growth.lifecycle.added")); } }); };
  return (
    <GrowthPage section="lifecycle" actions={<Link to="/growth/lifecycle" className="inline-flex h-11 items-center rounded-xl border px-4 text-sm font-semibold hover:bg-accent">{t("growth.lifecycle.back")}</Link>}>
      <p className="rounded-xl bg-info-soft p-3 text-sm text-info">{t("growth.lifecycle.suppressionHint")}</p>
      {msg ? <p role="status" className="text-sm text-success" data-testid="suppression-msg">{msg}</p> : null}
      {can ? (
        <form onSubmit={onAdd} className="grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-4" data-testid="suppression-add">
          <FormField label={t("growth.lifecycle.address")} required><input className={input} value={address} onChange={(e) => setAddress(e.target.value)} dir="ltr" autoComplete="off" /></FormField>
          <FormField label={t("growth.lifecycle.colChannels")}><select className={input} value={channel} onChange={(e) => setChannel(e.target.value)}>{["ALL", "WHATSAPP", "SMS", "EMAIL", "PUSH"].map((c) => <option key={c} value={c}>{t(`growth.lifecycle.channel.${c}`)}</option>)}</select></FormField>
          <FormField label={t("growth.lifecycle.note")} required hint={t("growth.lifecycle.noteHint")}><input className={input} value={note} onChange={(e) => setNote(e.target.value)} /></FormField>
          <div className="flex items-end"><button type="submit" disabled={address.length < 3 || note.length < 8 || acts.add.isPending} className="h-11 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50" data-testid="suppression-submit">{t("growth.lifecycle.addSuppression")}</button></div>
          {acts.add.isError ? <p role="alert" className="text-sm text-danger sm:col-span-4">{(acts.add.error as Error).message}</p> : null}
        </form>
      ) : <p className="text-xs text-muted-foreground" data-testid="suppression-readonly">{t("growth.lifecycle.readOnly")}</p>}
      {lifting && can ? (
        <div className="space-y-2 rounded-xl border bg-card p-4" data-testid="lift-panel">
          <p className="text-sm">{t("growth.lifecycle.liftHint")}</p>
          <FormField label={t("growth.lifecycle.evidence")} required><input className={input} value={evidence} onChange={(e) => setEvidence(e.target.value)} /></FormField>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={evidence.length < 8 || acts.requestLift.isPending} className="h-11 rounded-xl border px-4 text-sm font-semibold disabled:opacity-50" onClick={() => acts.requestLift.mutate({ id: lifting, evidence }, { onSuccess: () => setMsg(t("growth.lifecycle.liftRequested")) })} data-testid="lift-request">{t("growth.lifecycle.requestLift")}</button>
            <button type="button" disabled={acts.approveLift.isPending} className="h-11 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50" onClick={() => acts.approveLift.mutate(lifting, { onSuccess: () => { setMsg(t("growth.lifecycle.lifted")); setLifting(null); } })} data-testid="lift-approve">{t("growth.lifecycle.approveLift")}</button>
            <button type="button" className="h-11 rounded-xl px-4 text-sm" onClick={() => setLifting(null)}>{t("growth.lifecycle.cancel")}</button>
          </div>
          {acts.approveLift.isError ? <p role="alert" className="text-sm text-danger">{(acts.approveLift.error as Error).message}</p> : null}
        </div>
      ) : null}
      {list.isLoading ? <CardSkeleton rows={3} /> : list.isError ? <ErrorState error={list.error} onRetry={() => void list.refetch()} /> : <DataTable columns={cols} rows={list.data ?? []} rowKey={(r) => r.id} caption={t("growth.lifecycle.suppression")} empty={<EmptyState title={t("growth.lifecycle.suppressionEmpty")} />} />}
    </GrowthPage>
  );
}
