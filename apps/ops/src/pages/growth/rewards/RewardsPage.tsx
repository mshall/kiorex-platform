import { useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";
import { ApiError } from "@/api/errors";
import { useGrowthAccess } from "@/api/growth";
import { useRewardActions, useRewardApprovals, useRewardLots, useRewardsOverview } from "@/api/referrals";
import { StatusChip } from "@/components/kit";
import { DataTable } from "@/components/DataTable";
import { CardSkeleton, ErrorState } from "@/components/states";
import { GrowthPage, Section, selectCls } from "@/components/growth/GrowthPage";
import { formatDateTime, formatMinor } from "@/lib/format";
import { ManualIssueDialog } from "./ManualIssueDialog";

const STATUSES = ["", "ACTIVE", "HELD", "EXHAUSTED", "EXPIRED", "REVERSED"] as const;
const TONE = { ACTIVE: "success", HELD: "warning", EXHAUSTED: "neutral", EXPIRED: "neutral", REVERSED: "danger" } as const;

/** Rewards (GRW-P2-B3): mode and switches, the lots and their balances, the second-approver queue, manual issue. Patients appear only as an opaque reference. */
export default function RewardsPage() {
  const { t, i18n } = useTranslation(); const lang = i18n.language; const access = useGrowthAccess().data?.capabilities;
  const [status, setStatus] = useState(""); const [open, setOpen] = useState(false);
  const ov = useRewardsOverview(); const lots = useRewardLots({ status: status || undefined }); const apps = useRewardApprovals(); const act = useRewardActions();
  const decide = (id: string, decision: "APPROVED" | "REJECTED") => act.decide.mutate({ id, decision }, { onSuccess: () => toast.success(t(`growth.rewards.decided.${decision}`)), onError: (e) => toast.error(e instanceof ApiError ? t(`growth.rewards.err.${e.code}`, { defaultValue: e.message }) : t("states.errorTitle")) });
  return (
    <GrowthPage section="rewards" actions={access?.manage ? <button type="button" className="inline-flex h-11 items-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground" onClick={() => setOpen(true)} data-testid="manual-issue-open">{t("growth.rewards.manual.open")}</button> : undefined}>
      <div className="flex flex-wrap gap-3 text-sm"><Link className="font-semibold text-primary hover:underline" to="/growth/rewards/finance" data-testid="rewards-finance-link">{t("growth.rewards.financeLink")}</Link><Link className="font-semibold text-primary hover:underline" to="/growth/config">{t("growth.referrals.rulesLink")}</Link></div>
      {ov.isLoading ? <CardSkeleton rows={2} /> : ov.error ? <ErrorState error={ov.error} onRetry={() => void ov.refetch()} /> : ov.data && (
        <Section title={t("growth.rewards.mode")} id="rw-mode">
          {ov.data.banner === "NO_DEPOSIT_CONFIGURED" && <p className="mb-3 flex items-start gap-2 rounded-xl border border-warning/40 bg-card p-3 text-sm" role="status" data-testid="rewards-no-deposit"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />{t("growth.rewards.noDeposit")}</p>}
          <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-3" data-testid="rewards-overview">
            <div><dt className="text-muted-foreground">{t("growth.rewards.configuredMode")}</dt><dd><StatusChip tone="info">{t(`growth.rewards.modes.${ov.data.mode}`, ov.data.mode)}</StatusChip></dd></div>
            <div><dt className="text-muted-foreground">{t("growth.rewards.effectiveMode")}</dt><dd><StatusChip tone="info">{t(`growth.rewards.modes.${ov.data.effectiveMode}`, ov.data.effectiveMode)}</StatusChip></dd></div>
            <div><dt className="text-muted-foreground">{t("growth.referrals.ruleVersion")}</dt><dd className="font-mono text-xs" dir="ltr">{ov.data.ruleVersionId}</dd></div>
          </dl>
          <ul className="mt-3 flex flex-wrap gap-2" aria-label={t("growth.rewards.switches")}>{Object.entries(ov.data.flags).map(([k, v]) => <li key={k}><StatusChip tone={v ? "success" : "neutral"}>{t(`growth.rewards.flag.${k}`, k)}: {v ? t("growth.common.on") : t("growth.common.off")}</StatusChip></li>)}</ul>
          <p className="mt-2 text-xs text-muted-foreground">{t("growth.rewards.closedLoop")}</p>
        </Section>)}
      {(apps.data?.length ?? 0) > 0 && (
        <Section title={t("growth.rewards.approvals")} id="rw-approvals" hint={t("growth.rewards.approvalsHint")}>
          <DataTable caption={t("growth.rewards.approvals")} rows={apps.data!} rowKey={(r) => r.id} columns={[
            { key: "k", header: t("growth.rewards.kind"), cell: (r) => t(`growth.rewards.approvalKind.${r.kind}`, r.kind) }, { key: "a", header: t("growth.rewards.amount"), cell: (r) => formatMinor(r.amountMinor, lang) },
            { key: "r", header: t("growth.rewards.manual.reason"), cell: (r) => <span className="text-xs">{r.reason}</span> }, { key: "by", header: t("growth.rewards.requestedBy"), cell: (r) => <code className="text-xs" dir="ltr">{r.requestedBy}</code> },
            { key: "d", header: t("growth.rewards.decision"), cell: (r) => access?.manage ? <div className="flex gap-2"><button type="button" className="inline-flex h-9 items-center rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground" onClick={() => decide(r.id, "APPROVED")} data-testid={`approve-${r.id}`}>{t("growth.rewards.approve")}</button><button type="button" className="inline-flex h-9 items-center rounded-lg border px-3 text-xs font-semibold" onClick={() => decide(r.id, "REJECTED")} data-testid={`reject-${r.id}`}>{t("growth.rewards.rejectBtn")}</button></div> : "—" },
          ]} />
        </Section>)}
      <Section title={t("growth.rewards.lots")} id="rw-lots" hint={t("growth.rewards.lotsHint")}>
        <label className="mb-3 flex items-center gap-2 text-sm"><span className="text-muted-foreground">{t("growth.rewards.status")}</span><select className={selectCls} value={status} onChange={(e) => setStatus(e.target.value)} data-testid="lot-status-filter">{STATUSES.map((s) => <option key={s} value={s}>{s ? t(`growth.rewards.lotStatus.${s}`) : t("growth.rewards.allStatuses")}</option>)}</select></label>
        {lots.isLoading ? <CardSkeleton rows={3} /> : lots.error ? <ErrorState error={lots.error} onRetry={() => void lots.refetch()} /> : (
          <DataTable caption={t("growth.rewards.lots")} rows={lots.data ?? []} rowKey={(r) => r.id} empty={t("growth.rewards.noLots")} columns={[
            { key: "id", header: t("growth.referrals.colId"), cell: (r) => <Link className="font-mono text-xs text-primary hover:underline" dir="ltr" to={`/growth/rewards/lots/${r.id}`}>{r.id}</Link> },
            { key: "p", header: t("growth.rewards.patient"), cell: (r) => <code className="text-xs" dir="ltr">{r.patientRef}</code> },
            { key: "k", header: t("growth.rewards.kind"), cell: (r) => <span className="text-xs">{r.kind} · {r.mode}</span> },
            { key: "f", header: t("growth.rewards.funding"), cell: (r) => <span className="text-xs">{t(`growth.rewards.fundingKinds.${r.funding}`, r.funding)}</span> },
            { key: "s", header: t("growth.rewards.status"), cell: (r) => <StatusChip tone={TONE[r.status as keyof typeof TONE] ?? "neutral"}>{t(`growth.rewards.lotStatus.${r.status}`, r.status)}</StatusChip> },
            { key: "a", header: t("growth.rewards.available"), cell: (r) => <span data-testid={`lot-available-${r.id}`}>{formatMinor(r.availableMinor, lang, r.currency)}</span> },
            { key: "e", header: t("growth.rewards.expires"), cell: (r) => <span className="text-xs">{formatDateTime(r.expiresAt, lang)}</span> },
          ]} />)}
      </Section>
      <ManualIssueDialog open={open} onOpenChange={setOpen} />
    </GrowthPage>
  );
}
