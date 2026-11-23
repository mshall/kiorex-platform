import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { Bell, ChevronRight, ClipboardList, Download, Laptop, LogOut, MapPin, Pencil, ShieldCheck, Smartphone, Trash2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAddFamily, useConsents, useDeleteAccount, useFamily, useMe, useRemoveFamily, useRevokeSession, useSessions, useSetConsent } from "@/api/hooks";
import { ApiError } from "@/api/errors";
import { CardSkeleton, EmptyState, ErrorState, UnavailableState } from "@/components/states";
import { useFeature } from "@/hooks/useFeature";
import { useAuth } from "@/auth/AuthProvider";
import { formatDay, formatTime } from "@/lib/format";
import { downloadJson } from "@/lib/download";
import { deviceLabel } from "@/lib/device";
import { useConsentHistory, useExportData, useUpdateProfile } from "@/api/engagement";
import type { FamilyInput } from "@/api/hooks";
import { IconTile, PageHeader, StatusChip } from "@/components/kit";

function Profile() {
  const { t, i18n } = useTranslation();
  const me = useMe();
  if (me.isLoading) return <CardSkeleton rows={1} />;
  if (me.error) return <ErrorState error={me.error} onRetry={() => void me.refetch()} />;
  const m = me.data!;
  const name = (i18n.language.startsWith("ar") ? m.nameAr : m.nameEn) ?? m.nameEn ?? m.nameAr ?? "—";
  return (
    <>
    <section className="kx-card flex items-center gap-4 p-5 sm:p-6" aria-label={t("p3.yourAccount")}>
      <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-linear-to-br from-primary to-ocean text-2xl font-semibold text-white shadow-raised" aria-hidden="true">{name.trim().charAt(0).toUpperCase()}</span>
      <dl className="grid min-w-0 flex-1 gap-3 sm:grid-cols-2">
        <div className="min-w-0"><dt className="text-sm text-muted-foreground">{t("account.name")}</dt><dd className="truncate text-lg font-semibold">{name}</dd></div>
        <div><dt className="text-sm text-muted-foreground">{t("account.phone")}</dt><dd className="kx-label-num text-lg font-semibold"><bdi dir="ltr">{m.phone}</bdi></dd></div>
      </dl>
    </section>
    <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><ShieldCheck className="h-3.5 w-3.5 text-success" aria-hidden="true" />{t("account.managedBy")}</p>
    <div className="flex flex-wrap gap-2"><EditProfile /><DataExport /><SignOut /></div></>
  );
}

/** KXM-AC-02: the patient edits their own name, language and e-mail (phone and sign-in stay with Kiorex Passport). */
function SignOut() {
  const { t } = useTranslation();
  const { logout } = useAuth();
  // visible on phones too: the header button is desktop-only, and the Account tab is where a phone user looks for it
  return <Button variant="outline" onClick={() => void logout()} data-testid="account-sign-out"><LogOut className="rtl-flip" aria-hidden="true" />{t("nav.signOut")}</Button>;
}

