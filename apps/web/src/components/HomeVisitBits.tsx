import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { AlertTriangle, Copy, Navigation, Eye, EyeOff, HeartHandshake, Home, MapPin, MessageCircle, Phone, ShieldAlert, ShieldCheck, Trash2, UserRound } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useCreateFamilyShare, useFamilyShares, useReportProblem, useRevokeFamilyShare, useSafetyCard, type FamilyShareCreated, type ProblemCategory } from "@/api/home";
import { ApiError } from "@/api/errors";
import type { HomeBooking } from "@/api/types";
import { CardSkeleton, ErrorState, MockNotice } from "@/components/states";
import { formatDateTime, formatMinor, formatTime } from "@/lib/format";
import { IconTile, Row, StatusBanner, StatusChip, Timeline } from "@/components/kit";

const ADDR_KEYS = ["street", "line1", "building", "floor", "flat", "landmark"] as const;

/** KXMHV10: the doorstep lines come back only to the owner and are masked 24 h after the visit (then only the district remains). */
export function VisitAddressView({ home }: { home: HomeBooking }) {
  const { t } = useTranslation();
  const [reveal, setReveal] = useState(false);
  const a = home.address;
  const lines = a.address ? ADDR_KEYS.map((k) => (a.address as Record<string, unknown>)[k]).filter((x): x is string => typeof x === "string" && !!x) : [];
  return (
    <section className="kx-card flex items-start gap-4 p-5" aria-labelledby="visit-addr" data-testid="visit-address">
      <IconTile tone="info"><MapPin /></IconTile>
      <div className="min-w-0 flex-1 space-y-1">
      <h2 id="visit-addr" className="text-lg">{t("hv.visitAddress")}</h2>
      <p className="text-sm" data-testid="visit-district">{[a.district, a.governorate].filter(Boolean).join(" · ")}</p>
      {a.masked ? <p className="text-sm text-muted-foreground" data-testid="address-masked">{t("hv.addressMasked")}</p> : (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm" data-testid="address-lines" aria-live="polite">{reveal ? lines.join("، ") || "—" : "••••••••"}</p>
          <Button variant="ghost" size="sm" onClick={() => setReveal((r) => !r)} aria-pressed={reveal}>{reveal ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}{reveal ? t("hv.hide") : t("hv.reveal")}</Button>
        </div>
      )}
      </div>
    </section>
  );
}

export function HomeFee({ home }: { home: HomeBooking }) {
  const { t, i18n } = useTranslation();
  const f = home.fee; const cur = f.currency || "EGP"; const m = (v: number | null) => v == null ? "—" : formatMinor(v, i18n.language, cur);
  return (
    <dl className="border-t pt-2" data-testid="home-fee">
      <Row label={t("hv.visitFee")}>{m(f.visitFeeMinor)}</Row>
      {f.homeSurchargeMinor > 0 && <Row label={t("hv.homeSurcharge")} testId="fee-surcharge">{m(f.homeSurchargeMinor)}</Row>}
      <Row label={t("hv.total")} strong testId="fee-total">{m(f.totalMinor)}</Row>
    </dl>
  );
}


