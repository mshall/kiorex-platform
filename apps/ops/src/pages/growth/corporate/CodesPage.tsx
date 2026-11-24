import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useCodes, useCreateCode, useRevokeCode, type CreatedCode } from "@/api/corporate";
import { Section } from "@/components/growth/GrowthPage";
import { FormField, StatusChip } from "@/components/kit";
import { DataTable } from "@/components/DataTable";
import { CardSkeleton, ErrorState } from "@/components/states";
import { fmtN } from "@/lib/growthFormat";

const inputCls = "h-11 w-full rounded-xl border border-input bg-card px-3 text-sm";

/** Company codes of one account. The plain code appears ONCE, right after it is created (copy it then); afterwards only the label, the counters and the state remain. */
export default function CodesPage({ accountId, canManage }: { accountId: string; canManage: boolean }) {
  const { t } = useTranslation(); const q = useCodes(accountId); const create = useCreateCode(); const revoke = useRevokeCode();
  const [label, setLabel] = useState(""); const [max, setMax] = useState("50"); const [kind, setKind] = useState<"OPEN" | "LIST">("OPEN"); const [fresh, setFresh] = useState<CreatedCode | null>(null);
  const submit = (e: FormEvent) => { e.preventDefault(); create.mutate({ id: accountId, body: { label: label.trim(), kind, maxRedemptions: Number(max) } }, { onSuccess: (c) => { setFresh(c); setLabel(""); }, onError: (er) => toast.error((er as Error).message) }); };
  const copy = async () => { try { await navigator.clipboard.writeText(fresh!.code); toast.success(t("growth.corporate.copied")); } catch { toast.error(t("growth.corporate.copyFailed")); } };
  return (
    <Section title={t("growth.corporate.codes")} id="corp-codes" hint={t("growth.corporate.codesHint")}>
      {fresh && (
        <div role="status" className="mb-4 space-y-2 rounded-xl border border-success/40 bg-success/5 p-4" data-testid="corp-fresh-code">
          <p className="text-sm font-semibold">{t("growth.corporate.freshTitle")}</p>
          <code dir="ltr" className="block text-2xl font-bold tracking-widest" data-testid="corp-code-value">{fresh.code}</code>
          <p className="text-sm text-muted-foreground">{t("growth.corporate.freshHint")}</p>
          <div className="flex gap-2"><button type="button" className="h-11 rounded-xl border px-4 text-sm font-semibold" onClick={() => void copy()}>{t("growth.corporate.copy")}</button><button type="button" className="h-11 rounded-xl border px-4 text-sm" onClick={() => setFresh(null)} data-testid="corp-code-dismiss">{t("growth.corporate.dismiss")}</button></div>
        </div>)}
      {canManage && (
        <form onSubmit={submit} className="mb-4 grid gap-3 sm:grid-cols-4" data-testid="corp-code-form">
          <FormField label={t("growth.corporate.codeLabel")} required className="sm:col-span-2"><input className={inputCls} value={label} maxLength={80} onChange={(e) => setLabel(e.target.value)} data-testid="corp-code-label" /></FormField>
          <FormField label={t("growth.corporate.codeMax")}><input className={inputCls} inputMode="numeric" value={max} onChange={(e) => setMax(e.target.value.replace(/\D/g, ""))} data-testid="corp-code-max" /></FormField>
          <FormField label={t("growth.corporate.codeKind")}><select className={inputCls} value={kind} onChange={(e) => setKind(e.target.value as "OPEN" | "LIST")}><option value="OPEN">{t("growth.corporate.kind.OPEN")}</option><option value="LIST">{t("growth.corporate.kind.LIST")}</option></select></FormField>
          <div className="sm:col-span-4"><button type="submit" className="h-11 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-50" disabled={label.trim().length < 1 || !(Number(max) >= 1) || create.isPending} data-testid="corp-code-create">{t("growth.corporate.createCode")}</button></div>
        </form>)}
      {q.isLoading ? <CardSkeleton rows={2} /> : q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : (
        <DataTable caption={t("growth.corporate.codes")} rows={q.data?.items ?? []} rowKey={(r) => r.id} empty={t("growth.corporate.noCodes")} columns={[
          { key: "l", header: t("growth.corporate.codeLabel"), cell: (r) => r.label },
          { key: "k", header: t("growth.corporate.codeKind"), cell: (r) => t(`growth.corporate.kind.${r.kind}`) },
          { key: "u", header: t("growth.corporate.codeUsed"), cell: (r) => <span className="tabular-nums">{fmtN(r.redeemedCount)} / {fmtN(r.maxRedemptions)}</span> },
          { key: "s", header: t("growth.corporate.colStatus"), cell: (r) => <StatusChip tone={r.status === "ACTIVE" ? "success" : "neutral"}>{t(`growth.corporate.codeStatus.${r.status}`)}</StatusChip> },
          { key: "a", header: "", cell: (r) => canManage && r.status === "ACTIVE" ? <button type="button" className="h-11 rounded-xl border px-3 text-sm" onClick={() => revoke.mutate({ id: accountId, codeId: r.id })} data-testid={`corp-revoke-${r.id}`}>{t("growth.corporate.revoke")}</button> : null },
        ]} />)}
    </Section>
  );
}
