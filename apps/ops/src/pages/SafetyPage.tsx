import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { BellRing, CheckCheck, Siren, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAlertAction, useSafetyAlerts, useSafetySummary, useSafetySweep, type AlertAction, type SafetyAlert } from "@/api/home";
import { ApiError } from "@/api/errors";
import { CardSkeleton, ErrorState } from "@/components/states";
import { DataTable } from "@/components/DataTable";
import { PageHeader, StatTile } from "@/components/PageHeader";
import { formatAge, formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Ticks once a second so SLO timers count down live without refetching. */
export const useNow = (ms = 1000) => { const [now, setNow] = useState(() => Date.now()); useEffect(() => { const i = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(i); }, [ms]); return now; };

/** KXMOP12 delivery SLO: SAFETY_ALERT_RAISED must reach on-call within 60 s. Undelivered: live countdown to the deadline, then BREACHED. Delivered: the achieved lag. */
export function SloTimer({ alert, now }: { alert: SafetyAlert; now: number }) {
  const { t } = useTranslation();
  const slo = alert.slo;
  if (slo.deliveredAt) {
    return <Badge variant={slo.met === false ? "destructive" : "success"} data-testid="slo" data-state={slo.met === false ? "late" : "met"}>{slo.met === false ? t("safety.sloLate", { s: slo.deliveryLagSeconds ?? 0 }) : t("safety.sloMet", { s: slo.deliveryLagSeconds ?? 0 })}</Badge>;
  }
  const left = Math.ceil((new Date(slo.deadlineAt).getTime() - now) / 1000);
  return left > 0
    ? <Badge variant={left <= 15 ? "destructive" : "warning"} data-testid="slo" data-state="counting"><span role="timer" aria-live="off" className="kx-label-num">{t("safety.sloLeft", { s: left })}</span></Badge>
    : <Badge variant="destructive" data-testid="slo" data-state="breached">{t("safety.sloBreached")}</Badge>;
}

const kindTone = (k: SafetyAlert["kind"]) => (k === "SOS" || k === "UNSAFE_ABORT" ? "destructive" : "warning") as "destructive" | "warning";
const statusTone = (s: SafetyAlert["status"]) => (s === "RESOLVED" ? "success" : s === "ACKNOWLEDGED" ? "info" : s === "ESCALATED" ? "destructive" : "warning") as "success" | "info" | "destructive" | "warning";

function ActionDialog({ target, onClose }: { target: { alert: SafetyAlert; action: AlertAction } | null; onClose: () => void }) {
  const { t } = useTranslation();
  const act = useAlertAction();
  const [note, setNote] = useState("");
  if (!target) return null;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="safety-dialog">
        <DialogHeader><DialogTitle>{t(`safety.${target.action}Title`)}</DialogTitle><DialogDescription>{t(`safety.${target.action}Body`)}</DialogDescription></DialogHeader>
        <div className="space-y-1"><Label htmlFor="sf-note">{t("safety.note")}</Label><Input id="sf-note" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} data-testid="safety-note" /></div>
        <DialogFooter><Button variant="outline" onClick={onClose}>{t("common.cancel")}</Button>
          <Button variant={target.action === "escalate" ? "destructive" : "default"} disabled={act.isPending} data-testid="safety-confirm"
            onClick={() => act.mutate({ id: target.alert.id, action: target.action, note: note.trim() || undefined }, { onSuccess: () => { toast.success(t("safety.done")); onClose(); }, onError: (e) => toast.error(e instanceof ApiError ? `${e.code}: ${e.message}` : t("states.errorTitle")) })}>{t(`safety.${target.action}`)}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function SafetyPage() {
  const { t, i18n } = useTranslation();
  const [status, setStatus] = useState("");
  const alerts = useSafetyAlerts(status);
  const summary = useSafetySummary();
  const sweep = useSafetySweep();
  const now = useNow();
  const [target, setTarget] = useState<{ alert: SafetyAlert; action: AlertAction } | null>(null);
  const s = summary.data;
  return (
    <div className="space-y-5">
      <PageHeader title={t("safety.title")} hint={t("safety.hint", { s: s?.sloSeconds ?? 60 })}
        actions={<Button variant="outline" disabled={sweep.isPending} data-testid="safety-sweep" onClick={() => sweep.mutate(undefined, { onSuccess: (r) => toast.success(t("safety.swept", { retried: r.retried, escalated: r.escalated })), onError: () => toast.error(t("states.errorTitle")) })}><BellRing aria-hidden="true" />{t("safety.sweep")}</Button>} />
      {summary.isLoading ? <CardSkeleton rows={1} /> : summary.error ? <ErrorState error={summary.error} onRetry={() => void summary.refetch()} /> : s && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="safety-tiles">
          <StatTile label={t("safety.open")} value={s.open} tone={s.open ? "warn" : "ok"} />
          <StatTile label={t("safety.unacknowledged")} value={s.unacknowledged} tone={s.unacknowledged ? "warn" : "ok"} />
          <StatTile label={t("safety.sloBreaches")} value={s.sloBreaches} tone={s.sloBreaches ? "warn" : "ok"} />
          <StatTile label={t("safety.unsafeAborts")} value={s.unsafeAborts} />
          <StatTile label={t("safety.heldDeposits")} value={s.depositsHeldForReview} tone={s.depositsHeldForReview ? "warn" : undefined} />
          <StatTile label={t("safety.median")} value={formatAge(s.medianDeliverySeconds)} />
          <StatTile label={t("safety.p95")} value={formatAge(s.p95DeliverySeconds)} />
          <StatTile label={t("safety.mode")} value={s.deliveryMode} />
        </div>
      )}
      {s?.deliveryMode === "mock" && <p role="note" className="rounded-xl border border-dashed border-warning/60 bg-warning-soft px-4 py-2 text-sm text-warning" data-testid="safety-mock-note">{t("safety.mockNote")}</p>}
      <div className="flex items-end gap-3">
        <div className="space-y-1"><Label htmlFor="sf-status">{t("safety.status")}</Label>
          <select id="sf-status" value={status} onChange={(e) => setStatus(e.target.value)} className="h-11 rounded-xl border border-input bg-card px-3 text-sm" data-testid="safety-status-filter">
            <option value="">{t("common.all")}</option>{["RAISED", "ACKNOWLEDGED", "ESCALATED", "RESOLVED"].map((x) => <option key={x} value={x}>{t(`safety.st.${x}`)}</option>)}</select></div>
      </div>
      {alerts.isLoading ? <CardSkeleton rows={2} /> : alerts.error ? <ErrorState error={alerts.error} onRetry={() => void alerts.refetch()} /> : (
        <DataTable caption={t("safety.feed")} rows={alerts.data!.items} rowKey={(a) => a.id} empty={t("safety.none")} columns={[
          { key: "k", header: t("safety.kind"), cell: (a) => <div className="space-y-1"><Badge variant={kindTone(a.kind)}><Siren className="me-1 h-3 w-3" aria-hidden="true" />{t(`safety.kinds.${a.kind}`)}</Badge>{a.needsEscalation && a.status === "RAISED" && <p className="flex items-center gap-1 text-xs text-destructive" data-testid="needs-escalation"><TriangleAlert className="h-3 w-3" aria-hidden="true" />{t("safety.needsEscalation")}</p>}</div> },
          { key: "t", header: t("safety.slo"), cell: (a) => <SloTimer alert={a} now={now} /> },
          { key: "s", header: t("safety.status"), cell: (a) => <Badge variant={statusTone(a.status)} data-testid="alert-status">{t(`safety.st.${a.status}`)}{a.escalationLevel > 0 ? ` · L${a.escalationLevel}` : ""}</Badge> },
          { key: "d", header: t("safety.district"), cell: (a) => a.district ?? "—" }, { key: "p", header: t("safety.provider"), cell: (a) => <div className="text-xs">{a.providerName ?? "—"}{a.clinicPhone && <><br /><span dir="ltr">{a.clinicPhone}</span></>}</div> },
          { key: "r", header: t("safety.raised"), cell: (a) => <div className="text-xs">{formatDateTime(a.raisedAt, i18n.language)}<br />{formatAge(a.ageSeconds)}</div> },
          { key: "a", header: "", cell: (a) => (
            <div className={cn("flex flex-wrap gap-2")}>
              {a.status === "RAISED" && <Button size="sm" onClick={() => setTarget({ alert: a, action: "acknowledge" })} data-testid={`ack-${a.id}`}><CheckCheck aria-hidden="true" />{t("safety.acknowledge")}</Button>}
              {(a.status === "RAISED" || a.status === "ACKNOWLEDGED") && <Button size="sm" variant="destructive" onClick={() => setTarget({ alert: a, action: "escalate" })} data-testid={`esc-${a.id}`}>{t("safety.escalate")}</Button>}
              {a.status !== "RESOLVED" && <Button size="sm" variant="outline" onClick={() => setTarget({ alert: a, action: "resolve" })} data-testid={`res-${a.id}`}>{t("safety.resolve")}</Button>}
            </div>) },
        ]} />
      )}
      <ActionDialog key={target?.alert.id + (target?.action ?? "")} target={target} onClose={() => setTarget(null)} />
    </div>
  );
}
