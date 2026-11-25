import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useCampaigns } from "@/api/campaigns";
import { useGrowthAccess } from "@/api/growth";
import { useCreateProgram, useCreateProgramCode, useLinkCampaign, useProgramAction, useProgramCodes, usePrograms, useRevokeProgramCode, type CreatedCode, type Program, type ProgramKind } from "@/api/loyalty";
import { Section } from "@/components/growth/GrowthPage";
import { FormField, StatusChip } from "@/components/kit";
import { DataTable } from "@/components/DataTable";
import { CardSkeleton, ErrorState } from "@/components/states";
import { fmtN } from "@/lib/growthFormat";
import { formatDateTime, formatMinor } from "@/lib/format";

const inputCls = "h-11 w-full rounded-xl border border-input bg-card px-3 text-sm";
const KINDS: ProgramKind[] = ["CODE_DISCOUNT", "CO_PROMO", "CARD_OFFER"];
const tone = (s: Program["status"]) => (s === "ACTIVE" ? "success" : s === "PAUSED" ? "warning" : s === "ENDED" ? "neutral" : "info") as "success" | "warning" | "neutral" | "info";
const toMinor = (v: string) => { const n = Number(v.replace(",", ".")); return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null; };

function Usage({ p }: { p: Program }) {
  const { t, i18n } = useTranslation(); const used = p.usedMinor ?? 0; const pct = p.budgetMinor > 0 ? Math.min(100, Math.round((used / p.budgetMinor) * 100)) : 0;
  return (
    <div className="min-w-40" data-testid={`ptn-usage-${p.key}`}>
      <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={t("growth.loyalty.ptn.budgetUsed")}><div className="h-full bg-primary" style={{ width: `${pct}%` }} /></div>
      <p className="mt-1 text-xs tabular-nums text-muted-foreground">{formatMinor(used, i18n.language)} / {formatMinor(p.budgetMinor, i18n.language)} · {fmtN(p.redemptions ?? 0)}</p>
    </div>
  );
}

