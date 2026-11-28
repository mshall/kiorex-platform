import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/auth/AuthProvider";
import { labelOf, useSiteLeadOwners, useSiteLeadSettings } from "@/api/siteLeads";
import { ONBOARDING_REQUEST_STATUSES, useLeadOnboarding, useLeadOnboardingAction, useLeadOnboardingList, type LeadOnboardingRequest } from "@/api/leadOnboarding";
import { CardSkeleton, ErrorState } from "@/components/states";
import { DataTable } from "@/components/DataTable";
import { PageHeader, StatusChip, type Tone } from "@/components/kit";
import { formatDateTime } from "@/lib/format";
import { onboardingUrlForLead } from "@/lib/leadOnboarding";

const TONE: Record<string, Tone> = { DRAFT: "neutral", SUBMITTED: "brand", APPROVED: "success", REJECTED: "neutral", CANCELLED: "neutral" };
const selectCls = "h-10 w-full rounded-md border border-input bg-background px-2 text-sm";

/** The drafts that won join requests created: one list for the Kiorex console and the Kiorly admin. */
export function LeadOnboardingListPage() {
  const { t, i18n } = useTranslation(); const lang = i18n.language; const [sp, setSp] = useSearchParams();
  const f = { status: sp.get("status") ?? "", assignee: sp.get("assignee") ?? "", mode: sp.get("mode") ?? "", page: Number(sp.get("page") ?? 1) || 1 };
  const set = (k: string, v: string) => setSp((p) => { const n = new URLSearchParams(p); if (v) n.set(k, v); else n.delete(k); n.delete("page"); return n; }, { replace: true });
  const q = useLeadOnboardingList(f); const owners = useSiteLeadOwners(); const settings = useSiteLeadSettings(); const cfg = settings.data?.config;
  return (
    <div data-testid="lead-onboarding-list">
      <Link to="/leads" className="mb-3 inline-flex items-center gap-1 text-sm font-medium underline-offset-2 hover:underline"><ArrowLeft className="h-4 w-4 rtl-flip" aria-hidden="true" />{t("leadOnboarding.backToLeads")}</Link>
      <PageHeader title={t("leadOnboarding.title")} hint={t("leadOnboarding.hint")} />
      <form className="mb-4 grid gap-3 rounded-xl border bg-card p-3 shadow-card sm:grid-cols-3" role="search" aria-label={t("leadOnboarding.filters")} onSubmit={(e) => e.preventDefault()}>
        <label className="text-xs font-medium">{t("leadOnboarding.status")}<select className={`${selectCls} mt-1`} value={f.status} onChange={(e) => set("status", e.target.value)} data-testid="lob-filter-status"><option value="">{t("leadOnboarding.all")}</option>{ONBOARDING_REQUEST_STATUSES.map((s) => <option key={s} value={s}>{t(`leadOnboarding.st.${s}`)}</option>)}</select></label>
        <label className="text-xs font-medium">{t("leadOnboarding.assignee")}<select className={`${selectCls} mt-1`} value={f.assignee} onChange={(e) => set("assignee", e.target.value)} data-testid="lob-filter-assignee"><option value="">{t("leadOnboarding.all")}</option><option value="none">{t("leadOnboarding.unassigned")}</option>{owners.data?.map((o) => <option key={o.sub} value={o.sub}>{o.name}</option>)}</select></label>
        <label className="text-xs font-medium">{t("leadOnboarding.mode")}<select className={`${selectCls} mt-1`} value={f.mode} onChange={(e) => set("mode", e.target.value)} data-testid="lob-filter-mode"><option value="">{t("leadOnboarding.all")}</option><option value="STANDALONE">{t("siteLeads.modeSTANDALONE")}</option><option value="CONNECTED">{t("siteLeads.modeCONNECTED")}</option></select></label>
      </form>
      {q.isLoading ? <CardSkeleton rows={3} /> : q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : (
        <DataTable caption={t("leadOnboarding.title")} rows={q.data!.items} rowKey={(r) => r.id} empty={t("leadOnboarding.none")} columns={[
          { key: "n", header: t("leadOnboarding.request"), cell: (r) => <div><Link className="font-semibold underline-offset-2 hover:underline" to={`/leads/onboarding/${r.id}`} data-testid={`lob-open-${r.contactRef}`} dir="auto">{r.legalName}</Link><span className="block font-mono text-xs text-muted-foreground">{r.contactRef}</span></div> },
          { key: "t", header: t("leadOnboarding.type"), cell: (r) => <span>{labelOf(cfg?.providerTypes, r.providerType, lang)}<span className="block text-xs text-muted-foreground">{t(`siteLeads.modeLong${r.mode}`)}</span></span> },
          { key: "k", header: t("leadOnboarding.kind"), cell: (r) => r.kind ? t(`leadOnboarding.kinds.${r.kind}`) : <span className="text-xs text-muted-foreground">{t("leadOnboarding.kindMissing")}</span> },
          { key: "s", header: t("leadOnboarding.status"), cell: (r) => <StatusChip tone={TONE[r.status] ?? "neutral"}>{t(`leadOnboarding.st.${r.status}`)}</StatusChip> },
          { key: "a", header: t("leadOnboarding.assignee"), cell: (r) => r.assigneeName ?? <span className="text-xs text-muted-foreground">{t("leadOnboarding.unassigned")}</span> },
          { key: "d", header: t("leadOnboarding.created"), cell: (r) => <span className="whitespace-nowrap text-xs">{formatDateTime(r.createdAt, lang)}</span> },
        ]} />
      )}
    </div>
  );
}

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => children === null || children === undefined || children === "" ? null : <div className="grid grid-cols-[9rem_1fr] gap-2 py-1"><dt className="text-xs font-semibold text-muted-foreground">{label}</dt><dd className="min-w-0 break-words text-sm" dir="auto">{children}</dd></div>;

