import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { LEAD_NEXT, useCreateLead, useLeads, useLeadTransition, type Lead, type LeadStatus } from "@/api/corporate";
import { useGrowthAccess } from "@/api/growth";
import { Section } from "@/components/growth/GrowthPage";
import { FormField, StatusChip } from "@/components/kit";
import { DataTable } from "@/components/DataTable";
import { CardSkeleton, ErrorState } from "@/components/states";
import { fmtN } from "@/lib/growthFormat";
import { formatDateTime } from "@/lib/format";

const inputCls = "h-11 w-full rounded-xl border border-input bg-card px-3 text-sm";
const STATUSES: LeadStatus[] = ["NEW", "CONTACTED", "QUALIFIED", "PROPOSAL", "WON", "LOST", "DUPLICATE"];
const tone = (s: LeadStatus) => (s === "WON" ? "success" : s === "LOST" || s === "DUPLICATE" ? "neutral" : s === "NEW" ? "info" : "warning") as "success" | "neutral" | "info" | "warning";

/** The enterprise lead pipeline (GRW-P4-C): companies referred by providers through the Clinic, inbound requests and outbound prospects. Company data only: a contact is an opaque reference, never a person. */
export default function B2BLeadsPage() {
  const { t, i18n } = useTranslation(); const [filter, setFilter] = useState<string>(""); const q = useLeads(filter || undefined); const move = useLeadTransition(); const create = useCreateLead();
  const canManage = !!useGrowthAccess().data?.capabilities.manageCorporate; const [name, setName] = useState(""); const [size, setSize] = useState("UNKNOWN");
  const submit = (e: FormEvent) => { e.preventDefault(); create.mutate({ companyName: name.trim(), source: "OUTBOUND", sizeBucket: size }, { onSuccess: () => { setName(""); toast.success(t("growth.corporate.leadAdded")); }, onError: (er) => toast.error((er as Error).message) }); };
  return (
    <Section title={t("growth.corporate.leads")} id="corp-leads" hint={t("growth.corporate.leadsHint")}>
      <p className="mb-3 rounded-xl border bg-card p-3 text-sm" data-testid="corp-leads-note">{t("growth.corporate.leadsNote")}</p>
      <ul className="mb-3 flex flex-wrap gap-2" aria-label={t("growth.corporate.pipeline")} data-testid="corp-pipeline">{STATUSES.map((s) => <li key={s}><StatusChip tone={tone(s)} dot={false}>{t(`growth.corporate.leadStatus.${s}`)}: {fmtN(q.data?.pipeline[s] ?? 0)}</StatusChip></li>)}</ul>
      <div role="group" aria-label={t("growth.corporate.filter")} className="mb-3 flex flex-wrap gap-2">
        {["", ...STATUSES].map((s) => <button key={s || "ALL"} type="button" aria-pressed={filter === s} className={`h-11 rounded-xl border px-4 text-sm font-semibold ${filter === s ? "border-primary bg-primary text-primary-foreground" : "bg-card"}`} onClick={() => setFilter(s)} data-testid={`corp-lead-filter-${s || "ALL"}`}>{s ? t(`growth.corporate.leadStatus.${s}`) : t("growth.corporate.all")}</button>)}
      </div>
      {canManage && (
        <form onSubmit={submit} className="mb-4 flex flex-wrap items-end gap-3" data-testid="corp-lead-form">
          <FormField label={t("growth.corporate.companyName")} hint={t("growth.corporate.companyHint")} className="min-w-64 flex-1"><input className={inputCls} value={name} maxLength={120} onChange={(e) => setName(e.target.value)} data-testid="corp-lead-name" /></FormField>
          <FormField label={t("growth.corporate.size")}><select className={inputCls} value={size} onChange={(e) => setSize(e.target.value)}>{["UNKNOWN", "1_49", "50_199", "200_999", "1000_PLUS"].map((s) => <option key={s} value={s}>{t(`growth.corporate.sizes.${s}`)}</option>)}</select></FormField>
          <button type="submit" className="h-11 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-50" disabled={name.trim().length < 2 || create.isPending} data-testid="corp-lead-add">{t("growth.corporate.addLead")}</button>
        </form>)}
      {q.isLoading ? <CardSkeleton rows={3} /> : q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : (
        <DataTable caption={t("growth.corporate.leads")} rows={q.data?.items ?? []} rowKey={(r: Lead) => r.id} empty={t("growth.corporate.noLeads")} columns={[
          { key: "c", header: t("growth.corporate.colCompany"), cell: (r: Lead) => <span><span className="font-semibold">{r.companyName}</span><span className="block text-xs text-muted-foreground">{t(`growth.corporate.sizes.${r.sizeBucket}`)}{r.contactRef ? ` · ${r.contactRef}` : ""}</span></span> },
          { key: "o", header: t("growth.corporate.colSource"), cell: (r: Lead) => <span>{t(`growth.corporate.source.${r.source}`)}{r.referrerOrgRef ? <code className="ms-1 text-xs" dir="ltr">{r.referrerOrgRef}</code> : null}</span> },
          { key: "s", header: t("growth.corporate.colStatus"), cell: (r: Lead) => <StatusChip tone={tone(r.status)}>{t(`growth.corporate.leadStatus.${r.status}`)}</StatusChip> },
          { key: "u", header: t("growth.corporate.colUpdated"), cell: (r: Lead) => <span className="text-xs">{formatDateTime(r.updatedAt, i18n.language)}</span> },
          { key: "m", header: t("growth.corporate.colMove"), cell: (r: Lead) => canManage && LEAD_NEXT[r.status].length ? <label className="block"><span className="sr-only">{t("growth.corporate.moveTo", { name: r.companyName })}</span><select className="h-11 rounded-xl border border-input bg-card px-2 text-sm" value="" onChange={(e) => e.target.value && move.mutate({ id: r.id, status: e.target.value as LeadStatus }, { onError: (er) => toast.error((er as Error).message) })} data-testid={`corp-move-${r.id}`}><option value="">{t("growth.corporate.moveHint")}</option>{LEAD_NEXT[r.status].map((n) => <option key={n} value={n}>{t(`growth.corporate.leadStatus.${n}`)}</option>)}</select></label> : null },
        ]} />)}
    </Section>
  );
}
