import { useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useApprovals, useCampaignActions, type Approval } from "@/api/campaigns";
import { useAuth } from "@/auth/AuthProvider";
import { useGrowthAccess } from "@/api/growth";
import { FormField } from "@/components/kit";
import { CardSkeleton, ErrorState } from "@/components/states";
import { GrowthPage, Section } from "@/components/growth/GrowthPage";
import { useErrorText, useMoney } from "@/components/growth/campaign-parts";
import { formatDateTime } from "@/lib/format";

const btn = "inline-flex h-11 items-center justify-center rounded-xl px-4 text-sm font-semibold disabled:opacity-50";

/** The second-person queue. The requester sees a pending row but cannot decide it (the server refuses too); the decision always carries the payload hash the reviewer saw. */
export default function ApprovalsPage() {
  const { t, i18n } = useTranslation(); const money = useMoney(); const acts = useCampaignActions(); const errText = useErrorText(); const { user } = useAuth(); const access = useGrowthAccess(); const can = !!access.data?.capabilities.manageCampaigns;
  const pending = useApprovals("pending"); const decided = useApprovals("decided");
  const [reason, setReason] = useState<Record<string, string>>({}); const [err, setErr] = useState<Record<string, string>>({});
  const decide = (a: Approval, decision: "APPROVED" | "REJECTED") => { setErr((e) => ({ ...e, [a.id]: "" })); acts.decide.mutate({ id: a.id, decision, snapshotHash: a.snapshotHash, reason: reason[a.id] || undefined }, { onSuccess: () => toast.success(t("growth.campaigns.approvals.reviewed")), onError: (e) => setErr((x) => ({ ...x, [a.id]: errText(e) })) }); };
  const payload = (a: Approval) => a.snapshot.payload as { budgetTotalMinor: number; budgetDailyMinor: number; currency: string; channels: string[]; startsAt: string | null; endsAt: string | null };
  return (
    <GrowthPage section="approvals">
      {pending.isLoading ? <CardSkeleton rows={2} /> : pending.isError ? <ErrorState error={pending.error} onRetry={() => void pending.refetch()} /> : (
        <Section title={t("growth.campaigns.approvals.title")} id="apq">
          {(pending.data?.length ?? 0) === 0 ? <p className="text-sm text-muted-foreground" data-testid="approvals-empty">{t("growth.campaigns.approvals.none")}</p> : (
            <ul className="space-y-3" data-testid="approvals-pending">
              {pending.data!.map((a) => { const p = payload(a); const mine = a.requestedBy === user?.sub; return (
                <li key={a.id} className="space-y-2 rounded-xl border p-4" data-testid="approval-card" data-approval-id={a.id} data-kind={a.kind}>
                  <div className="flex flex-wrap items-center justify-between gap-2"><div><Link className="font-semibold text-primary hover:underline" to={`/growth/campaigns/${a.campaignId}`}>{a.campaign?.name ?? a.campaignId}</Link> <span className="text-sm text-muted-foreground">· {t(`growth.campaigns.approvals.kind.${a.kind}`)}</span></div><span className="text-xs text-muted-foreground">{t("growth.campaigns.approvals.by", { who: a.requestedBy })} · {formatDateTime(a.requestedAt, i18n.language)}</span></div>
                  <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2" aria-label={t("growth.campaigns.approvals.payload")}><div><dt className="text-muted-foreground">{t("growth.campaigns.detail.budget")}</dt><dd dir="ltr">{money(p.budgetTotalMinor, p.currency)} / {money(p.budgetDailyMinor, p.currency)}</dd></div><div><dt className="text-muted-foreground">{t("growth.campaigns.wizard.channels")}</dt><dd>{p.channels.map((c) => t(`growth.campaigns.channel.${c}`, { defaultValue: c })).join(", ")}</dd></div><div className="sm:col-span-2"><dt className="text-muted-foreground">{t("growth.campaigns.approvals.hash")}</dt><dd><code dir="ltr" className="break-all text-xs">{a.snapshotHash}</code></dd></div></dl>
                  {mine ? <p className="text-sm text-warning" data-testid="approval-self">{t("growth.campaigns.approvals.self")}</p> : (
                    <div className="flex flex-wrap items-end gap-3"><FormField label={t("growth.campaigns.approvals.reasonLabel")} className="min-w-64 flex-1"><input className="h-11 w-full rounded-xl border border-input bg-card px-3 text-sm" value={reason[a.id] ?? ""} onChange={(e) => setReason((r) => ({ ...r, [a.id]: e.target.value }))} maxLength={300} data-testid="approval-reason" /></FormField>
                      <button type="button" className={`${btn} bg-primary text-primary-foreground`} disabled={!can || acts.decide.isPending} onClick={() => decide(a, "APPROVED")} data-testid="approval-approve">{t("growth.campaigns.approvals.approve")}</button>
                      <button type="button" className={`${btn} border hover:bg-accent`} disabled={!can || acts.decide.isPending || !(reason[a.id] ?? "").trim()} onClick={() => decide(a, "REJECTED")} data-testid="approval-reject">{t("growth.campaigns.approvals.reject")}</button></div>)}
                  {err[a.id] && <p role="alert" className="text-sm text-destructive" data-testid="approval-error">{err[a.id]}</p>}
                </li>); })}
            </ul>)}
        </Section>)}
      <Section title={t("growth.campaigns.approvals.history")} id="aph">{(decided.data?.length ?? 0) === 0 ? <p className="text-sm text-muted-foreground">{t("growth.campaigns.approvals.none")}</p> : <ul className="space-y-1 text-sm" data-testid="approvals-decided">{decided.data!.slice(0, 30).map((a) => <li key={a.id} className="flex flex-wrap justify-between gap-2 border-b py-1.5"><span>{a.campaign?.name ?? a.campaignId} · {t(`growth.campaigns.approvals.kind.${a.kind}`)}</span><span className="font-semibold">{a.decision ? t(`growth.campaigns.approvals.decision.${a.decision}`) : ""} · {a.decidedBy}</span></li>)}</ul>}</Section>
    </GrowthPage>
  );
}