function CodesPanel({ p, canManage }: { p: Program; canManage: boolean }) {
  const { t } = useTranslation(); const q = useProgramCodes(p.id); const create = useCreateProgramCode(); const revoke = useRevokeProgramCode();
  const [label, setLabel] = useState(""); const [max, setMax] = useState("100"); const [fresh, setFresh] = useState<CreatedCode | null>(null);
  const submit = (e: FormEvent) => { e.preventDefault(); create.mutate({ id: p.id, body: { label: label.trim(), maxRedemptions: Number(max) } }, { onSuccess: (c) => { setFresh(c); setLabel(""); }, onError: (er) => toast.error((er as Error).message) }); };
  const copy = async () => { try { await navigator.clipboard.writeText(fresh!.code); toast.success(t("growth.loyalty.ptn.copied")); } catch { toast.error(t("growth.loyalty.ptn.copyFailed")); } };
  return (
    <Section title={t("growth.loyalty.ptn.codesFor", { key: p.key })} id="ptn-codes" hint={t("growth.loyalty.ptn.codesHint")}>
      {fresh && (
        <div role="status" className="mb-4 space-y-2 rounded-xl border border-success/40 bg-success/5 p-4" data-testid="ptn-fresh-code">
          <p className="text-sm font-semibold">{t("growth.loyalty.ptn.freshTitle")}</p>
          <code dir="ltr" className="block text-2xl font-bold tracking-widest" data-testid="ptn-code-value">{fresh.code}</code>
          <p className="text-sm text-muted-foreground">{t("growth.loyalty.ptn.freshHint")}</p>
          <div className="flex gap-2"><button type="button" className="h-11 rounded-xl border px-4 text-sm font-semibold" onClick={() => void copy()}>{t("growth.loyalty.ptn.copy")}</button><button type="button" className="h-11 rounded-xl border px-4 text-sm" onClick={() => setFresh(null)} data-testid="ptn-code-dismiss">{t("growth.loyalty.ptn.dismiss")}</button></div>
        </div>)}
      {canManage && p.status !== "ENDED" && (
        <form onSubmit={submit} className="mb-4 grid gap-3 sm:grid-cols-4" data-testid="ptn-code-form">
          <FormField label={t("growth.loyalty.ptn.codeLabel")} required className="sm:col-span-2"><input className={inputCls} value={label} maxLength={80} onChange={(e) => setLabel(e.target.value)} data-testid="ptn-code-label" /></FormField>
          <FormField label={t("growth.loyalty.ptn.codeMax")}><input className={inputCls} inputMode="numeric" value={max} onChange={(e) => setMax(e.target.value.replace(/\D/g, ""))} data-testid="ptn-code-max" /></FormField>
          <div className="self-end"><button type="submit" className="h-11 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-50" disabled={label.trim().length < 1 || !(Number(max) >= 1) || create.isPending} data-testid="ptn-code-create">{t("growth.loyalty.ptn.createCode")}</button></div>
        </form>)}
      {q.isLoading ? <CardSkeleton rows={2} /> : q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : (
        <DataTable caption={t("growth.loyalty.ptn.codes")} rows={q.data?.items ?? []} rowKey={(r) => r.id} empty={t("growth.loyalty.ptn.noCodes")} columns={[
          { key: "l", header: t("growth.loyalty.ptn.codeLabel"), cell: (r) => r.label },
          { key: "u", header: t("growth.loyalty.ptn.codeUsed"), cell: (r) => <span className="tabular-nums">{fmtN(r.redeemedCount)} / {fmtN(r.maxRedemptions)}</span> },
          { key: "s", header: t("growth.loyalty.ptn.colStatus"), cell: (r) => <StatusChip tone={r.status === "ACTIVE" ? "success" : "neutral"}>{t(`growth.loyalty.ptn.codeStatus.${r.status}`)}</StatusChip> },
          { key: "a", header: "", cell: (r) => canManage && r.status === "ACTIVE" ? <button type="button" className="h-11 rounded-xl border px-3 text-sm" onClick={() => revoke.mutate({ id: p.id, codeId: r.id })} data-testid={`ptn-revoke-${r.id}`}>{t("growth.loyalty.ptn.revoke")}</button> : null },
        ]} />)}
    </Section>
  );
}

