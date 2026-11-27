import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Download, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { downloadLeadsCsv, labelOf, SITE_LEAD_STATUSES, statusLabel, useSiteLeadOwners, useSiteLeads, useSiteLeadSettings, useSiteLeadSummary, type LeadFilters } from "@/api/siteLeads";
import { CardSkeleton, ErrorState } from "@/components/states";
import { DataTable } from "@/components/DataTable";
import { PageHeader, StatCard, StatusChip, type Tone } from "@/components/kit";
import { formatDateTime } from "@/lib/format";

/** Tones with enough contrast on the card background (the info and warning soft pairs of the console do not reach 4.5:1 for small text). */
export const LEAD_TONE: Record<string, Tone> = { NEW: "brand", CONTACTED: "neutral", QUALIFIED: "brand", ONBOARDING: "neutral", WON: "success", LOST: "neutral" };
const selectCls = "h-10 w-full rounded-md border border-input bg-background px-2 text-sm";
const PARAMS = ["status", "type", "mode", "market", "from", "to", "q", "owner", "test", "duplicates"] as const;

/** Join requests from the Kiorly site: the inbox. Same page in the Kiorex super admin and in the Kiorly admin (roles ops_admin and super_admin). */
export default function SiteLeadsPage() {
  const { t, i18n } = useTranslation(); const lang = i18n.language;
  const [sp, setSp] = useSearchParams();
  const f: LeadFilters = useMemo(() => ({ ...Object.fromEntries(PARAMS.map((k) => [k, sp.get(k) ?? ""])), page: Number(sp.get("page") ?? 1) || 1, pageSize: 25 }), [sp]);
  const set = (k: string, v: string) => setSp((prev) => { const n = new URLSearchParams(prev); if (v) n.set(k, v); else n.delete(k); if (k !== "page") n.delete("page"); return n; }, { replace: true }); // from the latest address, never from a stale render
  const q = useSiteLeads(f); const sum = useSiteLeadSummary(); const settings = useSiteLeadSettings(); const owners = useSiteLeadOwners();
  const cfg = settings.data?.config; const [busy, setBusy] = useState(false);
  const pages = q.data ? Math.max(1, Math.ceil(q.data.total / q.data.pageSize)) : 1;
  const exportCsv = async () => { setBusy(true); try { await downloadLeadsCsv(f); toast.success(t("siteLeads.exported")); } catch { toast.error(t("siteLeads.exportFailed")); } finally { setBusy(false); } };
  const multiMarket = (cfg?.markets.filter((m) => m.active).length ?? 0) > 1;
  return (
    <div>
      <PageHeader title={t("siteLeads.title")} hint={t("siteLeads.hint")} actions={<>
        <Button variant="outline" size="sm" onClick={() => void exportCsv()} disabled={busy} data-testid="leads-export"><Download aria-hidden="true" />{t("siteLeads.export")}</Button>
        <Button variant="outline" size="sm" asChild><Link to="/leads/settings" data-testid="leads-settings-link"><Settings2 aria-hidden="true" />{t("siteLeads.settings")}</Link></Button>
      </>} />
      <section aria-label={t("siteLeads.summary")} className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8" data-testid="leads-summary">
        {SITE_LEAD_STATUSES.map((s) => (
          <button key={s} type="button" onClick={() => set("status", f.status === s ? "" : s)} aria-pressed={f.status === s} className="rounded-xl text-start focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring" data-testid={`leads-count-${s}`}>
            <StatCard label={statusLabel(cfg, s, lang)} value={sum.data?.byStatus[s] ?? "-"} className={f.status === s ? "ring-2 ring-primary" : ""} />
          </button>
        ))}
        <StatCard label={t("siteLeads.newWeek")} value={sum.data?.newLastSevenDays ?? "-"} />
        <StatCard label={t("siteLeads.unassigned")} value={sum.data?.unassignedOpen ?? "-"} tone={sum.data && sum.data.unassignedOpen > 0 ? "warn" : undefined} />
      </section>
      <form className="mb-4 grid gap-3 rounded-xl border bg-card p-3 shadow-card sm:grid-cols-2 lg:grid-cols-4" role="search" aria-label={t("siteLeads.filters")} onSubmit={(e) => e.preventDefault()}>
        <label className="text-xs font-medium sm:col-span-2">{t("siteLeads.search")}<Input className="mt-1 h-10" value={f.q ?? ""} onChange={(e) => set("q", e.target.value)} placeholder={t("siteLeads.searchHint")} data-testid="leads-filter-q" /></label>
        <label className="text-xs font-medium">{t("siteLeads.status")}<select className={`${selectCls} mt-1`} value={f.status ?? ""} onChange={(e) => set("status", e.target.value)} data-testid="leads-filter-status"><option value="">{t("siteLeads.all")}</option>{SITE_LEAD_STATUSES.map((s) => <option key={s} value={s}>{statusLabel(cfg, s, lang)}</option>)}</select></label>
        <label className="text-xs font-medium">{t("siteLeads.type")}<select className={`${selectCls} mt-1`} value={f.type ?? ""} onChange={(e) => set("type", e.target.value)} data-testid="leads-filter-type"><option value="">{t("siteLeads.all")}</option>{cfg?.providerTypes.map((p) => <option key={p.key} value={p.key}>{labelOf(cfg.providerTypes, p.key, lang)}</option>)}</select></label>
        <label className="text-xs font-medium">{t("siteLeads.mode")}<select className={`${selectCls} mt-1`} value={f.mode ?? ""} onChange={(e) => set("mode", e.target.value)} data-testid="leads-filter-mode"><option value="">{t("siteLeads.all")}</option><option value="STANDALONE">{t("siteLeads.modeSTANDALONE")}</option><option value="CONNECTED">{t("siteLeads.modeCONNECTED")}</option></select></label>
        {multiMarket ? <label className="text-xs font-medium">{t("siteLeads.market")}<select className={`${selectCls} mt-1`} value={f.market ?? ""} onChange={(e) => set("market", e.target.value)} data-testid="leads-filter-market"><option value="">{t("siteLeads.all")}</option>{cfg?.markets.map((m) => <option key={m.key} value={m.key}>{labelOf(cfg.markets, m.key, lang)}</option>)}</select></label> : null}
        <label className="text-xs font-medium">{t("siteLeads.from")}<Input type="date" className="mt-1 h-10" value={f.from ?? ""} onChange={(e) => set("from", e.target.value)} data-testid="leads-filter-from" /></label>
        <label className="text-xs font-medium">{t("siteLeads.to")}<Input type="date" className="mt-1 h-10" value={f.to ?? ""} onChange={(e) => set("to", e.target.value)} data-testid="leads-filter-to" /></label>
        <label className="text-xs font-medium">{t("siteLeads.owner")}<select className={`${selectCls} mt-1`} value={f.owner ?? ""} onChange={(e) => set("owner", e.target.value)} data-testid="leads-filter-owner"><option value="">{t("siteLeads.all")}</option><option value="none">{t("siteLeads.unassignedOption")}</option>{owners.data?.map((o) => <option key={o.sub} value={o.sub}>{o.name}</option>)}</select></label>
        <label className="text-xs font-medium">{t("siteLeads.testData")}<select className={`${selectCls} mt-1`} value={f.test ?? ""} onChange={(e) => set("test", e.target.value)} data-testid="leads-filter-test"><option value="">{t("siteLeads.testInclude")}</option><option value="exclude">{t("siteLeads.testExclude")}</option><option value="only">{t("siteLeads.testOnly")}</option></select></label>
        <label className="flex min-h-10 items-end gap-2 pb-2 text-xs font-medium"><input type="checkbox" className="h-4 w-4" checked={f.duplicates === "only"} onChange={(e) => set("duplicates", e.target.checked ? "only" : "")} data-testid="leads-filter-dup" />{t("siteLeads.duplicatesOnly")}</label>
        <div className="flex items-end"><Button type="button" variant="ghost" size="sm" onClick={() => setSp(new URLSearchParams(), { replace: true })}>{t("siteLeads.reset")}</Button></div>
      </form>
      {q.isLoading ? <CardSkeleton rows={4} /> : q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : (
        <>
          <DataTable caption={t("siteLeads.title")} rows={q.data!.items} rowKey={(r) => r.id} empty={t("siteLeads.none")} columns={[
            { key: "ref", header: t("siteLeads.ref"), cell: (r) => <Link className="font-mono text-xs font-bold underline-offset-2 hover:underline" to={`/leads/${r.id}`} data-testid={`lead-link-${r.ref}`}>{r.ref}</Link> },
            { key: "org", header: t("siteLeads.org"), cell: (r) => <div className="min-w-40"><span className="font-semibold" dir="auto">{r.legalName}</span>{r.tradeName ? <span className="block text-xs text-muted-foreground" dir="auto">{r.tradeName}</span> : null}<span className="block text-xs text-muted-foreground" dir="auto">{[r.city, r.governorate].filter(Boolean).join(", ")}</span></div> },
            { key: "type", header: t("siteLeads.type"), cell: (r) => labelOf(cfg?.providerTypes, r.providerType, lang) },
            { key: "mode", header: t("siteLeads.mode"), cell: (r) => <StatusChip tone={r.mode === "CONNECTED" ? "brand" : "neutral"} dot={false}>{t(`siteLeads.mode${r.mode}`)}</StatusChip> },
            { key: "c", header: t("siteLeads.contact"), cell: (r) => <div><span dir="auto">{r.contactName}</span><span className="block text-xs text-muted-foreground" dir="ltr">{r.phoneMasked}</span></div> },
            { key: "s", header: t("siteLeads.status"), cell: (r) => <StatusChip tone={LEAD_TONE[r.status] ?? "neutral"} data-testid={`lead-chip-${r.ref}`}>{statusLabel(cfg, r.status, lang)}</StatusChip> },
            { key: "o", header: t("siteLeads.owner"), cell: (r) => r.ownerName ?? <span className="text-xs text-muted-foreground">{t("siteLeads.unassignedOption")}</span> },
            { key: "d", header: t("siteLeads.created"), cell: (r) => <span className="whitespace-nowrap text-xs">{formatDateTime(r.createdAt, lang)}</span> },
            { key: "f", header: t("siteLeads.flags"), cell: (r) => <span className="flex flex-wrap gap-1">{r.isTest ? <StatusChip tone="neutral" dot={false}>{t("siteLeads.testBadge")}</StatusChip> : null}{r.duplicateOfId ? <StatusChip tone="brand" dot={false}>{t("siteLeads.dupBadge")}</StatusChip> : null}</span> },
          ]} />
          <nav className="mt-3 flex items-center justify-between gap-3 text-sm" aria-label={t("siteLeads.pagination")}>
            <span className="text-muted-foreground" data-testid="leads-total">{t("siteLeads.total", { count: q.data!.total })}</span>
            <span className="flex items-center gap-2">
              <Button variant="outline" size="sm" disabled={(f.page ?? 1) <= 1} onClick={() => set("page", String((f.page ?? 1) - 1))}>{t("siteLeads.prev")}</Button>
              <span className="kx-label-num">{f.page} / {pages}</span>
              <Button variant="outline" size="sm" disabled={(f.page ?? 1) >= pages} onClick={() => set("page", String((f.page ?? 1) + 1))}>{t("siteLeads.next")}</Button>
            </span>
          </nav>
        </>
      )}
    </div>
  );
}
