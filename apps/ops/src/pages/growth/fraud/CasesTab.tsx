import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCases, useCaseAction, useCaseSummary, type CaseBand, type CaseRow } from "@/api/growthFraud";
import { useGrowthAccess } from "@/api/growth";
import { StatCard, StatusChip } from "@/components/kit";
import { DataTable } from "@/components/DataTable";
import { CardSkeleton, ErrorState } from "@/components/states";
import { Section, selectCls } from "@/components/growth/GrowthPage";
import { formatDateTime } from "@/lib/format";
import { fmtN } from "@/lib/growthFormat";

const KINDS = ["REFERRAL", "REWARD", "TOUCH", "WIDGET", "PROVIDER"] as const; const BANDS: CaseBand[] = ["HIGH", "MEDIUM", "LOW"]; const STATUSES = ["OPEN", "IN_REVIEW", "APPEALED", "CONFIRMED", "DISMISSED", "CLOSED"] as const;
export const bandTone = (b: string) => (b === "HIGH" ? "danger" : b === "MEDIUM" ? "warning" : "neutral") as "danger" | "warning" | "neutral";

/** The review queue: open cases by risk with the review deadline, filters, and bulk dismissal of low and medium cases with one written reason. */
export default function CasesTab({ onOpen }: { onOpen: (id: string) => void }) {
  const { t, i18n } = useTranslation();
  const [f, setF] = useState<{ status: string; kind: string; band: string; breached: boolean }>({ status: "", kind: "", band: "", breached: false });
  const q = useCases({ status: f.status || undefined, kind: f.kind || undefined, band: f.band || undefined, breached: f.breached }); const sum = useCaseSummary(); const act = useCaseAction();
  const can = useGrowthAccess().data?.capabilities.reviewFraud;
  const [sel, setSel] = useState<Set<string>>(new Set()); const [reason, setReason] = useState("");
  const rows = q.data?.rows ?? []; const bulkable = rows.filter((r) => r.band !== "HIGH" && ["OPEN", "IN_REVIEW"].includes(r.status));
  const total = (sum.data?.open ?? []).reduce((s, x) => s + x.count, 0); const shadowHigh = (sum.data?.open ?? []).filter((x) => x.mode === "SHADOW" && x.band === "HIGH").reduce((s, x) => s + x.count, 0);
  const toggle = (id: string) => setSel((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const bulk = () => act.mutate({ op: "bulk-dismiss", ids: [...sel], reason }, { onSuccess: (r) => { toast.success(t("growth.fraudV2.bulkDone", { dismissed: String(r.dismissed ?? 0), skipped: String(r.skipped ?? 0) })); setSel(new Set()); setReason(""); }, onError: (e) => toast.error((e as Error).message) });
  const sel2 = (label: string, value: string, set: (v: string) => void, opts: readonly string[], prefix: string) => (
    <label className="flex items-center gap-2 text-sm"><span className="text-muted-foreground">{label}</span><select className={selectCls} value={value} onChange={(e) => set(e.target.value)}><option value="">{t("growth.fraudV2.all")}</option>{opts.map((o) => <option key={o} value={o}>{t(`growth.fraudV2.${prefix}_${o}`)}</option>)}</select></label>
  );
  return (
    <div className="space-y-5" data-testid="fraud-cases-tab">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3" data-testid="fraud-case-stats">
        <StatCard label={t("growth.fraudV2.open")} value={fmtN(total)} />
        <StatCard label={t("growth.fraudV2.breached")} value={fmtN(sum.data?.breached ?? 0)} tone={(sum.data?.breached ?? 0) > 0 ? "warn" : "ok"} />
        <StatCard label={t("growth.fraudV2.wouldHold")} value={fmtN(shadowHigh)} />
      </div>
      <Section title={t("growth.fraudV2.caseCaption")} id="fr-cases" hint={t("growth.fraudV2.providerNote")}>
        <div className="mb-3 flex flex-wrap items-center gap-3" role="group" aria-label={t("growth.fraudV2.filters")}>
          {sel2(t("growth.fraudV2.status"), f.status, (v) => setF({ ...f, status: v }), STATUSES, "status")}
          {sel2(t("growth.fraudV2.kind"), f.kind, (v) => setF({ ...f, kind: v }), KINDS, "kind")}
          {sel2(t("growth.fraudV2.band"), f.band, (v) => setF({ ...f, band: v }), BANDS, "band")}
          <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className="h-5 w-5" checked={f.breached} onChange={(e) => setF({ ...f, breached: e.target.checked })} />{t("growth.fraudV2.onlyBreached")}</label>
        </div>
        {q.isLoading ? <CardSkeleton rows={3} /> : q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : (
          <DataTable caption={t("growth.fraudV2.caseCaption")} rows={rows} rowKey={(r: CaseRow) => r.id} empty={t("growth.fraudV2.empty")} columns={[
            ...(can ? [{ key: "sel", header: t("growth.fraudV2.selectAll"), cell: (r: CaseRow) => (bulkable.some((b) => b.id === r.id) ? <input type="checkbox" className="h-5 w-5" aria-label={t("growth.fraudV2.select", { id: r.id.slice(-6) })} checked={sel.has(r.id)} onChange={() => toggle(r.id)} /> : null) }] : []),
            { key: "id", header: t("growth.fraudV2.id"), cell: (r: CaseRow) => <button type="button" className="min-h-11 text-start font-mono text-xs underline" onClick={() => onOpen(r.id)} data-testid={`case-open-${r.id}`}>{r.id.slice(-8)}</button> },
            { key: "k", header: t("growth.fraudV2.kind"), cell: (r: CaseRow) => t(`growth.fraudV2.kind_${r.kind}`) },
            { key: "b", header: t("growth.fraudV2.band"), cell: (r: CaseRow) => <StatusChip tone={bandTone(r.band)}>{t(`growth.fraudV2.band_${r.band}`)}</StatusChip> },
            { key: "s", header: t("growth.fraudV2.score"), cell: (r: CaseRow) => <span className="kx-label-num">{fmtN(r.score)}</span> },
            { key: "m", header: t("growth.fraudV2.mode"), cell: (r: CaseRow) => <StatusChip tone={r.mode === "ENFORCE" ? "info" : "neutral"}>{t(`growth.fraudV2.mode_${r.mode}`)}</StatusChip> },
            { key: "st", header: t("growth.fraudV2.status"), cell: (r: CaseRow) => t(`growth.fraudV2.status_${r.status}`) },
            { key: "d", header: t("growth.fraudV2.sla"), cell: (r: CaseRow) => <span className={`text-xs ${r.breached ? "font-semibold text-destructive" : ""}`}>{r.slaDueAt ? formatDateTime(r.slaDueAt, i18n.language) : "—"}</span> },
            { key: "a", header: t("growth.fraudV2.assignee"), cell: (r: CaseRow) => r.assignedTo ?? "—" },
          ]} />
        )}
        {can && bulkable.length > 0 && (
          <div className="mt-3 flex flex-wrap items-end gap-3" data-testid="fraud-bulk">
            <label className="min-w-64 flex-1 text-sm"><span className="mb-1 block text-muted-foreground">{t("growth.fraudV2.bulkReason")}</span><Input value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} data-testid="fraud-bulk-reason" /></label>
            <Button disabled={sel.size === 0 || reason.trim().length < 10 || act.isPending} onClick={bulk} data-testid="fraud-bulk-go">{t("growth.fraudV2.bulkDismiss")} ({sel.size})</Button>
            <p className="basis-full text-xs text-muted-foreground">{t("growth.fraudV2.bulkHint")}</p>
          </div>
        )}
      </Section>
    </div>
  );
}
