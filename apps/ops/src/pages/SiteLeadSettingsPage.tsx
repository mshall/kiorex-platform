import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ArrowLeft, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SITE_LEAD_STATUSES, useRemoveTestLeads, useSaveLeadSettings, useSiteLeadSettings, type LeadConfig, type LeadSettings, type MarketItem, type PickItem } from "@/api/siteLeads";
import { useAuth } from "@/auth/AuthProvider";
import { CardSkeleton, ErrorState } from "@/components/states";
import { PageHeader } from "@/components/kit";
import { formatDateTime } from "@/lib/format";

const KEY_RE = /^[A-Z0-9][A-Z0-9_]{0,39}$/;
const PICKLISTS = ["providerTypes", "specialties", "modules", "goLive", "software", "contactChannels", "contactTimes", "lostReasons"] as const;
type PickName = (typeof PICKLISTS)[number];

/** A row added in this session carries `_new` (ignored by the server): its key is editable and it can be removed; saved rows can only be deactivated, so a stored key is never reused. */
type Row = PickItem & { _new?: true };
function Picklist({ items, onChange, readOnly, name, keyRe = KEY_RE }: { items: PickItem[]; onChange: (v: PickItem[]) => void; readOnly: boolean; name: string; keyRe?: RegExp }) {
  const { t } = useTranslation();
  const upd = (i: number, p: Partial<PickItem>) => onChange(items.map((x, j) => (j === i ? { ...x, ...p } : x)));
  return (
    <div className="space-y-2">
      <div className="hidden grid-cols-[9rem_1fr_1fr_5rem_2.5rem] gap-2 text-xs font-semibold text-muted-foreground md:grid" aria-hidden="true"><span>{t("siteLeads.set.key")}</span><span>English</span><span>العربية</span><span>{t("siteLeads.set.active")}</span><span /></div>
      <ul className="space-y-2">
        {items.map((it, i) => {
          const isNew = (it as Row)._new === true; const bad = !keyRe.test(it.key);
          return (
            <li key={`${i}`} className="grid grid-cols-1 gap-2 rounded-lg border bg-background p-2 md:grid-cols-[9rem_1fr_1fr_5rem_2.5rem] md:items-center md:border-0 md:p-0" data-testid={`pick-${name}-${i}`}>
              <Input className="h-9 font-mono text-xs" aria-label={`${name} ${t("siteLeads.set.key")} ${i + 1}`} value={it.key} readOnly={readOnly || !isNew} aria-invalid={bad} onChange={(e) => upd(i, { key: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "_") })} />
              <Input className="h-9" dir="ltr" aria-label={`${name} English ${i + 1}`} value={it.en} readOnly={readOnly} maxLength={80} onChange={(e) => upd(i, { en: e.target.value })} />
              <Input className="h-9" dir="rtl" aria-label={`${name} Arabic ${i + 1}`} value={it.ar} readOnly={readOnly} maxLength={80} onChange={(e) => upd(i, { ar: e.target.value })} />
              <label className="flex min-h-9 items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4" checked={it.active} disabled={readOnly} onChange={(e) => upd(i, { active: e.target.checked })} /><span className="md:sr-only">{t("siteLeads.set.active")}</span></label>
              {isNew && !readOnly ? <Button type="button" variant="ghost" size="icon" aria-label={t("siteLeads.set.remove")} onClick={() => onChange(items.filter((_, j) => j !== i))}>×</Button> : <span />}
            </li>
          );
        })}
      </ul>
      {readOnly ? null : <Button type="button" variant="outline" size="sm" onClick={() => onChange([...items, { key: `NEW_${items.length + 1}`, en: "", ar: "", active: true, _new: true } as Row])} data-testid={`pick-add-${name}`}><Plus aria-hidden="true" />{t("siteLeads.set.add")}</Button>}
    </div>
  );
}

const Section = ({ id, title, hint, children, open }: { id: string; title: string; hint?: string; children: React.ReactNode; open?: boolean }) => (
  <details className="rounded-xl border bg-card p-4 shadow-card" open={open} data-testid={`set-${id}`}><summary className="cursor-pointer text-base font-bold">{title}</summary>{hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}<div className="mt-3">{children}</div></details>
);

/** Join-flow settings: picklists, required fields, test markers and notification switches. Everyone with console access reads; a super admin saves. Versioned and audited. */
export default function SiteLeadSettingsPage() {
  const q = useSiteLeadSettings();
  if (q.isLoading) return <CardSkeleton rows={4} />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  // keyed by the stored version: a save (or a reload after a stale save) starts a fresh draft from what the server holds
  return <Editor key={q.data.version} settings={q.data} reload={() => void q.refetch()} />;
}

