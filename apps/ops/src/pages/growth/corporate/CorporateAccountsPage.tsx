import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useAccounts, useCreateAccount, type Account } from "@/api/corporate";
import { useGrowthAccess } from "@/api/growth";
import { Section } from "@/components/growth/GrowthPage";
import { FormField, StatusChip } from "@/components/kit";
import { DataTable } from "@/components/DataTable";
import { CardSkeleton, ErrorState } from "@/components/states";
import { formatDateTime } from "@/lib/format";

export const accountTone = (s: Account["status"]) => (s === "ACTIVE" ? "success" : s === "PAUSED" ? "warning" : s === "ENDED" ? "neutral" : "info") as "success" | "warning" | "neutral" | "info";
const inputCls = "h-11 w-full rounded-xl border border-input bg-card px-3 text-sm";

/** The corporate accounts of GRW-P4-C: company data and commercial terms only. A new account is a LEAD; it can be activated only by a second person once the terms are complete. */
export default function CorporateAccountsPage() {
  const { t, i18n } = useTranslation(); const q = useAccounts(); const create = useCreateAccount(); const access = useGrowthAccess().data; const canManage = !!access?.capabilities.manageCorporate;
  const [name, setName] = useState("");
  const submit = (e: FormEvent) => { e.preventDefault(); if (name.trim().length < 2) return; create.mutate({ displayName: name.trim() }, { onSuccess: () => { setName(""); toast.success(t("growth.corporate.created")); }, onError: (er) => toast.error((er as Error).message) }); };
  return (
    <Section title={t("growth.corporate.accounts")} id="corp-accounts" hint={t("growth.corporate.accountsHint")}>
      <p className="mb-3 rounded-xl border bg-card p-3 text-sm" data-testid="corp-ledger-note">{t("growth.corporate.ledgerNote")}</p>
      {canManage && (
        <form onSubmit={submit} className="mb-4 flex flex-wrap items-end gap-3" data-testid="corp-create-form">
          <FormField label={t("growth.corporate.companyName")} hint={t("growth.corporate.companyHint")} className="min-w-64 flex-1"><input className={inputCls} value={name} maxLength={120} onChange={(e) => setName(e.target.value)} data-testid="corp-name" /></FormField>
          <button type="submit" className="h-11 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-50" disabled={name.trim().length < 2 || create.isPending} data-testid="corp-create">{t("growth.corporate.openAccount")}</button>
        </form>)}
      {q.isLoading ? <CardSkeleton rows={3} /> : q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : (
        <DataTable caption={t("growth.corporate.accounts")} rows={q.data?.items ?? []} rowKey={(r) => r.id} empty={t("growth.corporate.noAccounts")} columns={[
          { key: "n", header: t("growth.corporate.colName"), cell: (r) => <Link className="font-semibold text-primary hover:underline" to={`/growth/corporate/accounts/${encodeURIComponent(r.id)}`}>{r.displayName}</Link> },
          { key: "s", header: t("growth.corporate.colStatus"), cell: (r) => <StatusChip tone={accountTone(r.status)}>{t(`growth.corporate.status.${r.status}`)}</StatusChip> },
          { key: "f", header: t("growth.corporate.colFunding"), cell: (r) => t(`growth.corporate.funding.${r.fundingMode}`) },
          { key: "t", header: t("growth.corporate.colTerms"), cell: (r) => <StatusChip tone={r.terms.complete ? "success" : "warning"} dot={false}>{r.terms.complete ? t("growth.corporate.termsComplete") : t("growth.corporate.termsMissing")}</StatusChip> },
          { key: "e", header: t("growth.corporate.colEnds"), cell: (r) => <span className="text-xs">{r.endsAt ? formatDateTime(r.endsAt, i18n.language) : "-"}</span> },
        ]} />)}
    </Section>
  );
}
