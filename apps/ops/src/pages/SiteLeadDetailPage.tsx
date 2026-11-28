import { useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { labelOf, statusLabel, useSiteLead, useSiteLeadOwners, useSiteLeadSettings, useSiteLeadUpdate, type LeadConfig, type LeadDetail } from "@/api/siteLeads";
import { useAuth } from "@/auth/AuthProvider";
import { CardSkeleton, ErrorState } from "@/components/states";
import { PageHeader, StatusChip } from "@/components/kit";
import { formatDateTime } from "@/lib/format";
import { LEAD_TONE } from "./SiteLeadsPage";
import { LeadSlaCell } from "@/components/LeadSla";
import { canStartOnboarding, onboardingUrlForLead } from "@/lib/leadOnboarding";
import { useCreateLeadOnboarding } from "@/api/leadOnboarding";

const selectCls = "h-10 rounded-md border border-input bg-background px-2 text-sm";
const Row = ({ label, children }: { label: string; children: ReactNode }) => children === null || children === undefined || children === "" ? null : <div className="grid grid-cols-[9rem_1fr] gap-2 py-1"><dt className="text-xs font-semibold text-muted-foreground">{label}</dt><dd className="min-w-0 break-words text-sm" dir="auto">{children}</dd></div>;
/** `intro` sits above the list (a description list may only contain terms and descriptions); an empty `children` renders no list at all. */
const Card = ({ title, children, id, intro }: { title: string; children: ReactNode; id: string; intro?: ReactNode }) => <section aria-labelledby={id} className="rounded-xl border bg-card p-4 shadow-card"><h2 id={id} className="mb-2 text-sm font-bold">{title}</h2>{intro}{children ? <dl>{children}</dl> : null}</section>;

function Trail({ d, cfg }: { d: LeadDetail; cfg: LeadConfig | undefined }) {
  const { t, i18n } = useTranslation(); const lang = i18n.language;
  const line = (e: LeadDetail["events"][number]): string => {
    const x = e.data as Record<string, string | boolean | number | undefined>;
    switch (e.kind) {
      case "CREATED": return t("siteLeads.ev.created");
      case "STATUS": return t("siteLeads.ev.status", { from: statusLabel(cfg, String(x.from), lang), to: statusLabel(cfg, String(x.to), lang) }) + (x.reason ? ` (${labelOf(cfg?.lostReasons, String(x.reason), lang)})` : "");
      case "ASSIGN": return x.to ? t(x.via === "ROUND_ROBIN" ? "siteLeads.ev.assignRoundRobin" : "siteLeads.ev.assign", { name: String(x.toName ?? x.to) }) : t("siteLeads.ev.unassign");
      case "ROUTING": return t("siteLeads.ev.noOwner");
      case "REMINDER": return t("siteLeads.ev.reminder", { level: t(`siteLeads.reminderLevel.${String(x.level)}`, { defaultValue: String(x.level) }), target: t(`siteLeads.reminderTarget.${String(x.target)}`, { defaultValue: String(x.target) }), sent: Number(x.sent ?? 0), recipients: Number(x.recipients ?? 0) });
      case "NOTE": return String(x.text ?? "");
      case "TAG": return x.test !== undefined ? t(x.test ? "siteLeads.ev.testOn" : "siteLeads.ev.testOff") : t("siteLeads.ev.tags", { add: ((x.add as unknown as string[]) ?? []).join(", "), remove: ((x.remove as unknown as string[]) ?? []).join(", ") });
      case "DUPLICATE": return t("siteLeads.ev.duplicate", { ref: String(x.newRef) });
      case "NOTIFY": return t("siteLeads.ev.notify", { to: String(x.to) });
      case "ONBOARDING": return t("siteLeads.ev.onboarding", { action: t(`siteLeads.onbAction.${String(x.action)}`, { defaultValue: String(x.action) }) });
      default: return e.kind;
    }
  };
  return (
    <ol className="space-y-2" aria-label={t("siteLeads.trail")} data-testid="lead-trail">
      {[...d.events].reverse().map((e) => (
        <li key={e.id} className="rounded-lg border bg-background p-2.5 text-sm" data-testid={`lead-event-${e.kind}`}>
          <p className="text-xs text-muted-foreground"><span className="font-semibold">{t(`siteLeads.evKind.${e.kind}`, { defaultValue: e.kind })}</span> · {e.actorName ?? e.actor} · {formatDateTime(e.createdAt, lang)}</p>
          <p className="mt-0.5 whitespace-pre-wrap" dir="auto">{line(e)}</p>
        </li>
      ))}
    </ol>
  );
}

/** One join request: contact and onboarding answers, status actions, owner, tags, notes and the audit trail. */
export default function SiteLeadDetailPage() {
  const { id = "" } = useParams(); const nav = useNavigate(); const { t, i18n } = useTranslation(); const lang = i18n.language; const { user } = useAuth();
  const q = useSiteLead(id); const settings = useSiteLeadSettings(); const owners = useSiteLeadOwners(); const upd = useSiteLeadUpdate(id); const mk = useCreateLeadOnboarding(id);
  const [note, setNote] = useState(""); const [lostOpen, setLostOpen] = useState(false); const [reason, setReason] = useState(""); const [tag, setTag] = useState("");
  const cfg = settings.data?.config; const isSuper = !!user?.roles.includes("super_admin");
  const done = (m: string) => ({ onSuccess: () => toast.success(t(m)), onError: (e: unknown) => toast.error((e as { code?: string })?.code === "INVALID_TRANSITION" ? t("siteLeads.badTransition") : t("siteLeads.failed")) });
  if (q.isLoading) return <CardSkeleton rows={4} />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const d = q.data;
  const ans = Object.entries(d.answers ?? {});
  const lic = Object.entries(d.licences ?? {});
  return (
    <div data-testid="lead-detail">
      <Link to="/leads" className="mb-3 inline-flex items-center gap-1 text-sm font-medium underline-offset-2 hover:underline"><ArrowLeft className="h-4 w-4 rtl-flip" aria-hidden="true" />{t("siteLeads.back")}</Link>
      <PageHeader title={<span dir="auto">{d.legalName}</span>} hint={<span className="font-mono">{d.ref}</span>} badge={<>
        <StatusChip tone={LEAD_TONE[d.status] ?? "neutral"} data-testid="lead-status-chip">{statusLabel(cfg, d.status, lang)}</StatusChip>
        {d.isTest ? <StatusChip tone="neutral" dot={false}>{t("siteLeads.testBadge")}</StatusChip> : null}{d.duplicateOfId ? <StatusChip tone="brand" dot={false}>{t("siteLeads.dupBadge")}</StatusChip> : null}
        {d.routingFlag ? <StatusChip tone="warning" dot={false} data-testid="lead-noowner">{t("siteLeads.noEligibleBadge")}</StatusChip> : null}
      </>} />
      {d.routingFlag && !d.ownerSub ? <p className="mb-4 max-w-3xl rounded-xl border bg-card p-3 text-sm" data-testid="lead-noowner-hint">{t("siteLeads.noEligibleHint")}</p> : null}
      <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-4">
          <Card id="c-org" title={t("siteLeads.sec.org")}>
            <Row label={t("siteLeads.type")}>{labelOf(cfg?.providerTypes, d.providerType, lang)}</Row><Row label={t("siteLeads.mode")}>{t(`siteLeads.modeLong${d.mode}`)}</Row>
            <Row label={t("siteLeads.legalName")}>{d.legalName}</Row><Row label={t("siteLeads.tradeName")}>{d.tradeName}</Row>
            <Row label={t("siteLeads.branches")}>{d.branches}</Row><Row label={t("siteLeads.staff")}>{d.staffCount}</Row>
            <Row label={t("siteLeads.specialties")}>{d.specialties.map((s) => labelOf(cfg?.specialties, s, lang)).join(", ")}</Row><Row label={t("siteLeads.services")}>{d.services}</Row>
            <Row label={t("siteLeads.software")}>{d.currentSoftware}</Row>
            {ans.map(([k, v]) => <Row key={k} label={t(`siteLeads.answer.${k}`, { defaultValue: k })}>{typeof v === "boolean" ? t(v ? "siteLeads.yes" : "siteLeads.no") : String(v)}</Row>)}
          </Card>
          <Card id="c-contact" title={t("siteLeads.sec.contact")}>
            <Row label={t("siteLeads.contact")}>{d.contactName}{d.contactRole ? ` (${d.contactRole})` : ""}</Row>
            <Row label={t("siteLeads.phone")}><span dir="ltr" data-testid="lead-phone">{d.phone}</span></Row><Row label={t("siteLeads.email")}><span dir="ltr" data-testid="lead-email">{d.email}</span></Row>
            <Row label={t("siteLeads.location")}>{[d.city, labelOf(cfg?.markets.find((m) => m.key === d.market)?.governorates, d.governorate, lang), labelOf(cfg?.markets, d.market, lang)].filter(Boolean).join(", ")}</Row>
            <Row label={t("siteLeads.prefChannel")}>{labelOf(cfg?.contactChannels, d.contactChannel, lang)}</Row><Row label={t("siteLeads.prefTime")}>{labelOf(cfg?.contactTimes, d.contactTime, lang)}</Row>
            <Row label={t("siteLeads.language")}>{d.locale === "ar" ? "العربية" : "English"}</Row>
          </Card>
          <Card id="c-plan" title={t("siteLeads.sec.plan")}>
            <Row label={t("siteLeads.modules")}>{d.modules.map((m) => labelOf(cfg?.modules, m, lang)).join(", ")}</Row><Row label={t("siteLeads.goLive")}>{labelOf(cfg?.goLive, d.goLive, lang)}</Row>
            <Row label={t("siteLeads.note")}><span className="whitespace-pre-wrap">{d.note}</span></Row>
          </Card>
          <Card id="c-lic" title={t("siteLeads.sec.licences")} intro={<><p className="mb-2 text-xs text-muted-foreground">{t("siteLeads.licenceNote")}</p>{lic.length === 0 ? <p className="text-sm text-muted-foreground">{t("siteLeads.noLicences")}</p> : null}</>}>
            {lic.length === 0 ? null : lic.map(([k, v]) => <Row key={k} label={t(`siteLeads.lic.${k}`)}><span dir="ltr">{v}</span></Row>)}
          </Card>
          <Card id="c-consent" title={t("siteLeads.sec.consent")}>
            <Row label={t("siteLeads.consentAt")}>{formatDateTime(d.consentAt, lang)}</Row><Row label={t("siteLeads.consentVersion")}>{d.consentTextVersion}</Row><Row label={t("siteLeads.source")}>{d.sourceEnv}</Row><Row label={t("siteLeads.created")}>{formatDateTime(d.createdAt, lang)}</Row>
          </Card>
          {d.duplicates.length ? (
            <section aria-labelledby="c-dups" className="rounded-xl border border-destructive/40 bg-card p-4 shadow-card" data-testid="lead-duplicates"><h2 id="c-dups" className="mb-1 text-sm font-bold">{t("siteLeads.sec.duplicates")}</h2><p className="mb-2 text-xs text-muted-foreground">{t("siteLeads.dupHint")}</p>
              <ul className="space-y-1 text-sm">{d.duplicates.map((x) => <li key={x.id}><Link className="font-mono font-bold underline" to={`/leads/${x.id}`}>{x.ref}</Link> <span dir="auto">{x.legalName}</span> <span className="text-xs text-muted-foreground">{formatDateTime(x.createdAt, lang)}</span></li>)}</ul></section>
          ) : null}
        </div>
        <aside className="space-y-4" aria-label={t("siteLeads.actions")}>
          <section className="rounded-xl border bg-card p-4 shadow-card" aria-labelledby="a-status"><h2 id="a-status" className="mb-2 text-sm font-bold">{t("siteLeads.changeStatus")}</h2>
            <div className="flex flex-wrap gap-2">
              {d.allowedTransitions.filter((s) => s !== "LOST").map((s) => <Button key={s} size="sm" variant="outline" disabled={upd.isPending} onClick={() => upd.mutate({ status: s }, done("siteLeads.saved"))} data-testid={`lead-to-${s}`}>{statusLabel(cfg, s, lang)}</Button>)}
              {d.allowedTransitions.includes("LOST") ? <Button size="sm" variant="outline" onClick={() => setLostOpen((v) => !v)} aria-expanded={lostOpen} data-testid="lead-to-LOST">{statusLabel(cfg, "LOST", lang)}</Button> : null}
            </div>
            {lostOpen ? (
              <div className="mt-3 flex flex-wrap items-end gap-2"><label className="text-xs font-medium">{t("siteLeads.lostReason")}<select className={`${selectCls} ms-2`} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="lead-lost-reason"><option value="">{t("siteLeads.noReason")}</option>{cfg?.lostReasons.filter((r) => r.active).map((r) => <option key={r.key} value={r.key}>{labelOf(cfg.lostReasons, r.key, lang)}</option>)}</select></label>
                <Button size="sm" variant="destructive" disabled={upd.isPending} onClick={() => upd.mutate({ status: "LOST", lostReason: reason || null }, { ...done("siteLeads.saved"), onSuccess: () => { setLostOpen(false); toast.success(t("siteLeads.saved")); } })} data-testid="lead-lost-confirm">{t("siteLeads.confirmLost")}</Button></div>
            ) : null}
            {canStartOnboarding(d) ? (
              <div className="mt-3 border-t pt-3"><Button size="sm" onClick={() => nav(onboardingUrlForLead(d.id))} data-testid="lead-start-onboarding">{t("siteLeads.startOnboarding")}</Button><p className="mt-1 text-xs text-muted-foreground">{t("siteLeads.startOnboardingHint")}</p></div>
            ) : d.mode === "STANDALONE" && (d.status === "QUALIFIED" || d.status === "ONBOARDING") ? <p className="mt-3 border-t pt-3 text-xs text-muted-foreground" data-testid="lead-standalone-note">{t("siteLeads.standaloneNoOnboarding")}</p> : null}
            {d.lostReason ? <p className="mt-2 text-xs text-muted-foreground">{t("siteLeads.lostBecause", { reason: labelOf(cfg?.lostReasons, d.lostReason, lang) })}</p> : null}
          </section>
          {d.status === "NEW" && d.sla && d.sla.state !== "OFF" ? (
            <section className="rounded-xl border bg-card p-4 shadow-card" aria-labelledby="a-sla" data-testid="lead-sla-panel"><h2 id="a-sla" className="mb-2 text-sm font-bold">{t("siteLeads.slaFilter")}</h2>
              <LeadSlaCell sla={d.sla} testId="lead-sla" detail /><p className="mt-2 text-xs text-muted-foreground">{t("siteLeads.slaHint")}</p>
            </section>
          ) : null}
          <section className="rounded-xl border bg-card p-4 shadow-card" aria-labelledby="a-onb" data-testid="lead-onboarding-panel"><h2 id="a-onb" className="mb-2 text-sm font-bold">{t("siteLeads.onboardingPanel")}</h2>
            {d.status === "LOST" && d.onboardingRequest && ["DRAFT", "SUBMITTED"].includes(d.onboardingRequest.status) ? <p className="mb-2 rounded-md border border-warning/50 p-2 text-xs" data-testid="lead-lost-draft-open">{t("siteLeads.lostDraftOpen")}</p> : null}
            {d.onboardingRequest ? (
              <div className="space-y-2"><p className="text-sm" data-testid="lead-onboarding-status">{t("siteLeads.onboardingLinkStatus", { status: t(`leadOnboarding.st.${d.onboardingRequest.status}`) })}</p>
                <Button size="sm" variant="outline" asChild><Link to={`/leads/onboarding/${d.onboardingRequest.id}`} data-testid="lead-onboarding-open">{t("siteLeads.onboardingOpen")}</Link></Button></div>
            ) : (
              <div className="space-y-2"><p className="text-xs text-muted-foreground" data-testid="lead-onboarding-none">{t("siteLeads.onboardingNone")}</p>
                {(d.onboardingDraftOn ?? []).includes(d.status) ? <Button size="sm" variant="outline" disabled={mk.isPending} onClick={() => mk.mutate(undefined, { onSuccess: () => toast.success(t("siteLeads.onboardingCreated")), onError: () => toast.error(t("siteLeads.onboardingFailed")) })} data-testid="lead-onboarding-create">{t("siteLeads.onboardingCreate")}</Button> : null}</div>
            )}
            <p className="mt-2 text-xs text-muted-foreground">{t("siteLeads.onboardingNote")}</p>
          </section>
          <section className="rounded-xl border bg-card p-4 shadow-card" aria-labelledby="a-owner"><h2 id="a-owner" className="mb-2 text-sm font-bold">{t("siteLeads.owner")}</h2>
            <div className="flex flex-wrap items-center gap-2">
              <select className={`${selectCls} min-w-40 flex-1`} aria-label={t("siteLeads.owner")} value={d.ownerSub ?? ""} disabled={upd.isPending} onChange={(e) => upd.mutate({ ownerSub: e.target.value || null }, done("siteLeads.saved"))} data-testid="lead-owner">
                <option value="">{t("siteLeads.unassignedOption")}</option>{owners.data?.map((o) => <option key={o.sub} value={o.sub}>{o.name}</option>)}
              </select>
              {d.ownerSub !== user?.sub ? <Button size="sm" variant="outline" disabled={upd.isPending || !user} onClick={() => upd.mutate({ ownerSub: user!.sub }, done("siteLeads.saved"))} data-testid="lead-assign-me">{t("siteLeads.assignMe")}</Button> : null}
            </div>
            {d.ownerSub && d.assignedVia ? <p className="mt-2 text-xs text-muted-foreground" data-testid="lead-assigned-via">{t(d.assignedVia === "ROUND_ROBIN" ? "siteLeads.assignedRoundRobin" : "siteLeads.assignedHuman")}</p> : null}
          </section>
          <section className="rounded-xl border bg-card p-4 shadow-card" aria-labelledby="a-tags"><h2 id="a-tags" className="mb-2 text-sm font-bold">{t("siteLeads.tags")}</h2>
            <p className="mb-2 flex flex-wrap gap-1">{d.tags.length ? d.tags.map((x) => <button key={x} type="button" className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold hover:bg-accent" aria-label={t("siteLeads.removeTag", { tag: x })} onClick={() => upd.mutate({ removeTags: [x] }, done("siteLeads.saved"))}>{x} ×</button>) : <span className="text-xs text-muted-foreground">{t("siteLeads.noTags")}</span>}</p>
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (tag.trim()) upd.mutate({ addTags: [tag] }, { ...done("siteLeads.saved"), onSuccess: () => { setTag(""); toast.success(t("siteLeads.saved")); } }); }}>
              <Input className="h-9" aria-label={t("siteLeads.addTag")} placeholder={t("siteLeads.addTag")} value={tag} maxLength={24} onChange={(e) => setTag(e.target.value)} /><Button type="submit" size="sm" disabled={!tag.trim() || upd.isPending}>{t("siteLeads.add")}</Button>
            </form>
            {isSuper ? <label className="mt-3 flex min-h-9 items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4" checked={d.isTest} disabled={upd.isPending} onChange={(e) => upd.mutate({ isTest: e.target.checked }, done("siteLeads.saved"))} data-testid="lead-test-toggle" />{t("siteLeads.markTest")}</label> : null}
          </section>
          <section className="rounded-xl border bg-card p-4 shadow-card" aria-labelledby="a-notes"><h2 id="a-notes" className="mb-2 text-sm font-bold">{t("siteLeads.addNoteTitle")}</h2>
            <form onSubmit={(e) => { e.preventDefault(); if (note.trim()) upd.mutate({ note }, { ...done("siteLeads.noteAdded"), onSuccess: () => { setNote(""); toast.success(t("siteLeads.noteAdded")); } }); }} className="space-y-2">
              <textarea className="min-h-20 w-full rounded-md border border-input bg-background p-2 text-sm" aria-label={t("siteLeads.addNoteTitle")} value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} data-testid="lead-note-input" />
              <Button type="submit" size="sm" disabled={upd.isPending || !note.trim()} data-testid="lead-note-add">{t("siteLeads.add")}</Button>
            </form>
          </section>
        </aside>
      </div>
      <section className="mt-6" aria-labelledby="c-trail"><h2 id="c-trail" className="mb-2 text-sm font-bold">{t("siteLeads.trail")}</h2><Trail d={d} cfg={cfg} /></section>
    </div>
  );
}
