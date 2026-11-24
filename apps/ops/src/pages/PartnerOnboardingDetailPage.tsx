import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, CircleDashed, Hand, Lock, RefreshCw, ShieldCheck, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/auth/AuthProvider";
import { ApiError } from "@/api/errors";
import { usePartnerAction, usePartnerAudit, usePartnerConnection, type PartnerDetail, type PartnerStep } from "@/api/partnerOnboarding";
import { CardSkeleton, ErrorState } from "@/components/states";
import { PageHeader, StatusChip } from "@/components/kit";
import { formatDateTime } from "@/lib/format";
import { PARTNER_TONE } from "./PartnerOnboardingPage";

const ICON = { DONE: CheckCircle2, WARN: AlertTriangle, FAILED: XCircle, PENDING: CircleDashed, ACTION: Hand, LOCKED: Lock } as const;
const TONE = { DONE: "text-success", WARN: "text-warning", FAILED: "text-destructive", PENDING: "text-muted-foreground", ACTION: "text-primary", LOCKED: "text-muted-foreground" } as const;

/** One wizard step. AUTO steps run themselves; HUMAN steps in ACTION state are highlighted and carry their own form. */
function StepCard({ step, d, id }: { step: PartnerStep; d: PartnerDetail; id: string }) {
  const { t } = useTranslation(); const { user } = useAuth(); const act = usePartnerAction(id);
  const [text, setText] = useState(""); const [mode, setMode] = useState<"STANDARD" | "ORG_OVERRIDE">("STANDARD");
  const isSuper = !!user?.roles.includes("super_admin"); const me = user?.sub;
  const Icon = ICON[step.state]; const human = step.type === "HUMAN"; const live = ["LIVE", "REJECTED"].includes(d.status);
  const run = (path: string, body?: unknown, ok?: string) => act.mutate({ path, body }, { onSuccess: () => ok && toast.success(ok), onError: (e) => toast.error(e instanceof ApiError ? t(`pob.err.${e.code}`, { defaultValue: e.message }) : t("pob.err.generic")) });
  const actionable = human && step.state === "ACTION" && !live;
  const fail = step.state === "FAILED" || step.state === "WARN";
  const detailRows = Object.entries((step.detail ?? {}) as Record<string, unknown>).filter(([k, v]) => k !== "gates" && k !== "states" && (typeof v === "number" || typeof v === "string" || Array.isArray(v)));
  const gates = (step.detail?.gates ?? []) as Array<{ flag: string; satisfied: boolean }>;
  return (
    <li className={`rounded-2xl border bg-card p-4 ${actionable ? "ring-2 ring-primary/40" : ""}`} data-testid={`step-${step.key}`} data-state={step.state} data-type={step.type}>
      <div className="flex flex-wrap items-center gap-2">
        <Icon className={`h-5 w-5 ${TONE[step.state]}`} aria-hidden="true" />
        <b>{t(`pob.step.${step.key}.title`)}</b>
        <Badge variant={human ? "info" : "secondary"}>{human ? t("pob.human") : t("pob.auto")}</Badge>
        {actionable && <Badge variant="warning" data-testid="action-needed">{t("pob.actionNeeded")}</Badge>}
        <span className="sr-only">{t(`pob.state.${step.state}`)}</span>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{t(`pob.step.${step.key}.hint`)}</p>
      {step.code && fail && <p className="mt-1 text-sm" data-testid={`code-${step.key}`}>{t(`pob.code.${step.code}`, { defaultValue: step.code })}</p>}
      {step.code && !fail && step.state === "ACTION" && <p className="mt-1 text-sm">{t(`pob.code.${step.code}`, { defaultValue: step.code })}</p>}
      {detailRows.length > 0 && step.type === "AUTO" && <p className="mt-1 text-xs text-muted-foreground" dir="ltr">{detailRows.map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : String(v)}`).join(" · ")}</p>}
      {gates.length > 0 && <ul className="mt-2 space-y-1 text-sm">{gates.map((g) => <li key={g.flag} className="flex items-center gap-2"><code dir="ltr">{g.flag}</code><StatusChip tone={g.satisfied ? "success" : "warning"}>{g.satisfied ? t("pob.gateOk") : t("pob.gateOpen")}</StatusChip></li>)}</ul>}
      {step.key === "launch_gate" && step.state === "ACTION" && <p className="mt-2 text-sm" data-testid="gate-note">{t("pob.gateNote")} <Link className="font-semibold underline" to="/flags">{t("pob.openFlags")}</Link></p>}
      {actionable && step.key === "review_documents" && <div className="mt-3 flex flex-wrap gap-2"><Input aria-label={t("pob.note")} placeholder={t("pob.note")} className="w-64" dir="auto" value={text} onChange={(e) => setText(e.target.value)} /><Button disabled={act.isPending} onClick={() => run("steps/review_documents", { note: text || undefined }, t("pob.saved"))} data-testid="act-docs">{t("pob.step.review_documents.action")}</Button></div>}
      {actionable && step.key === "verify_licence" && <div className="mt-3 flex flex-wrap gap-2"><Input aria-label={t("pob.licenceRef")} placeholder={t("pob.licenceRef")} className="w-64" dir="ltr" value={text} onChange={(e) => setText(e.target.value)} data-testid="licence-ref" /><Button disabled={act.isPending || text.trim().length < 3} onClick={() => run("steps/verify_licence", { reference: text }, t("pob.saved"))} data-testid="act-licence">{t("pob.step.verify_licence.action")}</Button></div>}
      {actionable && step.key === "fees" && (
        <div className="mt-3 space-y-2">
          <div role="radiogroup" aria-label={t("pob.step.fees.title")} className="flex flex-wrap gap-3 text-sm">
            <label className="flex items-center gap-2"><input type="radio" checked={mode === "STANDARD"} onChange={() => setMode("STANDARD")} />{t("pob.fees.standard")}</label>
            <label className="flex items-center gap-2"><input type="radio" checked={mode === "ORG_OVERRIDE"} onChange={() => setMode("ORG_OVERRIDE")} data-testid="fees-override" />{t("pob.fees.override")} <Link className="underline" to="/policy">{t("pob.openPolicy")}</Link></label>
          </div>
          <div className="flex flex-wrap gap-2"><Input aria-label={t("pob.note")} placeholder={t("pob.note")} className="w-64" dir="auto" value={text} onChange={(e) => setText(e.target.value)} /><Button disabled={act.isPending || (mode === "ORG_OVERRIDE" && !text.trim())} onClick={() => run("steps/fees", { mode, note: text || undefined }, t("pob.saved"))} data-testid="act-fees">{t("pob.step.fees.action")}</Button></div>
        </div>
      )}
      {step.key === "approval" && step.state === "ACTION" && !live && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {d.status !== "AWAITING_APPROVAL" && <Button disabled={act.isPending} onClick={() => run("request-approval", {}, t("pob.requested"))} data-testid="act-request">{t("pob.requestApproval")}</Button>}
          {d.status === "AWAITING_APPROVAL" && isSuper && <Button disabled={act.isPending || me === d.requestedBy} onClick={() => run("approve", {}, t("pob.approved"))} data-testid="act-approve"><ShieldCheck aria-hidden="true" />{t("pob.approve")}</Button>}
          {d.status === "AWAITING_APPROVAL" && me === d.requestedBy && <span className="text-xs text-muted-foreground" data-testid="two-person-note">{t("pob.twoPerson")}</span>}
        </div>
      )}
      {step.key === "go_live" && step.state === "ACTION" && <Button className="mt-3" disabled={act.isPending || d.blockers.length > 0} onClick={() => run("go-live", {}, t("pob.liveDone"))} data-testid="act-go-live">{t("pob.goLive")}</Button>}
    </li>
  );
}

/** Partner onboarding wizard: automated checks run themselves, human steps are highlighted, Go live opens only when every gate is green. */
export default function PartnerOnboardingDetailPage() {
  const { id = "" } = useParams(); const { t, i18n } = useTranslation(); const q = usePartnerConnection(id); const audit = usePartnerAudit(id); const act = usePartnerAction(id);
  const [reason, setReason] = useState("");
  if (q.isLoading) return <CardSkeleton rows={4} />; if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const d = q.data; const locked = ["LIVE", "REJECTED"].includes(d.status);
  const call = (path: string, body?: unknown, ok?: string) => act.mutate({ path, body }, { onSuccess: () => { if (ok) toast.success(ok); setReason(""); }, onError: (e) => toast.error(e instanceof ApiError ? t(`pob.err.${e.code}`, { defaultValue: e.message }) : t("pob.err.generic")) });
  const auto = d.steps.filter((s) => s.type === "AUTO"); const humanSteps = d.steps.filter((s) => s.type === "HUMAN");
  return (
    <div>
      <PageHeader title={<span dir="auto">{i18n.language.startsWith("ar") && d.nameAr ? d.nameAr : d.name}</span>} hint={`${t(`pob.kind.${d.kind}`)} · ${d.market} · ${d.orgRef}`} badge={<StatusChip tone={PARTNER_TONE[d.status] ?? "neutral"}>{t(`pob.st.${d.status}`)}</StatusChip>}
        actions={<Button variant="outline" disabled={act.isPending} onClick={() => call("run-checks", {}, t("pob.checksDone"))} data-testid="act-rerun"><RefreshCw aria-hidden="true" />{t("pob.rerun")}</Button>} />
      <div className="mb-5" role="progressbar" aria-valuenow={d.progress} aria-valuemin={0} aria-valuemax={100} aria-label={t("pob.progress")} data-testid="pob-progress">
        <div className="mb-1 flex justify-between text-sm"><span>{t("pob.progress")}</span><b className="kx-label-num">{d.progress}%</b></div>
        <div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary transition-all" style={{ width: `${d.progress}%` }} /></div>
        {d.checksRunAt && <p className="mt-1 text-xs text-muted-foreground">{t("pob.lastRun", { at: formatDateTime(d.checksRunAt, i18n.language) })}</p>}
      </div>
      {d.humanActions.length > 0 && !locked && <p className="mb-4 flex items-center gap-2 rounded-xl border border-primary/30 bg-primary/5 p-3 text-sm" data-testid="human-banner"><Hand className="h-4 w-4" aria-hidden="true" />{t("pob.humanBanner", { n: d.humanActions.length })}</p>}
      {d.decisionReason && ["CHANGES_REQUESTED", "REJECTED", "PAUSED"].includes(d.status) && <p className="mb-4 rounded-xl border p-3 text-sm" dir="auto">{t("pob.reasonLabel")}: {d.decisionReason}</p>}
      {d.rotationPending && <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-warning/40 p-3 text-sm" data-testid="rotation"><span>{t("pob.rotationPending")}</span><Button size="sm" disabled={act.isPending} onClick={() => call("apply-rotation", {}, t("pob.saved"))}>{t("pob.applyRotation")}</Button></div>}
      <Tabs defaultValue="steps">
        <TabsList><TabsTrigger value="steps" data-testid="tab-steps">{t("pob.tab.steps")}</TabsTrigger><TabsTrigger value="audit" data-testid="tab-audit">{t("pob.tab.audit")}</TabsTrigger></TabsList>
        <TabsContent value="steps">
          <h2 className="mb-2 mt-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{t("pob.autoSection")}</h2>
          <ul className="space-y-3" data-testid="auto-steps">{auto.map((s) => <StepCard key={s.key} step={s} d={d} id={id} />)}</ul>
          <h2 className="mb-2 mt-6 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{t("pob.humanSection")}</h2>
          <ul className="space-y-3" data-testid="human-steps">{humanSteps.map((s) => <StepCard key={s.key} step={s} d={d} id={id} />)}</ul>
          {d.blockers.length > 0 && !locked && <p className="mt-4 text-sm text-muted-foreground" data-testid="blockers">{t("pob.blockers")}: {d.blockers.map((b) => t(`pob.blocker.${b}`, { defaultValue: b })).join(" · ")}</p>}
          {!locked && (
            <div className="mt-5 flex flex-wrap items-end gap-2 border-t pt-4">
              <Input aria-label={t("pob.reason")} placeholder={t("pob.reason")} className="w-72" dir="auto" value={reason} onChange={(e) => setReason(e.target.value)} data-testid="decision-reason" />
              <Button variant="outline" disabled={act.isPending || !reason.trim()} onClick={() => call("request-changes", { reason }, t("pob.saved"))} data-testid="act-changes">{t("pob.requestChanges")}</Button>
              <Button variant="destructive" disabled={act.isPending || !reason.trim()} onClick={() => call("reject", { reason }, t("pob.saved"))} data-testid="act-reject">{t("pob.reject")}</Button>
            </div>
          )}
          {d.status === "LIVE" && <div className="mt-5 flex gap-2"><Input aria-label={t("pob.reason")} placeholder={t("pob.reason")} className="w-72" dir="auto" value={reason} onChange={(e) => setReason(e.target.value)} /><Button variant="outline" disabled={!reason.trim() || act.isPending} onClick={() => call("pause", { reason }, t("pob.saved"))} data-testid="act-pause">{t("pob.pause")}</Button></div>}
          {d.status === "PAUSED" && <Button className="mt-5" variant="outline" disabled={act.isPending} onClick={() => call("resume", {}, t("pob.saved"))} data-testid="act-resume">{t("pob.resume")}</Button>}
        </TabsContent>
        <TabsContent value="audit"><ul className="divide-y rounded-2xl border bg-card text-sm">{(audit.data ?? []).map((a) => <li key={a.id} className="flex flex-wrap justify-between gap-2 p-3"><code dir="ltr">{a.action}</code><span className="text-xs text-muted-foreground" dir="ltr">{a.actor} · {formatDateTime(a.createdAt, i18n.language)}</span></li>)}</ul></TabsContent>
      </Tabs>
    </div>
  );
}
