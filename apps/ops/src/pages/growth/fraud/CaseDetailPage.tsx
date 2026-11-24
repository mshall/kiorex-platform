import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCaseAction, useCaseEvidence } from "@/api/growthFraud";
import { useGrowthAccess } from "@/api/growth";
import { StatusChip } from "@/components/kit";
import { DataTable } from "@/components/DataTable";
import { CardSkeleton, ErrorState } from "@/components/states";
import { Section } from "@/components/growth/GrowthPage";
import { formatDateTime } from "@/lib/format";
import { bandTone } from "./CasesTab";

/** One case: hashed evidence and check rows, the append-only decision log, and the reviewer actions. Reversing reward value is a two-person decision (the second reviewer confirms the same case). */
export default function CaseDetailPage({ id, onBack }: { id: string; onBack: () => void }) {
  const { t, i18n } = useTranslation(); const q = useCaseEvidence(id); const act = useCaseAction(); const can = useGrowthAccess().data?.capabilities.reviewFraud;
  const [assignTo, setAssignTo] = useState(""); const [note, setNote] = useState(""); const [reverse, setReverse] = useState(false); const [suspend, setSuspend] = useState(""); const [appeal, setAppeal] = useState("");
  const done = (r: Record<string, unknown>) => toast.success(r.status === "CONFIRM_REQUESTED" ? t("growth.fraudV2.requested") : t("growth.fraudV2.decided"));
  const fail = (e: unknown) => toast.error((e as Error).message);
  if (q.isLoading) return <CardSkeleton rows={4} />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const c = q.data.case; const open = c.status === "OPEN" || c.status === "IN_REVIEW";
  const decide = (decision: "CONFIRM" | "DISMISS") => act.mutate({ op: "decide", id, decision, note: note.trim() || undefined, ...(decision === "CONFIRM" ? { reverseRewards: reverse, ...(suspend ? { suspendDays: Number(suspend) } : {}) } : {}) }, { onSuccess: done, onError: fail });
  return (
    <div className="space-y-5" data-testid="fraud-case-detail">
      <Button variant="outline" onClick={onBack} data-testid="fraud-case-back">{t("growth.fraudV2.back")}</Button>
      <div className="flex flex-wrap items-center gap-2">
        <code className="text-sm" dir="ltr">{c.id}</code>
        <StatusChip tone={bandTone(c.band)}>{t(`growth.fraudV2.band_${c.band}`)} · {c.score}</StatusChip>
        <StatusChip tone={c.mode === "ENFORCE" ? "info" : "neutral"}>{t(`growth.fraudV2.mode_${c.mode}`)}</StatusChip>
        <StatusChip tone="neutral">{t(`growth.fraudV2.status_${c.status}`)}</StatusChip>
        <span className="text-sm text-muted-foreground">{t(`growth.fraudV2.kind_${c.kind}`)} · {t("growth.fraudV2.subject")}: <code dir="ltr">{c.subjectRef}</code></span>
      </div>
      {c.kind === "PROVIDER" && <p className="rounded-xl bg-muted/50 p-3 text-sm" data-testid="fraud-provider-note">{t("growth.fraudV2.providerNote")}</p>}
      <Section title={t("growth.fraudV2.evidence")} id="fr-evidence" hint={t("growth.fraudV2.evidenceHint")}>
        <DataTable caption={t("growth.fraudV2.signals")} rows={q.data.signals} rowKey={(r) => `${r.ruleId}|${r.evidenceRef}|${r.at}`} empty="—" columns={[
          { key: "r", header: t("growth.fraudV2.rule"), cell: (r) => <code className="text-xs">{r.ruleId}</code> }, { key: "w", header: t("growth.fraudV2.weight"), cell: (r) => <span className="kx-label-num">{r.weight}</span> },
          { key: "e", header: t("growth.fraudV2.evidenceRef"), cell: (r) => <code className="text-xs" dir="ltr">{r.evidenceRef ?? "—"}</code> }, { key: "at", header: t("growth.fraudV2.when"), cell: (r) => <span className="text-xs">{formatDateTime(r.at, i18n.language)}</span> },
        ]} />
        {q.data.checks.length > 0 && (
          <div className="mt-4"><DataTable caption={t("growth.fraudV2.checks")} rows={q.data.checks} rowKey={(r) => `${r.relationshipRef}|${r.key}|${r.at}`} empty="—" columns={[
            { key: "k", header: t("growth.fraudV2.rule"), cell: (r) => <code className="text-xs">{r.key}</code> }, { key: "p", header: "✓", cell: (r) => (r.passed ? "✓" : "✗") },
            { key: "at", header: t("growth.fraudV2.when"), cell: (r) => <span className="text-xs">{formatDateTime(r.at, i18n.language)}</span> },
          ]} /></div>
        )}
      </Section>
      <Section title={t("growth.fraudV2.log")} id="fr-log">
        <DataTable caption={t("growth.fraudV2.log")} rows={q.data.log} rowKey={(r) => `${r.action}|${r.at}`} empty="—" columns={[
          { key: "at", header: t("growth.fraudV2.when"), cell: (r) => <span className="text-xs">{formatDateTime(r.at, i18n.language)}</span> }, { key: "a", header: t("growth.fraudV2.action"), cell: (r) => <code className="text-xs">{r.action}</code> },
          { key: "s", header: t("growth.fraudV2.status"), cell: (r) => <span className="text-xs">{r.from ? `${r.from} → ` : ""}{r.to}</span> }, { key: "by", header: t("growth.fraudV2.actor"), cell: (r) => <span className="text-xs">{r.actor}</span> }, { key: "n", header: t("growth.fraudV2.note"), cell: (r) => <span className="text-xs">{r.note ?? "—"}</span> },
        ]} />
      </Section>
      {!can ? <p className="text-sm text-muted-foreground" data-testid="fraud-readonly">{t("growth.fraudV2.readOnly")}</p> : (
        <>
          {open && (
            <Section title={t("growth.fraudV2.decision")} id="fr-decide">
              <div className="grid gap-3 md:grid-cols-2">
                <div className="flex items-end gap-2"><label className="flex-1 text-sm"><span className="mb-1 block text-muted-foreground">{t("growth.fraudV2.assign")}</span><Input value={assignTo} maxLength={80} onChange={(e) => setAssignTo(e.target.value)} dir="ltr" data-testid="fraud-assign-to" /></label>
                  <Button variant="outline" disabled={!assignTo.trim() || act.isPending} onClick={() => act.mutate({ op: "assign", id, assignTo: assignTo.trim() }, { onSuccess: done, onError: fail })} data-testid="fraud-assign-go">{t("growth.fraudV2.assignGo")}</Button></div>
                <label className="text-sm"><span className="mb-1 block text-muted-foreground">{t("growth.fraudV2.reasonLabel")}</span><Input value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} data-testid="fraud-note" /></label>
              </div>
              <div className="mt-3 space-y-2">
                <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className="h-5 w-5" checked={reverse} onChange={(e) => setReverse(e.target.checked)} data-testid="fraud-reverse" />{t("growth.fraudV2.reverse")}</label>
                {reverse && <p className="text-xs text-muted-foreground" data-testid="fraud-two-person">{t("growth.fraudV2.reverseHint")}</p>}
                <label className="flex items-center gap-2 text-sm"><span className="text-muted-foreground">{t("growth.fraudV2.suspendDays")}</span><Input className="w-24" inputMode="numeric" value={suspend} onChange={(e) => setSuspend(e.target.value.replace(/\D/g, "").slice(0, 3))} dir="ltr" data-testid="fraud-suspend" /></label>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="outline" disabled={note.trim().length < 10 || act.isPending} onClick={() => decide("DISMISS")} data-testid="fraud-dismiss">{t("growth.fraudV2.decide.dismiss")}</Button>
                <Button variant="destructive" disabled={act.isPending} onClick={() => decide("CONFIRM")} data-testid="fraud-confirm">{t("growth.fraudV2.decide.confirm")}</Button>
              </div>
            </Section>
          )}
          {(c.status === "CONFIRMED" || c.status === "APPEALED") && (
            <Section title={t("growth.fraudV2.appealTitle")} id="fr-appeal" hint={t("growth.fraudV2.appealHint")}>
              <label className="block text-sm"><span className="mb-1 block text-muted-foreground">{t("growth.fraudV2.appealNote")}</span><Input value={appeal} maxLength={300} onChange={(e) => setAppeal(e.target.value)} data-testid="fraud-appeal-note" /></label>
              <div className="mt-3 flex flex-wrap gap-2">
                {c.status === "CONFIRMED" && <Button disabled={appeal.trim().length < 10 || act.isPending} onClick={() => act.mutate({ op: "appeal", id, note: appeal.trim() }, { onSuccess: done, onError: fail })} data-testid="fraud-appeal-file">{t("growth.fraudV2.appealFile")}</Button>}
                {c.status === "APPEALED" && (<><Button disabled={appeal.trim().length < 10 || act.isPending} onClick={() => act.mutate({ op: "appeal-decision", id, decision: "DISMISS", note: appeal.trim() }, { onSuccess: done, onError: fail })} data-testid="fraud-appeal-uphold">{t("growth.fraudV2.appealUphold")}</Button>
                  <Button variant="outline" disabled={appeal.trim().length < 10 || act.isPending} onClick={() => act.mutate({ op: "appeal-decision", id, decision: "CONFIRM", note: appeal.trim() }, { onSuccess: done, onError: fail })} data-testid="fraud-appeal-reject">{t("growth.fraudV2.appealReject")}</Button></>)}
              </div>
            </Section>
          )}
        </>
      )}
    </div>
  );
}