function EditProfile() {
  const { t, i18n } = useTranslation();
  const me = useMe();
  const update = useUpdateProfile();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ nameEn: "", nameAr: "", email: "", preferredLocale: "ar" as "ar" | "en" });
  if (!me.data) return null;
  const start = () => { setF({ nameEn: me.data!.nameEn ?? "", nameAr: me.data!.nameAr ?? "", email: me.data!.email ?? "", preferredLocale: me.data!.locale }); setOpen(true); };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    update.mutate({ nameEn: f.nameEn.trim() || undefined, nameAr: f.nameAr.trim() || undefined, email: f.email.trim() || undefined, preferredLocale: f.preferredLocale }, {
      onSuccess: () => { toast.success(t("account.profileSaved")); setOpen(false); if (f.preferredLocale !== i18n.language.slice(0, 2)) void i18n.changeLanguage(f.preferredLocale); },
      onError: () => toast.error(t("account.profileFailed")),
    });
  };
  return (
    <>
      <Button variant="outline" onClick={start} data-testid="edit-profile"><Pencil aria-hidden="true" />{t("account.editProfile")}</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t("account.editProfile")}</DialogTitle><DialogDescription>{t("account.managedBy")}</DialogDescription></DialogHeader>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2"><Label htmlFor="pf-en">{t("account.nameEn")}</Label><Input id="pf-en" value={f.nameEn} maxLength={120} onChange={(e) => setF({ ...f, nameEn: e.target.value })} dir="ltr" /></div>
            <div className="space-y-2"><Label htmlFor="pf-ar">{t("account.nameAr")}</Label><Input id="pf-ar" value={f.nameAr} maxLength={120} onChange={(e) => setF({ ...f, nameAr: e.target.value })} dir="rtl" /></div>
            <div className="space-y-2"><Label htmlFor="pf-mail">{t("account.email")}</Label><Input id="pf-mail" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} dir="ltr" /></div>
            <div className="space-y-2"><Label htmlFor="pf-loc">{t("account.language")}</Label>
              <select id="pf-loc" value={f.preferredLocale} onChange={(e) => setF({ ...f, preferredLocale: e.target.value as "ar" | "en" })} className="h-11 w-full rounded-xl border border-input bg-card px-3 text-sm"><option value="ar">العربية</option><option value="en">English</option></select></div>
            <DialogFooter><Button type="button" variant="outline" onClick={() => setOpen(false)}>{t("appointment.keep")}</Button><Button type="submit" disabled={update.isPending}>{t("account.save")}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** KXM-AC-06: download everything Kiorex holds about the patient without deleting anything. */
function DataExport() {
  const { t } = useTranslation();
  const exp = useExportData();
  return (
    <Button variant="outline" disabled={exp.isPending} data-testid="export-data" onClick={() => exp.mutate(undefined, { onSuccess: (r) => { downloadJson("kiorex-data-export.json", r); toast.success(t("account.exportReady")); }, onError: () => toast.error(t("states.errorTitle")) })}><Download aria-hidden="true" />{t("account.exportCta")}</Button>
  );
}