/** Home timeline sub-states (KXMHV05/06): assigned, en route (+coarse ETA when the provider shares it), arrived, aborted-unsafe. */
export function HomeProgress({ home }: { home: HomeBooking }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const sub = home.subState;
  return (
    <section className="kx-card space-y-4 p-5" aria-labelledby="home-prog" data-testid="home-progress" data-substate={sub ?? "NONE"}>
      <h2 id="home-prog" className="flex items-center gap-2 text-lg"><Home className="h-5 w-5 text-primary" aria-hidden="true" />{t("hv.progressTitle")}</h2>
      {home.assignmentPending && <StatusBanner tone="warning" icon={<UserRound />} data-testid="assignment-pending">{t("hv.assignmentPending")}</StatusBanner>}
      {home.assignee && !home.aborted && (
        <div className="flex items-center gap-3 rounded-2xl bg-accent p-3.5" data-testid="assignee">
          <Avatar className="h-12 w-12 ring-2 ring-card">{home.assignee.photoUrl && <AvatarImage src={home.assignee.photoUrl} alt="" />}<AvatarFallback><UserRound aria-hidden="true" /></AvatarFallback></Avatar>
          <div className="min-w-0 space-y-1"><p className="font-semibold leading-snug">{t("hv.assignedTo", { name: home.assignee.displayName })}</p>{home.assignee.badge && <StatusChip tone="info" dot={false}><ShieldCheck className="h-3 w-3" aria-hidden="true" />{home.assignee.badge}</StatusChip>}</div>
        </div>
      )}
      {sub === "EN_ROUTE" && !home.aborted && (
        <StatusBanner tone="info" icon={<Navigation />} title={t("hv.enRoute")} data-testid="en-route">
          {home.trackingEnabled && home.eta.shared && home.eta.minutes != null && <p className="kx-label-num text-lg font-semibold" data-testid="eta">{t("hv.eta", { count: home.eta.minutes })}</p>}
        </StatusBanner>
      )}
      {sub === "ARRIVED" && !home.aborted && <StatusBanner tone="success" icon={<MapPin />} title={t("hv.arrived")} data-testid="arrived" />}
      {home.aborted ? (
        <StatusBanner tone="danger" icon={<ShieldAlert />} title={t("hv.abortedTitle")} data-testid="aborted-unsafe">
          <p>{t("hv.abortedBody")}</p>
          {home.aborted.depositUnderReview && <p className="font-medium" data-testid="deposit-review">{t("hv.depositUnderReview")}</p>}
          <p className="text-xs text-muted-foreground">{home.aborted.abortedAt ? formatDateTime(home.aborted.abortedAt, lang) : ""}</p>
        </StatusBanner>
      ) : (
        <Timeline label={t("hv.progressTitle")} testId="home-steps" steps={home.steps.map((s) => ({ key: s.key, label: t(`hv.step.${s.key}`), reached: s.reached, time: s.at ? <time className="text-xs text-muted-foreground kx-label-num" dateTime={s.at} dir="ltr">{formatTime(s.at, lang)}</time> : undefined }))} />
      )}
    </section>
  );
}

const CATS: ProblemCategory[] = ["SAFETY", "CONDUCT", "PROVIDER_NO_SHOW", "BILLING", "OTHER"];
export function ReportProblem({ bookingId, slaMinutes }: { bookingId: string; slaMinutes: number }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<ProblemCategory>("SAFETY");
  const [body, setBody] = useState("");
  const report = useReportProblem(bookingId);
  const submit = (e: FormEvent) => { e.preventDefault(); report.mutate({ category, ...(body.trim() ? { body: body.trim() } : {}) }, { onSuccess: () => { toast.success(t("hv.reported", { minutes: slaMinutes })); setOpen(false); setBody(""); }, onError: () => toast.error(t("states.errorTitle")) }); };
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)} data-testid="report-problem"><AlertTriangle aria-hidden="true" />{t("hv.reportProblem")}</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t("hv.reportProblem")}</DialogTitle><DialogDescription>{t("hv.reportSla", { minutes: slaMinutes })}</DialogDescription></DialogHeader>
          <form onSubmit={submit} className="space-y-3">
            <div className="space-y-1"><Label htmlFor="pr-cat">{t("hv.problemCategory")}</Label>
              <select id="pr-cat" value={category} onChange={(e) => setCategory(e.target.value as ProblemCategory)} className="h-11 w-full rounded-xl border border-input bg-card px-3 text-sm" data-testid="problem-category">{CATS.map((c) => <option key={c} value={c}>{t(`hv.problem.${c}`)}</option>)}</select></div>
            <div className="space-y-1"><Label htmlFor="pr-body">{t("hv.problemDetails")}</Label><Textarea id="pr-body" value={body} maxLength={1000} onChange={(e) => setBody(e.target.value)} data-testid="problem-body" /></div>
            <DialogFooter><Button type="button" variant="outline" onClick={() => setOpen(false)}>{t("appointment.keep")}</Button><Button type="submit" disabled={report.isPending} data-testid="submit-problem">{t("hv.send")}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** KXMHV09: provider photo/name/badge before arrival, the emergency number and report-a-problem. */
