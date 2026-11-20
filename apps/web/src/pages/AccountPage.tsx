import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { ClipboardList, Laptop, MapPin, Trash2, UserPlus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button, buttonVariants } from "@/components/ui/button";
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
import type { FamilyInput } from "@/api/hooks";
import { PageHeader } from "@/components/kit";

function Profile() {
  const { t, i18n } = useTranslation();
  const me = useMe();
  if (me.isLoading) return <CardSkeleton rows={1} />;
  if (me.error) return <ErrorState error={me.error} onRetry={() => void me.refetch()} />;
  const m = me.data!;
  return (
    <><dl className="kx-card grid gap-4 p-5 sm:grid-cols-2">
      <div><dt className="text-sm text-muted-foreground">{t("account.name")}</dt><dd className="font-medium">{(i18n.language.startsWith("ar") ? m.nameAr : m.nameEn) ?? m.nameEn ?? m.nameAr ?? "—"}</dd></div>
      <div><dt className="text-sm text-muted-foreground">{t("account.phone")}</dt><dd className="font-medium" dir="ltr">{m.phone}</dd></div>
    </dl>
    <p className="text-xs text-muted-foreground">{t("account.managedBy")}</p></>
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
          <li key={m.id} className="kx-card flex items-center justify-between p-4" data-testid="family-member">
            <div><p className="font-medium">{m.name}</p><p className="text-sm text-muted-foreground">{t(`family.rel.${m.relationship}`, { defaultValue: m.relationship })}</p></div>
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
    <ul className="space-y-3">
      {q.data!.map((c) => (
        <li key={c.type} className="kx-card flex items-start justify-between gap-4 p-4">
          <div><Label htmlFor={`c-${c.type}`} className="text-base">{t(`consent.${c.type}.title`)}</Label><p className="text-sm text-muted-foreground">{t(`consent.${c.type}.body`)}</p>
            <p className="mt-1 text-xs text-muted-foreground">{c.updatedAt ? t("consent.updated", { date: formatDay(c.updatedAt, i18n.language) }) : t("consent.never")}</p></div>
          <Switch id={`c-${c.type}`} checked={c.granted} onCheckedChange={(granted) => set.mutate({ type: c.type, granted }, { onError: () => toast.error(t("states.errorTitle")) })} />
        </li>
      ))}
    </ul>
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
          <div className="flex items-center gap-3"><Laptop className="h-5 w-5 text-ocean" aria-hidden="true" /><div><p className="font-medium">{s.device}{s.current && <span className="ms-2 rounded-full bg-success-soft px-2 py-0.5 text-xs text-success">{t("sessions.current")}</span>}</p>
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
      <nav aria-label={t("hv.homeCare")} className="flex flex-wrap gap-3">
        <Link to="/account/addresses" className={cn(buttonVariants({ variant: "outline" }))} data-testid="link-addresses"><MapPin aria-hidden="true" />{t("hv.addressBook")}</Link>
        <Link to="/care-plans" className={cn(buttonVariants({ variant: "outline" }))} data-testid="link-care-plans"><ClipboardList aria-hidden="true" />{t("hv.carePlans")}</Link>
      </nav>
      <Tabs defaultValue="family">
        <TabsList className="h-auto flex-wrap justify-start">
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
