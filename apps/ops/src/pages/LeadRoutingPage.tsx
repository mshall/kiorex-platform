import { useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLeadRouting, useSaveLeadRouting, type RoutingConfig, type RoutingView } from "@/api/siteLeads";
import { useAuth } from "@/auth/AuthProvider";
import { CardSkeleton, ErrorState } from "@/components/states";
import { DataTable } from "@/components/DataTable";
import { PageHeader, StatusChip } from "@/components/kit";
import { formatDateTime } from "@/lib/format";

const WEEK = [0, 1, 2, 3, 4, 5, 6] as const;

/** Owner rotation and reminders of the join requests. Everyone with console access reads; a super admin saves (versioned, audited, no second approver). */
export default function LeadRoutingPage() {
  const q = useLeadRouting();
  if (q.isLoading) return <CardSkeleton rows={4} />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  return <Editor key={q.data.version} view={q.data} reload={() => void q.refetch()} />;
}

function Editor({ view, reload }: { view: RoutingView; reload: () => void }) {
  const { t, i18n } = useTranslation(); const lang = i18n.language; const { user } = useAuth();
  const save = useSaveLeadRouting(); const isSuper = !!user?.roles.includes("super_admin");
  const [c, setC] = useState<RoutingConfig>(() => structuredClone(view.config));
  const num = (v: string) => (v === "" ? NaN : Number(v));
  const bad = !Number.isFinite(c.reminders.remindAfterWorkingHours) || !Number.isFinite(c.reminders.escalateAfterWorkingHours) || c.reminders.escalateAfterWorkingHours < c.reminders.remindAfterWorkingHours || c.workWeek.days.length === 0 || c.workWeek.endHour <= c.workWeek.startHour || !Number.isFinite(c.roundRobin.activeWithinDays);
  const toggleSub = (sub: string) => setC({ ...c, roundRobin: { ...c.roundRobin, eligibleSubs: c.roundRobin.eligibleSubs.includes(sub) ? c.roundRobin.eligibleSubs.filter((x) => x !== sub) : [...c.roundRobin.eligibleSubs, sub] } });
  const toggleDay = (d: number) => setC({ ...c, workWeek: { ...c.workWeek, days: c.workWeek.days.includes(d) ? c.workWeek.days.filter((x) => x !== d) : [...c.workWeek.days, d].sort() } });
  const submit = () => save.mutate({ version: view.version, config: c }, {
    onSuccess: () => toast.success(t("siteLeads.routing.saved")),
    onError: (e) => { const code = (e as { code?: string })?.code; if (code === "ROUTING_CONFIG_STALE") { toast.error(t("siteLeads.routing.stale")); reload(); } else toast.error(t(code === "INVALID_ROUTING_CONFIG" ? "siteLeads.routing.invalid" : "siteLeads.routing.failed")); },
  });
  const ro = !isSuper;
  const last = view.candidates.find((x) => x.sub === view.state.lastSub)?.name ?? view.state.lastSub ?? t("siteLeads.routing.nobody");
  return (
    <div data-testid="lead-routing">
      <Link to="/leads" className="mb-3 inline-flex items-center gap-1 text-sm font-medium underline-offset-2 hover:underline"><ArrowLeft className="h-4 w-4 rtl-flip" aria-hidden="true" />{t("siteLeads.routing.back")}</Link>
      <PageHeader title={t("siteLeads.routing.title")} hint={t("siteLeads.routing.hint")} />
      {ro ? <p className="mb-4 max-w-3xl rounded-xl border bg-card p-3 text-sm" data-testid="routing-readonly">{t("siteLeads.routing.readOnly")}</p> : null}
      <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); if (!bad && !ro) submit(); }}>
        <section className="rounded-xl border bg-card p-4 shadow-card" aria-labelledby="rt-rr"><h2 id="rt-rr" className="text-base font-bold">{t("siteLeads.routing.rrTitle")}</h2>
          <label className="mt-3 flex min-h-9 items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4" checked={c.roundRobin.enabled} disabled={ro} onChange={(e) => setC({ ...c, roundRobin: { ...c.roundRobin, enabled: e.target.checked } })} data-testid="rr-enabled" />{t("siteLeads.routing.rrEnabled")}</label>
          <label className="mt-3 block text-xs font-medium">{t("siteLeads.routing.rrActive")}
            <Input className="mt-1 h-9 w-28" type="number" min={1} max={365} value={Number.isFinite(c.roundRobin.activeWithinDays) ? c.roundRobin.activeWithinDays : ""} readOnly={ro} onChange={(e) => setC({ ...c, roundRobin: { ...c.roundRobin, activeWithinDays: num(e.target.value) } })} data-testid="rr-active-days" /></label>
          <h3 className="mt-4 text-sm font-bold">{t("siteLeads.routing.rrList")}</h3><p className="mb-2 text-xs text-muted-foreground">{t("siteLeads.routing.rrListHint")}</p>
          <DataTable caption={t("siteLeads.routing.rrList")} rows={view.candidates} rowKey={(r) => r.sub} empty={t("siteLeads.routing.noCandidates")} columns={[
            { key: "p", header: t("siteLeads.routing.rrList"), cell: (r) => <label className="flex min-h-9 items-center gap-2"><input type="checkbox" className="h-4 w-4" checked={c.roundRobin.eligibleSubs.includes(r.sub)} disabled={ro} onChange={() => toggleSub(r.sub)} aria-label={r.name} data-testid={`rr-pick-${r.sub}`} /></label> },
            { key: "n", header: t("siteLeads.routing.candidate"), cell: (r) => <span dir="auto">{r.name}</span> },
            { key: "r", header: t("siteLeads.routing.roles"), cell: (r) => <span className="text-xs">{r.roles.join(", ")}</span> },
            { key: "l", header: t("siteLeads.routing.lastSeen"), cell: (r) => <span className="whitespace-nowrap text-xs">{formatDateTime(r.lastSeenAt, lang)}</span> },
            { key: "e", header: t("siteLeads.routing.eligibleNow"), cell: (r) => r.eligibleNow ? <StatusChip tone="success" data-testid={`rr-now-${r.sub}`}>{t("siteLeads.routing.takesPart")}</StatusChip> : <StatusChip tone="neutral" dot={false} data-testid={`rr-now-${r.sub}`}>{t(r.active ? "siteLeads.routing.notListed" : "siteLeads.routing.inactive")}</StatusChip> },
          ]} />
          <p className="mt-2 text-xs text-muted-foreground" data-testid="rr-state">{t("siteLeads.routing.state", { count: view.state.assignedCount, last })}</p>
        </section>
        <section className="rounded-xl border bg-card p-4 shadow-card" aria-labelledby="rt-rem"><h2 id="rt-rem" className="text-base font-bold">{t("siteLeads.routing.remTitle")}</h2>
          <label className="mt-3 flex min-h-9 items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4" checked={c.reminders.enabled} disabled={ro} onChange={(e) => setC({ ...c, reminders: { ...c.reminders, enabled: e.target.checked } })} data-testid="rem-enabled" />{t("siteLeads.routing.remEnabled")}</label>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="block text-xs font-medium">{t("siteLeads.routing.remAfter")}<Input className="mt-1 h-9" type="number" min={0.25} step={0.25} value={Number.isFinite(c.reminders.remindAfterWorkingHours) ? c.reminders.remindAfterWorkingHours : ""} readOnly={ro} onChange={(e) => setC({ ...c, reminders: { ...c.reminders, remindAfterWorkingHours: num(e.target.value) } })} data-testid="rem-after" /></label>
            <label className="block text-xs font-medium">{t("siteLeads.routing.escAfter")}<Input className="mt-1 h-9" type="number" min={0.25} step={0.25} value={Number.isFinite(c.reminders.escalateAfterWorkingHours) ? c.reminders.escalateAfterWorkingHours : ""} readOnly={ro} onChange={(e) => setC({ ...c, reminders: { ...c.reminders, escalateAfterWorkingHours: num(e.target.value) } })} data-testid="rem-escalate" /></label>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{t("siteLeads.routing.remHint")}</p>
        </section>
        <section className="rounded-xl border bg-card p-4 shadow-card" aria-labelledby="rt-week"><h2 id="rt-week" className="text-base font-bold">{t("siteLeads.routing.weekTitle")}</h2>
          <fieldset className="mt-3"><legend className="text-xs font-medium">{t("siteLeads.routing.days")}</legend>
            <div className="mt-1 flex flex-wrap gap-3">{WEEK.map((d) => <label key={d} className="flex min-h-9 items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4" checked={c.workWeek.days.includes(d)} disabled={ro} onChange={() => toggleDay(d)} data-testid={`week-${d}`} />{t(`siteLeads.routing.d${d}`)}</label>)}</div>
          </fieldset>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="block text-xs font-medium">{t("siteLeads.routing.from")}<Input className="mt-1 h-9" type="number" min={0} max={23} value={c.workWeek.startHour} readOnly={ro} onChange={(e) => setC({ ...c, workWeek: { ...c.workWeek, startHour: num(e.target.value) } })} data-testid="week-from" /></label>
            <label className="block text-xs font-medium">{t("siteLeads.routing.to")}<Input className="mt-1 h-9" type="number" min={1} max={24} value={c.workWeek.endHour} readOnly={ro} onChange={(e) => setC({ ...c, workWeek: { ...c.workWeek, endHour: num(e.target.value) } })} data-testid="week-to" /></label>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{t("siteLeads.routing.zone", { zone: view.workTimeZone })}</p>
        </section>
        <div className="flex flex-wrap items-center gap-3">
          {ro ? null : <Button type="submit" disabled={save.isPending || bad} data-testid="routing-save">{t("siteLeads.routing.save")}</Button>}
          <span className="text-xs text-muted-foreground" data-testid="routing-version">{view.isDefault ? t("siteLeads.routing.defaults") : t("siteLeads.routing.version", { v: view.version, by: view.updatedBy ?? "" })}</span>
        </div>
      </form>
    </div>
  );
}