export function SafetyCardPanel({ bookingId }: { bookingId: string }) {
  const { t, i18n } = useTranslation();
  const q = useSafetyCard(bookingId);
  if (q.isLoading) return <CardSkeleton rows={1} />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const c = q.data!; const p = c.provider as Record<string, string | null>;
  const name = (i18n.language.startsWith("ar") ? p.displayNameAr ?? p.displayName : p.displayName ?? p.displayNameAr) ?? "";
  const sla = Number((c.reportProblem as { slaMinutes?: number }).slaMinutes ?? 60);
  return (
    <section className="kx-card space-y-4 overflow-hidden p-0" aria-labelledby="safety-title" data-testid="safety-card">
      <div className="space-y-4 p-5">
        <h2 id="safety-title" className="flex items-center gap-2 text-lg"><ShieldCheck className="h-5 w-5 text-success" aria-hidden="true" />{t("hv.safetyTitle")}</h2>
        {c.assignmentPending ? <p className="text-sm text-muted-foreground" data-testid="safety-pending">{t("hv.assignmentPending")}</p> : (
          <div className="flex items-center gap-4">
            <Avatar className="h-16 w-16 ring-4 ring-success-soft">{p.photoUrl && <AvatarImage src={p.photoUrl} alt="" />}<AvatarFallback><UserRound aria-hidden="true" /></AvatarFallback></Avatar>
            <div className="min-w-0 space-y-1"><p className="text-lg font-semibold leading-snug" data-testid="safety-name">{name}</p>{p.badge && <StatusChip tone="info" dot={false}>{p.badge}</StatusChip>}<p className="text-xs text-muted-foreground">{t("hv.safetyVerify")}</p></div>
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-2 border-t bg-muted/40 p-4">
        <a href={`tel:${c.emergencyNumber}`} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-destructive px-4 text-sm font-semibold text-destructive-foreground shadow-xs transition-transform active:scale-[0.98]" data-testid="emergency-call"><Phone className="h-4 w-4" aria-hidden="true" />{t("hv.emergencyCall", { number: c.emergencyNumber })}</a>
        <ReportProblem bookingId={bookingId} slaMinutes={sla} />
      </div>
    </section>
  );
}

const errText = (e: unknown, t: (k: string) => string) => {
  if (e instanceof ApiError) {
    if (e.code === "FAMILY_SHARE_LIMIT") return t("hv.shareLimit");
    if (e.code === "FAMILY_CONTACT_EXISTS") return t("hv.shareExists");
    if (e.code === "INVALID_PHONE") return t("hv.sharePhoneInvalid");
    if (e.code === "CONTACT_CONSENT_REQUIRED" || e.code === "CONSENT_REQUIRED") return t("hv.shareConsentNeeded");
    if (e.isFeatureDisabled) return e.isAwaitingApproval ? t("unavailable.awaitingTitle") : t("unavailable.title");
  }
  return t("states.errorTitle");
};

/** KXMHV07: family contacts follow the visit status by a WhatsApp link (max 3). Needs the contact's attestation + the patient's VISIT_STATUS_SHARING consent. */
export function FamilySharePanel({ bookingId, max = 3 }: { bookingId: string; max?: number }) {
  const { t } = useTranslation();
  const list = useFamilyShares(bookingId);
  const create = useCreateFamilyShare(bookingId);
  const revoke = useRevokeFamilyShare(bookingId);
  const [name, setName] = useState(""); const [phone, setPhone] = useState("+20"); const [attest, setAttest] = useState(false); const [consent, setConsent] = useState(false);
  const [created, setCreated] = useState<FamilyShareCreated | null>(null);
  const active = (list.data ?? []).filter((s) => s.status === "ACTIVE");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate({ contactName: name.trim(), phone: phone.trim(), locale: document.documentElement.lang === "en" ? "en" : "ar", consentAttested: attest, visitStatusSharingConsent: consent }, {
      onSuccess: (r) => { setCreated(r); setName(""); setPhone("+20"); setAttest(false); toast.success(t("hv.shareSent")); }, onError: (err) => toast.error(errText(err, t)),
    });
  };
  return (
    <section className="kx-card space-y-4 p-5" aria-labelledby="share-title" data-testid="family-share">
      <h2 id="share-title" className="flex items-center gap-2 text-lg"><HeartHandshake className="h-5 w-5 text-primary" aria-hidden="true" />{t("hv.shareTitle")}</h2>
      <p className="text-sm text-muted-foreground">{t("hv.shareBody", { max })}</p>
      <MockNotice kind="messaging" />
      {list.isLoading ? <CardSkeleton rows={1} /> : list.error ? <ErrorState error={list.error} onRetry={() => void list.refetch()} /> : active.length > 0 && (
        <ul className="space-y-2" data-testid="share-list">{active.map((s) => (
          <li key={s.id} className="flex items-center gap-3 rounded-xl border bg-card p-3" data-testid="share-row">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-semibold text-primary" aria-hidden="true">{s.contactName.trim().charAt(0).toUpperCase()}</span>
            <div className="min-w-0 flex-1"><p className="font-medium">{s.contactName}</p><p className="text-sm text-muted-foreground" dir="ltr">{s.phoneMasked}</p></div>
            <Button variant="ghost" size="icon" aria-label={t("hv.shareStop", { name: s.contactName })} disabled={revoke.isPending} onClick={() => revoke.mutate(s.id, { onSuccess: () => toast.success(t("hv.shareStopped")) })}><Trash2 className="text-destructive" aria-hidden="true" /></Button>
          </li>))}</ul>
      )}
      {created && (
        <StatusBanner tone="success" icon={<MessageCircle />} title={t("hv.shareLinkTitle", { name: created.contactName })} data-testid="share-link">
          <p className="break-all text-xs" dir="ltr">{created.link}</p>
          <Button size="sm" variant="outline" onClick={() => void navigator.clipboard?.writeText(created.link).then(() => toast.success(t("doctor.linkCopied")))}><Copy aria-hidden="true" />{t("hv.copyLink")}</Button>
        </StatusBanner>
      )}
      {active.length >= max ? <p className="text-sm text-muted-foreground" data-testid="share-full">{t("hv.shareLimit")}</p> : (
        <form onSubmit={submit} className="space-y-3" aria-label={t("hv.shareAdd")}>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1"><Label htmlFor="fs-name">{t("hv.shareName")}</Label><Input id="fs-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} data-testid="share-name" /></div>
            <div className="space-y-1"><Label htmlFor="fs-phone">{t("hv.sharePhone")}</Label><Input id="fs-phone" dir="ltr" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} data-testid="share-phone" /></div>
          </div>
          <label className="flex min-h-11 items-start gap-3 rounded-xl border bg-muted/30 p-3"><Checkbox checked={attest} onCheckedChange={(c) => setAttest(c === true)} className="mt-0.5" data-testid="share-attest" /><span className="text-sm">{t("hv.shareAttest")}</span></label>
          <label className="flex min-h-11 items-start gap-3 rounded-xl border bg-muted/30 p-3"><Checkbox checked={consent} onCheckedChange={(c) => setConsent(c === true)} className="mt-0.5" data-testid="share-consent" /><span className="text-sm">{t("hv.shareConsent")}</span></label>
          <Button type="submit" disabled={!name.trim() || phone.trim().length < 9 || !attest || !consent || create.isPending} data-testid="share-submit">{t("hv.shareSend")}</Button>
        </form>
      )}
    </section>
  );
}