function Editor({ settings, reload }: { settings: LeadSettings; reload: () => void }) {
  const { t, i18n } = useTranslation(); const lang = i18n.language; const { user } = useAuth();
  const save = useSaveLeadSettings(); const rm = useRemoveTestLeads();
  const isSuper = !!user?.roles.includes("super_admin");
    const [draft, setDraft] = useState<LeadConfig>(() => JSON.parse(JSON.stringify(settings.config)) as LeadConfig); const [confirmRm, setConfirmRm] = useState<number | null>(null);
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(settings.config), [draft, settings]);
  const ro = !isSuper;
  const set = <K extends keyof LeadConfig>(k: K, v: LeadConfig[K]) => setDraft({ ...draft, [k]: v });
  const doSave = () => save.mutate({ version: settings.version, config: draft }, {
    onSuccess: () => toast.success(t("siteLeads.set.saved")),
    onError: (e) => { const c = (e as { code?: string }); toast.error(c.code === "LEAD_CONFIG_STALE" ? t("siteLeads.set.stale") : t("siteLeads.set.invalid")); if (c.code === "LEAD_CONFIG_STALE") reload(); },
  });
  const lines = (a: string[]) => a.join("\n"); const parse = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);
  return (
    <div className="space-y-4">
      <Link to="/leads" className="inline-flex items-center gap-1 text-sm font-medium underline-offset-2 hover:underline"><ArrowLeft className="h-4 w-4 rtl-flip" aria-hidden="true" />{t("siteLeads.back")}</Link>
      <PageHeader title={t("siteLeads.set.title")} hint={t("siteLeads.set.hint")} actions={isSuper ? <Button onClick={doSave} disabled={!dirty || save.isPending} data-testid="set-save">{t("siteLeads.set.save")}</Button> : null} />
      <p className="text-xs text-muted-foreground" data-testid="set-version">{t("siteLeads.set.version", { v: settings.version })}{settings.updatedAt ? ` · ${formatDateTime(settings.updatedAt, lang)}` : ` · ${t("siteLeads.set.defaults")}`}</p>
      {ro ? <p role="note" className="rounded-lg border bg-muted p-3 text-sm" data-testid="set-readonly">{t("siteLeads.set.readOnly")}</p> : <p role="note" className="rounded-lg border bg-muted p-3 text-sm">{t("siteLeads.set.noApprover")}</p>}
      {PICKLISTS.map((n, i) => (
        <Section key={n} id={n} title={t(`siteLeads.set.list.${n}`)} open={i === 0}><Picklist name={n} items={draft[n as PickName]} readOnly={ro} onChange={(v) => set(n as PickName, v)} /></Section>
      ))}
      <Section id="markets" title={t("siteLeads.set.list.markets")} hint={t("siteLeads.set.marketsHint")}>
        <ul className="space-y-4">
          {draft.markets.map((m: MarketItem, i) => (
            <li key={i} className="rounded-lg border bg-background p-3" data-testid={`market-${m.key}`}>
              <div className="mb-2 grid gap-2 sm:grid-cols-[6rem_1fr_1fr_7rem_5rem]">
                <Input className="h-9 font-mono text-xs" aria-label={t("siteLeads.set.key")} value={m.key} readOnly={ro || !(m as MarketItem & { _new?: true })._new} maxLength={2} onChange={(e) => set("markets", draft.markets.map((x, j) => (j === i ? { ...x, key: e.target.value.toUpperCase().replace(/[^A-Z]/g, "") } : x)))} />
                <Input className="h-9" dir="ltr" aria-label="English" value={m.en} readOnly={ro} onChange={(e) => set("markets", draft.markets.map((x, j) => (j === i ? { ...x, en: e.target.value } : x)))} />
                <Input className="h-9" dir="rtl" aria-label="العربية" value={m.ar} readOnly={ro} onChange={(e) => set("markets", draft.markets.map((x, j) => (j === i ? { ...x, ar: e.target.value } : x)))} />
                <Input className="h-9" dir="ltr" aria-label={t("siteLeads.set.dial")} value={m.dialCode} readOnly={ro} onChange={(e) => set("markets", draft.markets.map((x, j) => (j === i ? { ...x, dialCode: e.target.value } : x)))} />
                <label className="flex min-h-9 items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4" checked={m.active} disabled={ro} onChange={(e) => set("markets", draft.markets.map((x, j) => (j === i ? { ...x, active: e.target.checked } : x)))} />{t("siteLeads.set.active")}</label>
              </div>
              <details><summary className="cursor-pointer text-sm font-semibold">{t("siteLeads.set.governorates", { count: m.governorates.length })}</summary>
                <div className="mt-2"><Picklist name={`gov-${m.key}`} items={m.governorates} readOnly={ro} onChange={(v) => set("markets", draft.markets.map((x, j) => (j === i ? { ...x, governorates: v } : x)))} /></div></details>
            </li>
          ))}
        </ul>
        {ro ? null : <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => set("markets", [...draft.markets, { key: "NEW", en: "", ar: "", active: false, dialCode: "+", governorates: [], _new: true } as MarketItem])}><Plus aria-hidden="true" />{t("siteLeads.set.add")}</Button>}
      </Section>
      <Section id="status" title={t("siteLeads.set.statusLabels")} hint={t("siteLeads.set.statusHint")}>
        <ul className="space-y-2">{SITE_LEAD_STATUSES.map((s) => (
          <li key={s} className="grid gap-2 sm:grid-cols-[8rem_1fr_1fr] sm:items-center"><code className="text-xs">{s}</code>
            <Input className="h-9" dir="ltr" aria-label={`${s} English`} value={draft.statusLabels[s].en} readOnly={ro} onChange={(e) => set("statusLabels", { ...draft.statusLabels, [s]: { ...draft.statusLabels[s], en: e.target.value } })} />
            <Input className="h-9" dir="rtl" aria-label={`${s} Arabic`} value={draft.statusLabels[s].ar} readOnly={ro} onChange={(e) => set("statusLabels", { ...draft.statusLabels, [s]: { ...draft.statusLabels[s], ar: e.target.value } })} /></li>
        ))}</ul>
      </Section>
      <Section id="required" title={t("siteLeads.set.required")} hint={t("siteLeads.set.requiredHint")}>
        <fieldset className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3" disabled={ro}><legend className="sr-only">{t("siteLeads.set.required")}</legend>
          {settings.requirable.map((f) => <label key={f} className="flex min-h-9 items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4" checked={draft.requiredFields.includes(f)} onChange={(e) => set("requiredFields", e.target.checked ? [...draft.requiredFields, f] : draft.requiredFields.filter((x) => x !== f))} data-testid={`req-${f}`} />{t(`siteLeads.set.field.${f}`, { defaultValue: f })}</label>)}
        </fieldset>
      </Section>
      <Section id="test" title={t("siteLeads.set.testMarkers")} hint={t("siteLeads.set.testHint")}>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs font-medium">{t("siteLeads.set.testDomains")}<textarea className="mt-1 min-h-20 w-full rounded-md border border-input bg-background p-2 font-mono text-sm" dir="ltr" readOnly={ro} value={lines(draft.testMarkers.emailDomains)} onChange={(e) => set("testMarkers", { ...draft.testMarkers, emailDomains: parse(e.target.value) })} /></label>
          <label className="text-xs font-medium">{t("siteLeads.set.testPrefixes")}<textarea className="mt-1 min-h-20 w-full rounded-md border border-input bg-background p-2 font-mono text-sm" dir="ltr" readOnly={ro} value={lines(draft.testMarkers.namePrefixes)} onChange={(e) => set("testMarkers", { ...draft.testMarkers, namePrefixes: parse(e.target.value) })} /></label>
        </div>
        <div className="mt-4 rounded-lg border bg-background p-3" data-testid="test-removal"><h3 className="text-sm font-bold">{t("siteLeads.set.removeTitle")}</h3><p className="text-xs text-muted-foreground">{t("siteLeads.set.removeHint")}</p>
          {isSuper ? (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" size="sm" disabled={rm.isPending} onClick={() => rm.mutate(false, { onSuccess: (d) => setConfirmRm(d.count) })} data-testid="test-count">{t("siteLeads.set.countTest")}</Button>
              {confirmRm !== null ? <><span className="text-sm" data-testid="test-count-result">{t("siteLeads.set.willDelete", { count: confirmRm })}</span>
                <Button type="button" variant="destructive" size="sm" disabled={rm.isPending || confirmRm === 0} onClick={() => rm.mutate(true, { onSuccess: (d) => { setConfirmRm(null); toast.success(t("siteLeads.set.deleted", { count: d.count })); } })} data-testid="test-delete">{t("siteLeads.set.deleteTest")}</Button></> : null}
            </div>
          ) : <p className="mt-2 text-xs">{t("siteLeads.set.superOnly")}</p>}
        </div>
      </Section>
      <Section id="notify" title={t("siteLeads.set.notifications")} hint={t("siteLeads.set.notifyHint")}>
        <label className="flex min-h-9 items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4" disabled={ro} checked={draft.notifications.applicantAck} onChange={(e) => set("notifications", { ...draft.notifications, applicantAck: e.target.checked })} />{t("siteLeads.set.ack")}</label>
        <label className="flex min-h-9 items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4" disabled={ro} checked={draft.notifications.teamAlert} onChange={(e) => set("notifications", { ...draft.notifications, teamAlert: e.target.checked })} />{t("siteLeads.set.team")}</label>
      </Section>
    </div>
  );
}