/** One draft: prefilled from the join request, edited by the team, submitted by ops_admin or super_admin, approved by a DIFFERENT super admin. Approval creates nothing. */
export function LeadOnboardingDetailPage() {
  const { id = "" } = useParams(); const { t, i18n } = useTranslation(); const lang = i18n.language; const { user } = useAuth();
  const q = useLeadOnboarding(id); const act = useLeadOnboardingAction(id); const owners = useSiteLeadOwners(); const settings = useSiteLeadSettings(); const cfg = settings.data?.config;
  const [note, setNote] = useState<string | null>(null); const [reason, setReason] = useState(""); const [decide, setDecide] = useState<"reject" | "cancel" | null>(null);
  if (q.isLoading) return <CardSkeleton rows={4} />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const d: LeadOnboardingRequest = q.data; const isSuper = !!user?.roles.includes("super_admin"); const draft = d.status === "DRAFT";
  const err = (e: unknown) => { const c = (e as { code?: string })?.code ?? ""; toast.error(t(`leadOnboarding.err.${c}`, { defaultValue: t("leadOnboarding.failed") })); };
  const run = (a: Parameters<typeof act.mutate>[0], ok: string) => act.mutate(a, { onSuccess: () => toast.success(t(ok)), onError: err });
  const canDecide = isSuper && d.status === "SUBMITTED" && d.submittedBy !== user?.sub;
  return (
    <div data-testid="lead-onboarding-detail">
      <Link to={`/leads/${d.leadId}`} className="mb-3 inline-flex items-center gap-1 text-sm font-medium underline-offset-2 hover:underline" data-testid="lob-back-to-lead"><ArrowLeft className="h-4 w-4 rtl-flip" aria-hidden="true" />{t("leadOnboarding.backToLead", { ref: d.contactRef })}</Link>
      <PageHeader title={<span dir="auto">{d.legalName}</span>} hint={<span className="font-mono">{d.contactRef}</span>} badge={<>
        <StatusChip tone={TONE[d.status] ?? "neutral"} data-testid="lob-status">{t(`leadOnboarding.st.${d.status}`)}</StatusChip>{d.isTest ? <StatusChip tone="neutral" dot={false}>{t("siteLeads.testBadge")}</StatusChip> : null}
      </>} />
      <p className="mb-4 max-w-3xl rounded-xl border bg-card p-3 text-sm" data-testid="lob-explainer">{t("leadOnboarding.explainer")}</p>
      <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
        <section aria-labelledby="lob-fields" className="rounded-xl border bg-card p-4 shadow-card"><h2 id="lob-fields" className="mb-2 text-sm font-bold">{t("leadOnboarding.fields")}</h2>
          <dl>
            <Row label={t("leadOnboarding.type")}>{labelOf(cfg?.providerTypes, d.providerType, lang)}</Row><Row label={t("leadOnboarding.mode")}>{t(`siteLeads.modeLong${d.mode}`)}</Row>
            <Row label={t("leadOnboarding.modules")}>{d.modules.map((m) => labelOf(cfg?.modules, m, lang)).join(", ")}</Row><Row label={t("leadOnboarding.market")}>{labelOf(cfg?.markets, d.market, lang)}</Row>
            <Row label={t("leadOnboarding.leadStatus")}>{d.leadStatus}</Row>
            <Row label={t("leadOnboarding.created")}>{formatDateTime(d.createdAt, lang)} · {d.createdBy === "system:lead-won" ? t("leadOnboarding.bySystem") : d.createdBy}</Row>
            <Row label={t("leadOnboarding.submitted")}>{d.submittedAt ? `${formatDateTime(d.submittedAt, lang)} · ${d.submittedBy}` : ""}</Row>
            <Row label={t("leadOnboarding.decided")}>{d.decidedAt ? `${formatDateTime(d.decidedAt, lang)} · ${d.decidedBy}` : ""}</Row><Row label={t("leadOnboarding.decisionNote")}>{d.decisionNote}</Row>
          </dl>
          <label className="mt-3 block text-xs font-medium">{t("leadOnboarding.kind")}
            <select className={`${selectCls} mt-1`} value={d.kind ?? ""} disabled={!draft || act.isPending} onChange={(e) => run({ kind: "patch", body: { kind: e.target.value || null } }, "leadOnboarding.saved")} data-testid="lob-kind">
              <option value="">{t("leadOnboarding.kindMissing")}</option>{d.kinds.map((k) => <option key={k} value={k}>{t(`leadOnboarding.kinds.${k}`)}</option>)}
            </select></label>
          {d.kind === null && draft ? <p className="mt-1 text-xs text-muted-foreground">{t("leadOnboarding.kindHint")}</p> : null}
          <label className="mt-3 block text-xs font-medium">{t("leadOnboarding.assignee")}
            <select className={`${selectCls} mt-1`} value={d.assigneeSub ?? ""} disabled={!draft || act.isPending} onChange={(e) => run({ kind: "patch", body: { assigneeSub: e.target.value || null } }, "leadOnboarding.saved")} data-testid="lob-assignee">
              <option value="">{t("leadOnboarding.unassigned")}</option>{owners.data?.map((o) => <option key={o.sub} value={o.sub}>{o.name}</option>)}
            </select></label>
          <label className="mt-3 block text-xs font-medium">{t("leadOnboarding.note")}
            <textarea className="mt-1 min-h-20 w-full rounded-md border border-input bg-background p-2 text-sm" maxLength={300} disabled={!draft} value={note ?? d.note ?? ""} onChange={(e) => setNote(e.target.value)} data-testid="lob-note" />
          </label>
          {draft ? <Button className="mt-2" size="sm" variant="outline" disabled={act.isPending || note === null || note === (d.note ?? "")} onClick={() => run({ kind: "patch", body: { note } }, "leadOnboarding.saved")} data-testid="lob-save-note">{t("leadOnboarding.saveNote")}</Button> : null}
        </section>
        <aside className="space-y-4" aria-label={t("leadOnboarding.actions")}>
          <section className="rounded-xl border bg-card p-4 shadow-card" aria-labelledby="lob-actions"><h2 id="lob-actions" className="mb-2 text-sm font-bold">{t("leadOnboarding.actions")}</h2>
            {d.blockers.length && (draft || d.status === "SUBMITTED") ? <ul className="mb-2 list-disc ps-5 text-xs text-muted-foreground" data-testid="lob-blockers">{d.blockers.map((b) => <li key={b}>{t(`leadOnboarding.blocker.${b}`)}</li>)}</ul> : null}
            <div className="flex flex-wrap gap-2">
              {draft ? <Button size="sm" disabled={act.isPending || d.blockers.length > 0} onClick={() => run({ kind: "submit" }, "leadOnboarding.submittedOk")} data-testid="lob-submit">{t("leadOnboarding.submit")}</Button> : null}
              {d.status === "SUBMITTED" && isSuper ? <Button size="sm" disabled={act.isPending || !canDecide} onClick={() => run({ kind: "approve" }, "leadOnboarding.approvedOk")} data-testid="lob-approve">{t("leadOnboarding.approve")}</Button> : null}
              {d.status === "SUBMITTED" && isSuper ? <Button size="sm" variant="outline" disabled={!canDecide} onClick={() => setDecide(decide === "reject" ? null : "reject")} aria-expanded={decide === "reject"} data-testid="lob-reject">{t("leadOnboarding.reject")}</Button> : null}
              {draft || d.status === "SUBMITTED" ? <Button size="sm" variant="outline" onClick={() => setDecide(decide === "cancel" ? null : "cancel")} aria-expanded={decide === "cancel"} data-testid="lob-cancel">{t("leadOnboarding.cancel")}</Button> : null}
              {d.status === "REJECTED" || d.status === "CANCELLED" ? <Button size="sm" variant="outline" disabled={act.isPending} onClick={() => run({ kind: "reopen" }, "leadOnboarding.reopenedOk")} data-testid="lob-reopen">{t("leadOnboarding.reopen")}</Button> : null}
            </div>
            {d.status === "SUBMITTED" && isSuper && !canDecide ? <p className="mt-2 text-xs text-muted-foreground" data-testid="lob-two-person">{t("leadOnboarding.twoPerson")}</p> : null}
            {d.status === "SUBMITTED" && !isSuper ? <p className="mt-2 text-xs text-muted-foreground">{t("leadOnboarding.awaitingSuper")}</p> : null}
            {decide ? (
              <form className="mt-3 space-y-2" onSubmit={(e) => { e.preventDefault(); if (decide === "reject" && !reason.trim()) return; run(decide === "reject" ? { kind: "reject", reason } : { kind: "cancel", reason }, decide === "reject" ? "leadOnboarding.rejectedOk" : "leadOnboarding.cancelledOk"); setDecide(null); setReason(""); }}>
                <label className="block text-xs font-medium">{t("leadOnboarding.reason")}<Input className="mt-1 h-9" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} data-testid="lob-reason" /></label>
                <Button type="submit" size="sm" variant="destructive" disabled={act.isPending || (decide === "reject" && !reason.trim())} data-testid="lob-decide-confirm">{t("leadOnboarding.confirm")}</Button>
              </form>
            ) : null}
            {d.status === "APPROVED" ? (
              <div className="mt-3 border-t pt-3" data-testid="lob-approved">
                <p className="text-xs text-muted-foreground">{d.mode === "CONNECTED" ? t("leadOnboarding.approvedConnected") : t("leadOnboarding.approvedStandalone")}</p>
                {d.mode === "CONNECTED" ? <Button className="mt-2" size="sm" asChild><Link to={onboardingUrlForLead(d.leadId)} data-testid="lob-open-partner-onboarding">{t("leadOnboarding.openPartnerOnboarding")}</Link></Button> : null}
              </div>
            ) : null}
          </section>
        </aside>
      </div>
    </div>
  );
}