function ConsentHistory() {
  const { t, i18n } = useTranslation();
  const q = useConsentHistory();
  if (q.isLoading || q.error || !q.data?.length) return null;
  return (
    <section className="space-y-2" aria-labelledby="ch-h" data-testid="consent-history">
      <h3 id="ch-h" className="text-base font-semibold">{t("consent.history")}</h3>
      <ul className="divide-y rounded-xl border bg-card text-sm">
        {q.data.slice(0, 12).map((c) => (
          <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
            <span>{t(`consent.${c.purpose.toLowerCase()}.title`, { defaultValue: c.purpose })}</span>
            <span className="flex items-center gap-2 text-muted-foreground"><StatusChip tone={c.granted ? "success" : "neutral"}>{c.granted ? t("p3.consentOn") : t("p3.consentOff")}</StatusChip>{formatDay(c.createdAt, i18n.language)} · {formatTime(c.createdAt, i18n.language)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Family() {
  const { t } = useTranslation();
  const fam = useFamily();
  const add = useAddFamily();
  const remove = useRemoveFamily();
  const feature = useFeature("kiorex.family_accounts");
  const [name, setName] = useState("");
  const [relationship, setRelationship] = useState<FamilyInput["relationship"]>("CHILD");
  const [dob, setDob] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    add.mutate({ nameEn: name.trim(), relationship, dateOfBirth: dob }, {
      onSuccess: () => { setName(""); setDob(""); toast.success(t("family.added")); },
      onError: (err) => toast.error(err instanceof ApiError ? (err.isFeatureDisabled ? t("unavailable.title") : err.code === "DEPENDANT_ADULT" ? t("family.adult") : t("family.addFailed")) : t("family.addFailed")),
    });
  };
  return (
    <div className="space-y-4">
      {fam.isLoading ? <CardSkeleton rows={1} /> : fam.error ? <ErrorState error={fam.error} onRetry={() => void fam.refetch()} /> : fam.data!.length === 0 ? <EmptyState title={t("family.empty")} hint={t("family.emptyHint")} /> : (
        <ul className="space-y-2">{fam.data!.map((m) => (
          <li key={m.id} className="kx-card flex items-center gap-3 p-4" data-testid="family-member">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent font-semibold text-primary" aria-hidden="true">{m.name.trim().charAt(0).toUpperCase()}</span>
            <div className="min-w-0 flex-1"><p className="font-medium">{m.name}</p><p className="text-sm text-muted-foreground">{t(`family.rel.${m.relationship.toLowerCase()}`, { defaultValue: m.relationship })}</p></div>
            <Button variant="ghost" size="icon" aria-label={t("family.remove", { name: m.name })} onClick={() => remove.mutate(m.id)}><Trash2 className="text-destructive" aria-hidden="true" /></Button>
          </li>))}
        </ul>
      )}
      {feature.enabled ? (
        <form onSubmit={submit} className="kx-card grid gap-4 p-5 sm:grid-cols-3" aria-label={t("family.add")}>
          <div className="space-y-2"><Label htmlFor="fm-name">{t("family.name")}</Label><Input id="fm-name" value={name} onChange={(e) => setName(e.target.value)} required /></div>
          <div className="space-y-2"><Label htmlFor="fm-rel">{t("family.relationship")}</Label>
            <select id="fm-rel" value={relationship} onChange={(e) => setRelationship(e.target.value as FamilyInput["relationship"])} className="h-11 w-full rounded-xl border border-input bg-card px-3 text-sm">
              {(["CHILD", "SPOUSE", "PARENT", "OTHER"] as const).map((r) => <option key={r} value={r}>{t(`family.rel.${r.toLowerCase()}`)}</option>)}
            </select></div>
          <div className="space-y-2"><Label htmlFor="fm-dob">{t("family.dob")}</Label><Input id="fm-dob" type="date" required value={dob} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setDob(e.target.value)} /><p className="text-xs text-muted-foreground">{t("family.under18")}</p></div>
          <Button type="submit" disabled={add.isPending || !name.trim() || !dob} className="sm:col-span-3 sm:justify-self-start"><UserPlus aria-hidden="true" />{t("family.add")}</Button>
        </form>
      ) : <UnavailableState featureKey="kiorex.family_accounts" />}
    </div>
  );
}

function Consents() {
  const { t, i18n } = useTranslation();
  const q = useConsents();
  const set = useSetConsent();
  if (q.isLoading) return <CardSkeleton rows={2} />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  return (
    <div className="space-y-5">
    <ul className="space-y-3">
      {q.data!.map((c) => (
        <li key={c.type} className="kx-card flex items-start gap-3 p-4">
          <IconTile tone={c.granted ? "brand" : "neutral"}><Bell /></IconTile>
          <div className="min-w-0 flex-1"><Label htmlFor={`c-${c.type}`} className="text-base">{t(`consent.${c.type}.title`)}</Label><p className="text-sm text-muted-foreground">{t(`consent.${c.type}.body`)}</p>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><StatusChip tone={c.granted ? "success" : "neutral"}>{c.granted ? t("p3.consentOn") : t("p3.consentOff")}</StatusChip>{c.updatedAt ? t("consent.updated", { date: formatDay(c.updatedAt, i18n.language) }) : t("consent.never")}</p></div>
          <Switch id={`c-${c.type}`} checked={c.granted} onCheckedChange={(granted) => set.mutate({ type: c.type, granted }, { onError: () => toast.error(t("states.errorTitle")) })} />
        </li>
      ))}
    </ul>
    <ConsentHistory />
    </div>
  );
}

function Sessions() {
  const { t, i18n } = useTranslation();
  const q = useSessions();
  const revoke = useRevokeSession();
  if (q.isLoading) return <CardSkeleton rows={2} />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  return (
    <ul className="space-y-3">
      {q.data!.map((s) => (
        <li key={s.id} className="kx-card flex items-center justify-between gap-3 p-4">
          <div className="flex items-center gap-3"><IconTile tone={s.current ? "success" : "neutral"}>{/mobile|android|iphone|ios|app/i.test(s.device) ? <Smartphone /> : <Laptop />}</IconTile><div><p className="flex flex-wrap items-center gap-2 font-medium">{deviceLabel(s.device)}{s.current && <StatusChip tone="success">{t("sessions.current")}</StatusChip>}</p>
            <p className="text-xs text-muted-foreground">{formatDay(s.lastSeenAt, i18n.language)} · {formatTime(s.lastSeenAt, i18n.language)}</p></div></div>
          {!s.current && <Button variant="outline" size="sm" onClick={() => revoke.mutate(s.id)}>{t("sessions.signOut")}</Button>}
        </li>
      ))}
    </ul>
  );
}

function DeleteAccount() {
  const { t } = useTranslation();
  const { logout } = useAuth();
  const del = useDeleteAccount();
  const [open, setOpen] = useState(false);
  const [exportData, setExportData] = useState(true);
  const [typed, setTyped] = useState("");
  const word = t("account.deleteWord");
  return (
    <section className="kx-card space-y-3 border-destructive/40 p-5" aria-labelledby="del-title">
      <h2 id="del-title" className="text-lg text-destructive">{t("account.deleteTitle")}</h2>
      <p className="text-sm text-muted-foreground">{t("account.deleteBody")}</p>
      <Button variant="destructive" onClick={() => setOpen(true)} data-testid="delete-account"><Trash2 aria-hidden="true" />{t("account.deleteCta")}</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t("account.deleteConfirmTitle")}</DialogTitle><DialogDescription>{t("account.deleteConfirmBody")}</DialogDescription></DialogHeader>
          <label className="flex min-h-11 items-center gap-3"><Checkbox checked={exportData} onCheckedChange={(c) => setExportData(c === true)} /><span className="text-sm">{t("account.exportFirst")}</span></label>
          <div className="space-y-2"><Label htmlFor="del-confirm">{t("account.typeToConfirm", { word })}</Label><Input id="del-confirm" value={typed} onChange={(e) => setTyped(e.target.value)} /></div>
          <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>{t("appointment.keep")}</Button>
            <Button variant="destructive" disabled={typed.trim() !== word || del.isPending} onClick={() => del.mutate(exportData, { onSuccess: (r) => { if (r.export) downloadJson("kiorex-data-export.json", r.export); toast.success(t("account.deleteRequested")); void logout(); }, onError: () => toast.error(t("states.errorTitle")) })}>{t("account.deleteConfirm")}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

export default function AccountPage() {
  const { t } = useTranslation();
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title={t("account.title")} />
      <Profile />
      <nav aria-label={t("hv.homeCare")} className="grid gap-3 sm:grid-cols-2">
        {([["/account/addresses", MapPin, t("hv.addressBook"), t("p3.addressesHint"), "link-addresses"], ["/care-plans", ClipboardList, t("hv.carePlans"), t("p3.plansHint"), "link-care-plans"], ["/notifications", Bell, t("notifications.title"), t("notifications.linkHint"), "link-notifications"]] as const).map(([to, Icon, title, hint, id]) => (
          <Link key={to} to={to} className="kx-card kx-card-interactive flex items-center gap-3 p-4" data-testid={id}><IconTile><Icon /></IconTile><span className="min-w-0 flex-1"><span className="block font-semibold">{title}</span><span className="block text-sm text-muted-foreground">{hint}</span></span><ChevronRight className="h-4 w-4 rtl-flip text-muted-foreground" aria-hidden="true" /></Link>
        ))}
      </nav>
      <Tabs defaultValue="family">
        <TabsList className="h-auto w-full flex-wrap justify-start sm:w-auto">
          {(["family", "consents", "sessions"] as const).map((k) => <TabsTrigger key={k} value={k} className="min-h-11 px-5">{t(`account.tabs.${k}`)}</TabsTrigger>)}
        </TabsList>
        <TabsContent value="family" className="mt-4"><Family /></TabsContent>
        <TabsContent value="consents" className="mt-4"><Consents /></TabsContent>
        <TabsContent value="sessions" className="mt-4"><Sessions /></TabsContent>
      </Tabs>
      <DeleteAccount />
    </div>
  );
}