/** Partnership programs (GRW-P4-D): time-boxed, budgeted partner offers. A program runs only on a campaign with the PARTNER channel that went through the campaign approval; a second person activates it; the budget is a database limit. */
export default function PartnershipsPage() {
  const { t, i18n } = useTranslation(); const q = usePrograms(); const camps = useCampaigns({}); const create = useCreateProgram(); const link = useLinkCampaign(); const act = useProgramAction();
  const canManage = !!useGrowthAccess().data?.capabilities.manageLoyalty; const [sel, setSel] = useState<string | null>(null);
  const [f, setF] = useState({ key: "", partnerRef: "", kind: "CODE_DISCOUNT" as ProgramKind, nameAr: "", nameEn: "", budget: "", value: "", starts: "", ends: "" });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const budget = f.budget === "" ? 0 : toMinor(f.budget); const value = f.value === "" ? 0 : toMinor(f.value);
  const ok = /^[a-z0-9][a-z0-9-]{1,47}$/.test(f.key) && f.partnerRef.trim().length > 0 && budget !== null && value !== null;
  const submit = (e: FormEvent) => {
    e.preventDefault(); if (!ok) return;
    create.mutate({ key: f.key, partnerRef: f.partnerRef.trim(), kind: f.kind, nameAr: f.nameAr, nameEn: f.nameEn, budgetMinor: budget!, perRedemptionMinor: value!, startsAt: f.starts ? new Date(f.starts).toISOString() : null, endsAt: f.ends ? new Date(f.ends).toISOString() : null },
      { onSuccess: () => { setF({ key: "", partnerRef: "", kind: "CODE_DISCOUNT", nameAr: "", nameEn: "", budget: "", value: "", starts: "", ends: "" }); toast.success(t("growth.loyalty.ptn.created")); }, onError: (er) => toast.error((er as Error).message) });
  };
  const partnerCampaigns = (camps.data ?? []).filter((c) => c.channels.includes("PARTNER"));
  const run = (id: string, op: "activate" | "pause" | "end") => act.mutate({ id, op }, { onSuccess: () => toast.success(t(`growth.loyalty.ptn.done.${op}`)), onError: (er) => toast.error((er as Error).message) });
  const selected = (q.data?.items ?? []).find((p) => p.id === sel) ?? null;
  return (
    <div className="space-y-5">
      <Section title={t("growth.loyalty.ptn.title")} id="ptn-list" hint={t("growth.loyalty.ptn.hint")}>
        <p className="mb-3 rounded-xl border bg-card p-3 text-sm" data-testid="ptn-rules-note">{t("growth.loyalty.ptn.rulesNote")}</p>
        <p className="mb-3 rounded-xl border border-warning/40 bg-warning/5 p-3 text-sm" data-needs-human="true" data-testid="ptn-needs-human">{t("growth.loyalty.ptn.needsHuman")}</p>
        {canManage && (
          <form onSubmit={submit} className="mb-5 grid gap-3 sm:grid-cols-3" data-testid="ptn-form">
            <FormField label={t("growth.loyalty.ptn.key")} hint={t("growth.loyalty.ptn.keyHint")} required><input className={inputCls} dir="ltr" value={f.key} maxLength={48} onChange={set("key")} data-testid="ptn-key" /></FormField>
            <FormField label={t("growth.loyalty.ptn.partnerRef")} hint={t("growth.loyalty.ptn.partnerRefHint")} required><input className={inputCls} value={f.partnerRef} maxLength={80} onChange={set("partnerRef")} data-testid="ptn-partner" /></FormField>
            <FormField label={t("growth.loyalty.ptn.kindLabel")}><select className={inputCls} value={f.kind} onChange={set("kind")} data-testid="ptn-kind">{KINDS.map((k) => <option key={k} value={k}>{t(`growth.loyalty.ptn.kind.${k}`)}</option>)}</select></FormField>
            <FormField label={t("growth.loyalty.ptn.nameAr")}><input className={inputCls} dir="rtl" value={f.nameAr} maxLength={120} onChange={set("nameAr")} data-testid="ptn-name-ar" /></FormField>
            <FormField label={t("growth.loyalty.ptn.nameEn")}><input className={inputCls} dir="ltr" value={f.nameEn} maxLength={120} onChange={set("nameEn")} data-testid="ptn-name-en" /></FormField>
            <span className="hidden sm:block" />
            <FormField label={t("growth.loyalty.ptn.budget")} hint={t("growth.loyalty.ptn.budgetHint")}><input className={inputCls} inputMode="decimal" value={f.budget} onChange={set("budget")} data-testid="ptn-budget" /></FormField>
            <FormField label={t("growth.loyalty.ptn.value")} hint={t("growth.loyalty.ptn.valueHint")}><input className={inputCls} inputMode="decimal" value={f.value} onChange={set("value")} data-testid="ptn-value" /></FormField>
            <span className="hidden sm:block" />
            <FormField label={t("growth.loyalty.ptn.starts")}><input type="date" className={inputCls} value={f.starts} onChange={set("starts")} data-testid="ptn-starts" /></FormField>
            <FormField label={t("growth.loyalty.ptn.ends")}><input type="date" className={inputCls} value={f.ends} onChange={set("ends")} data-testid="ptn-ends" /></FormField>
            <div className="self-end"><button type="submit" className="h-11 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-50" disabled={!ok || create.isPending} data-testid="ptn-create">{t("growth.loyalty.ptn.draft")}</button></div>
          </form>)}
        {q.isLoading ? <CardSkeleton rows={3} /> : q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : (
          <DataTable caption={t("growth.loyalty.ptn.title")} rows={q.data?.items ?? []} rowKey={(r) => r.id} empty={t("growth.loyalty.ptn.none")} columns={[
            { key: "k", header: t("growth.loyalty.ptn.key"), cell: (r) => <button type="button" className="font-semibold text-primary hover:underline" onClick={() => setSel(r.id)} data-testid={`ptn-open-${r.key}`}>{(i18n.language.startsWith("ar") ? r.nameAr : r.nameEn) || r.key}</button> },
            { key: "t", header: t("growth.loyalty.ptn.kindLabel"), cell: (r) => t(`growth.loyalty.ptn.kind.${r.kind}`) },
            { key: "s", header: t("growth.loyalty.ptn.colStatus"), cell: (r) => <StatusChip tone={tone(r.status)}>{t(`growth.loyalty.ptn.status.${r.status}`)}</StatusChip> },
            { key: "b", header: t("growth.loyalty.ptn.budgetUsed"), cell: (r) => <Usage p={r} /> },
            { key: "w", header: t("growth.loyalty.ptn.window"), cell: (r) => <span className="text-xs">{r.startsAt ? formatDateTime(r.startsAt, i18n.language) : "-"} → {r.endsAt ? formatDateTime(r.endsAt, i18n.language) : "-"}</span> },
            { key: "c", header: t("growth.loyalty.ptn.campaign"), cell: (r) => r.campaign ? <span className="text-xs" data-testid={`ptn-campaign-${r.key}`}>{r.campaign.name} · <StatusChip tone={r.campaign.status === "ACTIVE" ? "success" : "warning"} dot={false}>{r.campaign.status}</StatusChip></span> : canManage && r.status === "DRAFT" ? (
              <select className={`${inputCls} min-w-44`} aria-label={t("growth.loyalty.ptn.linkCampaign", { key: r.key })} defaultValue="" onChange={(e) => e.target.value && link.mutate({ id: r.id, campaignId: e.target.value }, { onSuccess: () => toast.success(t("growth.loyalty.ptn.linked")), onError: (er) => toast.error((er as Error).message) })} data-testid={`ptn-link-${r.key}`}>
                <option value="">{t("growth.loyalty.ptn.pickCampaign")}</option>{partnerCampaigns.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.status})</option>)}</select>) : <span className="text-xs text-muted-foreground">-</span> },
            { key: "a", header: "", cell: (r) => canManage ? (
              <span className="flex flex-wrap gap-2">
                {(r.status === "DRAFT" || r.status === "PAUSED") && <button type="button" className="h-11 rounded-xl bg-primary px-3 text-sm font-semibold text-primary-foreground" onClick={() => run(r.id, "activate")} data-testid={`ptn-activate-${r.key}`}>{t("growth.loyalty.ptn.activate")}</button>}
                {r.status === "ACTIVE" && <button type="button" className="h-11 rounded-xl border px-3 text-sm" onClick={() => run(r.id, "pause")} data-testid={`ptn-pause-${r.key}`}>{t("growth.loyalty.ptn.pause")}</button>}
                {r.status !== "ENDED" && <button type="button" className="h-11 rounded-xl border px-3 text-sm" onClick={() => run(r.id, "end")} data-testid={`ptn-end-${r.key}`}>{t("growth.loyalty.ptn.end")}</button>}
              </span>) : null },
          ]} />)}
      </Section>
      {selected && (
        <>
          <Section title={t("growth.loyalty.ptn.detail", { key: selected.key })} id="ptn-detail">
            <dl className="grid gap-3 sm:grid-cols-3">
              <div><dt className="text-xs text-muted-foreground">{t("growth.loyalty.ptn.value")}</dt><dd className="text-lg font-semibold tabular-nums">{formatMinor(selected.perRedemptionMinor, i18n.language)}</dd></div>
              <div><dt className="text-xs text-muted-foreground">{t("growth.loyalty.ptn.budget")}</dt><dd className="text-lg font-semibold tabular-nums">{formatMinor(selected.budgetMinor, i18n.language)}</dd></div>
              <div><dt className="text-xs text-muted-foreground">{t("growth.loyalty.ptn.legal")}</dt><dd className="text-sm" data-testid="ptn-legal" data-needs-human={selected.legalTextIsPlaceholder ? "true" : undefined}>{selected.legalTextIsPlaceholder ? t("growth.loyalty.ptn.legalPlaceholder") : selected.legalTextRef}</dd></div>
            </dl>
          </Section>
          <CodesPanel p={selected} canManage={canManage} />
        </>)}
    </div>
  );
}
