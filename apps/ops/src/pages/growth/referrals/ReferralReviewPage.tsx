import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ApiError } from "@/api/errors";
import { useGrowthAccess } from "@/api/growth";
import { useReferral, useReferralDecision, type ReferralDecision } from "@/api/referrals";
import { FormField, StatusChip } from "@/components/kit";
import { DataTable } from "@/components/DataTable";
import { CardSkeleton, ErrorState } from "@/components/states";
import { GrowthPage, Section } from "@/components/growth/GrowthPage";
import { formatDateTime } from "@/lib/format";

const btn = "inline-flex h-11 items-center justify-center rounded-xl px-4 text-sm font-semibold disabled:opacity-50";

/** Reviewer view of one relationship (GRW-P2-B3): check rows and fraud signals with opaque references of both sides, never a phone, a name or any contact. */
export default function ReferralReviewPage() {
  const { id = "" } = useParams(); const { t, i18n } = useTranslation(); const q = useReferral(id); const dec = useReferralDecision(); const access = useGrowthAccess().data?.capabilities;
  const [note, setNote] = useState(""); const [msg, setMsg] = useState<string | null>(null);
  const run = (decision: ReferralDecision) => { setMsg(null); dec.mutate({ id, decision, note: note.trim() || undefined }, { onSuccess: (r) => { toast.success(t(`growth.referrals.decided.${decision}`)); setMsg((r as { pendingSecondApprover?: boolean }).pendingSecondApprover ? t("growth.referrals.needsSecond") : null); }, onError: (e) => setMsg(e instanceof ApiError ? `${t(`growth.referrals.err.${e.code}`, { defaultValue: "" }) || e.message}` : t("states.errorTitle")) }); };
  const d = q.data; const notFound = d?.error === "REFERRAL_NOT_FOUND";
  const held = d?.reviewState === "HOLD";
  return (
    <GrowthPage section="referrals">
      <Link to="/growth/referrals" className="text-sm font-semibold text-primary hover:underline">{t("growth.referrals.back")}</Link>
      {q.isLoading ? <CardSkeleton rows={3} /> : q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : notFound || !d ? <p className="kx-card p-4 text-sm" role="status" data-testid="referral-notfound">{t("growth.referrals.notFound")}</p> : (
        <>
          <Section title={t("growth.referrals.reviewTitle")} id="rv-facts">
            <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2" data-testid="referral-facts">
              <div><dt className="text-muted-foreground">{t("growth.referrals.colId")}</dt><dd className="font-mono text-xs" dir="ltr">{d.id}</dd></div>
              <div><dt className="text-muted-foreground">{t("growth.referrals.colStatus")}</dt><dd><StatusChip tone={d.status === "QUALIFIED" ? "success" : d.status === "REJECTED" ? "danger" : "info"}>{t(`growth.referrals.status.${d.status}`, d.status)}</StatusChip>{held && <> <StatusChip tone="warning">{t("growth.referrals.onHold")}</StatusChip></>}</dd></div>
              <div><dt className="text-muted-foreground">{t("growth.referrals.referrer")}</dt><dd className="font-mono text-xs" dir="ltr" data-testid="referrer-ref">{d.referrerRef}</dd></div>
              <div><dt className="text-muted-foreground">{t("growth.referrals.referee")}</dt><dd className="font-mono text-xs" dir="ltr" data-testid="referee-ref">{d.refereeRef}</dd></div>
              <div><dt className="text-muted-foreground">{t("growth.referrals.colCreated")}</dt><dd>{formatDateTime(d.createdAt, i18n.language)}</dd></div>
              <div><dt className="text-muted-foreground">{t("growth.referrals.colHold")}</dt><dd>{d.holdUntil ? formatDateTime(d.holdUntil, i18n.language) : "—"}</dd></div>
              <div><dt className="text-muted-foreground">{t("growth.referrals.rejectReason")}</dt><dd>{d.rejectReason ? <code className="text-xs">{d.rejectReason}</code> : "—"}</dd></div>
              <div><dt className="text-muted-foreground">{t("growth.referrals.ruleVersion")}</dt><dd><Link className="font-mono text-xs text-primary hover:underline" dir="ltr" to="/growth/config">{d.ruleVersionId}</Link></dd></div>
            </dl>
          </Section>
          <Section title={t("growth.referrals.checks")} id="rv-checks">
            <DataTable caption={t("growth.referrals.checks")} rows={d.checks} rowKey={(r) => `${r.key}-${r.at}`} empty={t("growth.referrals.noChecks")} columns={[
              { key: "k", header: t("growth.referrals.check"), cell: (r) => <code className="text-xs">{r.key}</code> },
              { key: "p", header: t("growth.referrals.result"), cell: (r) => <StatusChip tone={r.passed ? "success" : "danger"}>{r.passed ? t("growth.referrals.pass") : t("growth.referrals.fail")}</StatusChip> },
              { key: "d", header: t("growth.referrals.detail"), cell: (r) => <code className="text-xs" dir="ltr">{r.detail ? JSON.stringify(r.detail) : "—"}</code> },
              { key: "a", header: t("growth.referrals.colCreated"), cell: (r) => <span className="text-xs">{formatDateTime(r.at, i18n.language)}</span> },
            ]} />
          </Section>
          <Section title={t("growth.referrals.signals")} id="rv-signals">
            <DataTable caption={t("growth.referrals.signals")} rows={d.signals} rowKey={(r) => r.id} empty={t("growth.referrals.noSignals")} columns={[
              { key: "r", header: t("growth.referrals.rule"), cell: (r) => <code className="text-xs">{r.ruleId}</code> }, { key: "s", header: t("growth.referrals.score"), cell: (r) => r.score }, { key: "v", header: t("growth.referrals.colStatus"), cell: (r) => r.reviewStatus },
            ]} />
          </Section>
          <Section title={t("growth.referrals.decision")} id="rv-decision" hint={t("growth.referrals.decisionHint")}>
            {!access?.reviewFraud ? <p className="text-sm text-muted-foreground" data-testid="referral-readonly">{t("growth.referrals.readOnly")}</p> : (
              <div className="space-y-3">
                <FormField label={t("growth.referrals.note")}><input className="h-11 w-full max-w-xl rounded-xl border bg-card px-3 text-sm" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} data-testid="decision-note" /></FormField>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className={`${btn} border hover:bg-accent`} disabled={dec.isPending || !held} onClick={() => run("RELEASE_HOLD")} data-testid="decision-release">{t("growth.referrals.release")}</button>
                  <button type="button" className={`${btn} border border-destructive/50 text-destructive hover:bg-accent`} disabled={dec.isPending || d.status === "QUALIFIED" || d.status === "REJECTED"} onClick={() => run("REJECT")} data-testid="decision-reject">{t("growth.referrals.reject")}</button>
                  <button type="button" className={`${btn} bg-primary text-primary-foreground`} disabled={dec.isPending || !access?.manage || d.status === "QUALIFIED"} onClick={() => run("QUALIFY_OVERRIDE")} data-testid="decision-override">{t("growth.referrals.override")}</button>
                </div>
                <p className="text-xs text-muted-foreground">{t("growth.referrals.overrideRule")}</p>
                {msg && <p role="alert" className="text-sm text-warning" data-testid="decision-message">{msg}</p>}
              </div>)}
          </Section>
        </>)}
    </GrowthPage>
  );
}
