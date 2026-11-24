import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LEAD_STATUSES, useLeadAction, useLeadAlertChange, useLeadAlertSettings, useLeadFunnel, useMarkLeadsSeen, usePartnerLeads, type AlertChannel, type LeadRow } from "@/api/partnerLeads";
import { useAuth } from "@/auth/AuthProvider";
import { CardSkeleton, ErrorState } from "@/components/states";
import { DataTable } from "@/components/DataTable";
import { PageHeader, StatusChip, type Tone } from "@/components/kit";
import { formatDateTime } from "@/lib/format";

const TONE: Record<string, Tone> = { NEW: "brand", CONTACTED: "info", STARTED: "info", SUBMITTED: "warning", LIVE: "success", CLOSED: "neutral" };
const selectCls = "h-10 rounded-md border border-input bg-background px-2 text-sm";

function FunnelPanel() {
  const { t } = useTranslation(); const [days, setDays] = useState(30); const q = useLeadFunnel(days);
  return (
    <section className="mb-6 rounded-xl border bg-card p-4 shadow-card" aria-labelledby="funnel-h" data-testid="leads-funnel">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div><h2 id="funnel-h" className="text-base font-bold">{t("leads.funnel.title")}</h2><p className="text-xs text-muted-foreground">{t("leads.funnel.hint")}</p></div>
        <label className="text-xs font-medium">{t("leads.funnel.window")}
          <select className={`${selectCls} ms-2`} value={days} onChange={(e) => setDays(Number(e.target.value))} data-testid="funnel-days">{[7, 30, 90, 365].map((d) => <option key={d} value={d}>{t("leads.funnel.lastDays", { count: d })}</option>)}</select>
        </label>
      </div>
      {q.isLoading ? <CardSkeleton rows={1} /> : q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : (
        <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {q.data!.stages.map((s) => (
            <li key={s.stage} className="rounded-lg border bg-background p-3" data-testid={`funnel-${s.stage}`}>
              <p className="text-xs font-semibold text-muted-foreground">{t(`leads.funnel.${s.stage}`)}</p>
              <p className="kx-label-num text-2xl font-bold" data-testid={`funnel-count-${s.stage}`}>{s.count}</p>
              <p className="text-xs text-muted-foreground">{s.fromPrevious == null ? t("leads.funnel.talk", { count: q.data!.talkToUs }) : t("leads.funnel.conv", { prev: `${s.fromPrevious}%`, all: s.fromInterested == null ? "-" : `${s.fromInterested}%` })}</p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

const CHANNELS: AlertChannel[] = ["EMAIL", "WHATSAPP", "PUSH"];
/** Who on the Kiorex team is told about a new lead, and through which channels (super admin: global; everyone: their own row). */
function AlertsPanel() {
  const { t, i18n } = useTranslation(); const { user } = useAuth(); const q = useLeadAlertSettings(); const change = useLeadAlertChange();
  const isSuper = !!user?.roles.includes("super_admin");
  const done = { onSuccess: () => toast.success(t("leads.alerts.saved")), onError: () => toast.error(t("leads.alerts.failed")) };
  const toggle = (list: AlertChannel[], c: AlertChannel) => (list.includes(c) ? list.filter((x) => x !== c) : [...list, c]);
  return (
    <details className="mb-6 rounded-xl border bg-card p-4 shadow-card" data-testid="leads-alerts">
      <summary className="cursor-pointer text-base font-bold">{t("leads.alerts.open")}</summary>
      <p className="mt-2 text-xs text-muted-foreground">{t("leads.alerts.hint")}</p>
      {q.isLoading ? <CardSkeleton rows={1} /> : q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : (
        <div className="mt-3 space-y-4">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <label className="flex min-h-9 items-center gap-2 text-sm font-medium"><input type="checkbox" className="h-4 w-4" checked={q.data!.enabled} disabled={!isSuper || change.isPending} onChange={(e) => change.mutate({ config: { enabled: e.target.checked } }, done)} data-testid="alerts-enabled" />{t("leads.alerts.enabled")}</label>
            <fieldset className="flex flex-wrap items-center gap-3" disabled={!isSuper || change.isPending}><legend className="sr-only">{t("leads.alerts.channels")}</legend>
              <span className="text-sm font-medium" aria-hidden="true">{t("leads.alerts.channels")}</span>
              {CHANNELS.map((c) => <label key={c} className="flex min-h-9 items-center gap-1.5 text-sm"><input type="checkbox" className="h-4 w-4" checked={q.data!.channels.includes(c)} onChange={() => change.mutate({ config: { channels: toggle(q.data!.channels, c) } }, done)} data-testid={`alerts-channel-${c}`} />{t(`leads.alerts.ch.${c}`)}</label>)}
            </fieldset>
          </div>
          {!isSuper ? <p className="text-xs text-muted-foreground">{t("leads.alerts.superOnly")}</p> : null}
          <h3 className="text-sm font-bold">{t("leads.alerts.team")}</h3>
          {q.data!.recipients.length === 0 ? <p className="text-sm text-muted-foreground">{t("leads.alerts.noRecipients")}</p> : (
            <ul className="divide-y rounded-lg border">
              {q.data!.recipients.map((r) => {
                const mine = r.sub === user?.sub; const can = mine || isSuper;
                return (
                  <li key={r.sub} className="flex flex-wrap items-center gap-x-4 gap-y-2 p-3 text-sm" data-testid={`alerts-recipient-${r.sub}`}>
                    <div className="min-w-40 flex-1"><span className="font-semibold" dir="auto">{r.name ?? r.sub}</span>{mine ? <span className="ms-2 text-xs text-muted-foreground">({t("leads.alerts.me")})</span> : null}<br /><span className="text-xs text-muted-foreground">{r.roles.join(", ")} · {t("leads.alerts.lastSeen", { when: formatDateTime(r.lastSeenAt, i18n.language) })}</span>{!r.hasPhone && !r.hasEmail ? <><br /><span className="text-xs text-muted-foreground">{t("leads.alerts.noContact")}</span></> : null}</div>
                    <label className="flex min-h-9 items-center gap-2"><input type="checkbox" className="h-4 w-4" checked={r.leadAlerts} disabled={!can || change.isPending} onChange={(e) => change.mutate({ sub: r.sub, recipient: { leadAlerts: e.target.checked } }, done)} data-testid={`alerts-optin-${r.sub}`} />{t("leads.alerts.optIn")}</label>
                    <div className="flex flex-wrap gap-3">{CHANNELS.map((c) => <label key={c} className="flex min-h-9 items-center gap-1.5"><input type="checkbox" className="h-4 w-4" checked={r.channels.includes(c)} disabled={!can || !r.leadAlerts || change.isPending} onChange={() => change.mutate({ sub: r.sub, recipient: { channels: toggle(r.channels, c) } }, done)} aria-label={`${r.name ?? r.sub}: ${t(`leads.alerts.ch.${c}`)}`} />{t(`leads.alerts.ch.${c}`)}</label>)}</div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </details>
  );
}

function LeadDetail({ lead }: { lead: LeadRow }) {
  const { t, i18n } = useTranslation(); const act = useLeadAction(); const [assignee, setAssignee] = useState(lead.assignee ?? ""); const [note, setNote] = useState("");
  const done = (m: string) => ({ onSuccess: () => toast.success(t(m)), onError: () => toast.error(t("leads.failed")) });
  return (
    <div className="grid gap-4 rounded-xl border bg-card p-4 shadow-card md:grid-cols-2" data-testid={`lead-detail-${lead.id}`}>
      <div className="space-y-1 text-sm">
      <dl className="space-y-1">
        <div><dt className="inline font-semibold">{t("leads.contact")}: </dt><dd className="inline" dir="auto">{lead.contactName}{lead.contactRole ? ` (${lead.contactRole})` : ""}</dd></div>
        {lead.phone ? <div><dt className="inline font-semibold">{t("leads.phone")}: </dt><dd className="inline" dir="ltr">{lead.phone}</dd></div> : null}
        {lead.email ? <div><dt className="inline font-semibold">{t("leads.email")}: </dt><dd className="inline" dir="ltr">{lead.email}</dd></div> : null}
        {lead.preferredTime ? <div><dt className="inline font-semibold">{t("leads.when")}: </dt><dd className="inline">{t(`leads.time.${lead.preferredTime}`)}</dd></div> : null}
        {lead.note ? <div><dt className="inline font-semibold">{t("leads.leadNote")}: </dt><dd className="inline" dir="auto">{lead.note}</dd></div> : null}
        <div><dt className="inline font-semibold">{t("leads.consent")}: </dt><dd className="inline">{formatDateTime(lead.consentAt, i18n.language)}</dd></div>
      </dl>
      {lead.connectionId ? <div><Link className="font-semibold underline" to={`/partner-onboarding/${lead.connectionId}`} data-testid={`lead-conn-${lead.id}`}>{t("leads.openRequest")}</Link></div> : <p className="text-muted-foreground">{t("leads.noRequest")}</p>}
      </div>
      <div className="space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs font-medium">{t("leads.status")}
            <select className={`${selectCls} ms-2`} value={lead.status} disabled={act.isPending} data-testid={`lead-status-${lead.id}`} onChange={(e) => act.mutate({ id: lead.id, patch: { status: e.target.value } }, done("leads.saved"))}>{LEAD_STATUSES.map((s) => <option key={s} value={s}>{t(`leads.st.${s}`)}</option>)}</select>
          </label>
          <label className="text-xs font-medium">{t("leads.assignee")}
            <span className="ms-2 inline-flex gap-2"><Input className="h-10 w-40" value={assignee} maxLength={80} onChange={(e) => setAssignee(e.target.value)} data-testid={`lead-assignee-${lead.id}`} /><Button size="sm" variant="outline" disabled={act.isPending} onClick={() => act.mutate({ id: lead.id, patch: { assignee } }, done("leads.saved"))}>{t("leads.assign")}</Button></span>
          </label>
        </div>
        <ul className="space-y-1 text-sm" aria-label={t("leads.notes")}>{lead.notes.map((n, i) => <li key={i} className="rounded border bg-background p-2"><span className="text-xs text-muted-foreground">{n.by} · {formatDateTime(n.at, i18n.language)}</span><br /><span dir="auto">{n.text}</span></li>)}</ul>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (note.trim()) act.mutate({ id: lead.id, note }, { ...done("leads.noteAdded"), onSuccess: () => { setNote(""); toast.success(t("leads.noteAdded")); } }); }}>
          <Input aria-label={t("leads.addNote")} placeholder={t("leads.addNote")} value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} data-testid={`lead-note-${lead.id}`} />
          <Button type="submit" size="sm" disabled={act.isPending || !note.trim()}>{t("leads.add")}</Button>
        </form>
      </div>
    </div>
  );
}

/** Partner leads: organisations that pressed "Talk to us" in a Kiorly product, plus the privacy-safe onboarding funnel. */
export default function PartnerLeadsPage() {
  const { t, i18n } = useTranslation(); const [status, setStatus] = useState(""); const [kind, setKind] = useState(""); const [open, setOpen] = useState<string | null>(null);
  const q = usePartnerLeads(status, kind); const seen = useMarkLeadsSeen();
  useEffect(() => { seen.mutate(); // opening the page clears the nav badge
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const sel = q.data?.find((r) => r.id === open);
  return (
    <div>
      <PageHeader title={t("leads.title")} hint={t("leads.hint")} />
      <FunnelPanel />
      <AlertsPanel />
      <div className="mb-3 flex flex-wrap gap-3">
        <label className="text-xs font-medium">{t("leads.status")}<select className={`${selectCls} ms-2`} value={status} onChange={(e) => setStatus(e.target.value)} data-testid="leads-filter-status"><option value="">{t("leads.all")}</option>{LEAD_STATUSES.map((s) => <option key={s} value={s}>{t(`leads.st.${s}`)}</option>)}</select></label>
        <label className="text-xs font-medium">{t("leads.product")}<select className={`${selectCls} ms-2`} value={kind} onChange={(e) => setKind(e.target.value)} data-testid="leads-filter-kind"><option value="">{t("leads.all")}</option>{["CLINIC", "NURSE", "PHARMACY", "LAB"].map((k) => <option key={k} value={k}>{t(`pob.kind.${k}`)}</option>)}</select></label>
      </div>
      {q.isLoading ? <CardSkeleton rows={3} /> : q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : (
        <DataTable caption={t("leads.title")} rows={q.data!} rowKey={(r) => r.id} empty={t("leads.none")} columns={[
          { key: "o", header: t("leads.org"), cell: (r) => <div><button type="button" className="min-h-8 text-start font-bold hover:underline focus-visible:underline" dir="auto" aria-expanded={open === r.id} onClick={() => setOpen(open === r.id ? null : r.id)} data-testid={`lead-open-${r.id}`}>{r.orgName}</button><div className="text-xs text-muted-foreground">{t(`pob.kind.${r.kind}`)} · {r.market}</div></div> },
          { key: "c", header: t("leads.contact"), cell: (r) => <span dir="auto">{r.contactName}</span> },
          { key: "s", header: t("leads.status"), cell: (r) => <StatusChip tone={TONE[r.status] ?? "neutral"} data-testid={`lead-chip-${r.id}`}>{t(`leads.st.${r.status}`)}</StatusChip> },
          { key: "a", header: t("leads.assignee"), cell: (r) => r.assignee ?? <span className="text-xs text-muted-foreground">-</span> },
          { key: "d", header: t("leads.created"), cell: (r) => <span className="whitespace-nowrap text-xs">{formatDateTime(r.createdAt, i18n.language)}</span> },
        ]} />
      )}
      {sel ? <div className="mt-4"><LeadDetail key={`${sel.id}|${sel.assignee ?? ""}`} lead={sel} /></div> : null}
    </div>
  );
}
