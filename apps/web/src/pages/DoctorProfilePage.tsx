import { districtLabel } from "@/lib/districts";
import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { BadgeCheck, CalendarClock, Clock, Home, Hospital, Languages, Link2, Lock, MapPin, Phone, ShieldCheck, Wallet } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useDoctor, useDoctorReviews, useSlots, useSpecialties } from "@/api/hooks";
import { ApiError } from "@/api/errors";
import { CardSkeleton, EmptyState, ErrorState, LoadingState } from "@/components/states";
import { VerifiedBadge } from "@/components/VerifiedBadge";
import { Rating } from "@/components/StarRating";
import { SlotPicker } from "@/components/SlotPicker";
import { ReviewSummary } from "@/components/ReviewSummary";
import { DoctorAvatar } from "@/components/DoctorAvatar";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { relativeDay } from "@/lib/format";
import { SlotTakenDialog } from "@/components/SlotTakenDialog";
import { ClinicMap } from "@/components/ClinicMap";
import { WaitlistJoin } from "@/components/WaitlistJoin";
import { FamilySwitcher } from "@/components/FamilySwitcher";
import { useAuth } from "@/auth/AuthProvider";
import { useStartBooking } from "@/hooks/useStartBooking";
import { dayKey, formatDay, formatMoney, formatTime, pick } from "@/lib/format";
import { pushRecent } from "@/lib/recent";
import { specialtyLabel } from "@/lib/specialties";
import { cn } from "@/lib/utils";
import type { ServiceLocation, Slot } from "@/api/types";
import { useHomeSlots, type Address } from "@/api/home";
import { HomeVisitPicker, covers } from "@/components/HomeVisitPicker";
import { UnavailableState } from "@/components/states";
import { useFeature } from "@/hooks/useFeature";

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return <section aria-labelledby={id} className="space-y-4"><h2 id={id} className="kx-section-title">{title}</h2>{children}</section>;
}

export default function DoctorProfilePage() {
  const { id = "" } = useParams();
  const [sp] = useSearchParams();
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const doctor = useDoctor(id);
  const reviews = useDoctorReviews(id);
  const specialties = useSpecialties();
  const [vtId, setVtId] = useState<string | undefined>(sp.get("vt") ?? undefined);
  const [selected, setSelected] = useState<Slot | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const booking = useStartBooking();
  const desktop = useMediaQuery("(min-width: 1024px)");
  const [sheetOpen, setSheetOpen] = useState(false);
  const { status: authStatus } = useAuth();

  const homeFlag = useFeature("kiorex.home_visits");
  const [locSel, setLocSel] = useState<ServiceLocation | null>(sp.get("loc") === "home" ? "HOME" : null);
  const [addr, setAddr] = useState<Address | undefined>();
  const offersHome = !!doctor.data?.serviceLocations.includes("HOME");
  const offersClinic = !doctor.data?.serviceLocations || doctor.data.serviceLocations.includes("IN_CLINIC");
  const loc: ServiceLocation = locSel ?? (offersClinic ? "IN_CLINIC" : "HOME");
  const homeUnlocked = homeFlag.enabled && !!doctor.data?.home.enabled;
  const isHome = loc === "HOME" && offersHome;
  const coverage = doctor.data?.home.coverageDistricts ?? [];
  const homeReady = isHome && homeUnlocked && !!addr && covers(coverage, addr.district);
  const visitTypes = doctor.data?.visitTypes.filter((v) => (v.serviceLocation ?? "IN_CLINIC") === (isHome ? "HOME" : "IN_CLINIC"));
  const activeVt = visitTypes?.find((v) => v.id === vtId) ?? visitTypes?.[0];
  const clinicSlots = useSlots(id, isHome ? undefined : activeVt?.id);
  const homeSlots = useHomeSlots(id, homeReady ? activeVt?.id : undefined, addr?.district);
  const slots = isHome ? homeSlots : clinicSlots;

  useEffect(() => {
    const d = doctor.data?.summary;
    if (d) pushRecent({ id: d.id, nameAr: d.nameAr, nameEn: d.nameEn, specialtyCode: d.specialtyCode });
  }, [doctor.data]);

  const days = useMemo(() => {
    const m = new Map<string, Slot[]>();
    for (const s of slots.data ?? []) { const k = dayKey(s.startsAt); m.set(k, [...(m.get(k) ?? []), s]); }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [slots.data]);

  useEffect(() => {
    const pre = sp.get("slot");
    const hit = pre ? slots.data?.find((s) => s.slotId === pre) : undefined;
    if (hit) { setSelected(hit); setDay(dayKey(hit.startsAt)); }
  }, [slots.data, sp]);
  useEffect(() => { if (!day && days.length) setDay(days[0][0]); }, [days, day]);

  if (doctor.isLoading) return <LoadingState />;
  if (doctor.error) {
    const nf = doctor.error instanceof ApiError && doctor.error.status === 404;
    return nf ? <EmptyState title={t("doctor.notFound")} /> : <ErrorState error={doctor.error} onRetry={() => void doctor.refetch()} />;
  }
  const p = doctor.data!;
  const d = p.summary;
  const name = pick(d, "name", lang);

  const cp = p.cancellationPolicy;
  const policy = pick(cp, "text", lang) || [cp.freeCancelHoursBefore > 0 ? t("doctor.policyFree", { hours: cp.freeCancelHoursBefore }) : t("doctor.policyClinic"), cp.depositRefundable ? t("doctor.policyDeposit") : ""].filter(Boolean).join(" ");
  const nextSlot = days[0]?.[1][0];
  const bio = pick(p, "bio", lang);
  const share = async () => {
    try { await navigator.clipboard.writeText(window.location.origin + `/doctors/${d.id}`); toast.success(t("doctor.linkCopied")); } catch { toast.error(t("doctor.linkCopyFailed")); }
  };

  const subs = (lang.startsWith("ar") ? p.subSpecialtiesAr : p.subSpecialtiesEn) ?? [];
  const langs = d.languages.map((l) => (l === "ar" ? "العربية" : l === "en" ? "English" : l)).join(" · ");
  const hours = (lang.startsWith("ar") ? p.clinic.hoursAr : p.clinic.hoursEn).join(" · ");
  const canContinue = !!selected && !booking.isPending && p.categoryEnabled && !(isHome && !homeReady);
  const go = () => selected && booking.start(d.id, selected, isHome && addr ? { addressId: addr.id } : undefined);
  const reset = () => { setSelected(null); setDay(null); };

  const panel = (
    <div className="space-y-5" data-testid="booking-panel">
      <div className="flex items-end justify-between gap-3">
        <h2 id="book-title" className="flex items-center gap-2 text-xl"><CalendarClock className="h-5 w-5 text-ocean" aria-hidden="true" />{t("doctor.bookTitle")}</h2>
        <p className="kx-label-num text-sm text-muted-foreground">{t("doctor.feeFrom", { fee: formatMoney(d.feeFromEgp, lang) })}</p>
      </div>
      {!p.categoryEnabled && <div role="status" className="rounded-xl border border-warning/50 bg-warning-soft p-4 text-sm text-warning" data-testid="category-awaiting">{t("hv.categoryAwaitingProfile")}</div>}
      {offersHome && (
        <div role="radiogroup" aria-label={t("hv.whereLabel")} className="grid grid-cols-2 gap-1 rounded-xl bg-muted p-1" data-testid="service-location">
          {offersClinic && <button type="button" role="radio" aria-checked={!isHome} className={cn("flex min-h-11 items-center justify-center gap-2 rounded-[10px] text-sm font-semibold transition-colors", !isHome ? "bg-card text-primary shadow-raised" : "text-muted-foreground")} data-testid="loc-clinic" onClick={() => { setLocSel("IN_CLINIC"); setVtId(undefined); reset(); }}><Hospital className="h-4 w-4" aria-hidden="true" />{t("hv.atClinic")}</button>}
          <button type="button" role="radio" aria-checked={isHome} className={cn("flex min-h-11 items-center justify-center gap-2 rounded-[10px] text-sm font-semibold transition-colors", isHome ? "bg-card text-primary shadow-raised" : "text-muted-foreground")} data-testid="loc-home" onClick={() => { setLocSel("HOME"); setVtId(undefined); reset(); }}>
            <Home className="h-4 w-4" aria-hidden="true" />{t("hv.atHome")}{!homeUnlocked && <Lock className="h-3.5 w-3.5" aria-hidden="true" />}</button>
        </div>
      )}
      {isHome && !homeUnlocked && <UnavailableState featureKey="kiorex.home_visits" awaiting={homeFlag.awaiting || !homeFlag.enabled} />}
      {isHome && homeUnlocked && (
        <>
          {p.home.surchargeEgp > 0 && <p className="text-sm text-muted-foreground" data-testid="home-surcharge">{t("hv.surchargeNote", { amount: formatMoney(p.home.surchargeEgp, lang) })}</p>}
          {coverage.length > 0 && <p className="text-sm text-muted-foreground">{t("hv.visitsIn", { districts: coverage.map((x) => districtLabel(x, i18n.language)).join(" · ") })}</p>}
          <HomeVisitPicker coverageDistricts={coverage} value={addr?.id} onChange={setAddr} />
          {homeSlots.error instanceof ApiError && homeSlots.error.code === "OUT_OF_COVERAGE" && <div role="alert" className="rounded-xl border border-destructive/40 bg-card p-4 text-sm" data-testid="out-of-coverage-api"><b>{t("hv.outOfCoverageTitle")}</b> {t("hv.outOfCoverageBody")}</div>}
        </>
      )}
      <div role="radiogroup" aria-label={t("doctor.visitType")} className="space-y-2">
        {visitTypes?.map((v) => {
          const on = activeVt?.id === v.id;
          return (
            <button key={v.id} type="button" role="radio" aria-checked={on} data-active={on} onClick={() => { setVtId(v.id); reset(); }}
              className={cn("flex w-full items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3 text-start transition-colors hover:border-primary", on && "border-primary bg-accent ring-1 ring-primary")}>
              <span className="min-w-0">
                <span className="block font-semibold">{pick(v, "name", lang)}</span>
                <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground"><span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" aria-hidden="true" />{t("doctor.minutes", { count: v.durationMin })}</span>
                  {isHome && !!v.surchargeEgp && <span>{t("hv.inclSurcharge")}</span>}
                  {v.depositRequired && v.depositEgp != null && <span className="font-medium text-warning">{t("doctor.deposit", { amount: formatMoney(v.depositEgp, lang) })}</span>}</span>
              </span>
              <b className="kx-label-num shrink-0 text-base">{formatMoney(v.feeEgp, lang)}</b>
            </button>
          );
        })}
      </div>

      {isHome && !homeReady ? null : slots.isLoading ? <CardSkeleton rows={1} /> : slots.error ? (slots.error instanceof ApiError && slots.error.code === "OUT_OF_COVERAGE" ? null : <ErrorState error={slots.error} onRetry={() => void slots.refetch()} />) : days.length === 0 ? (
        <div className="space-y-4" data-testid="no-slots"><EmptyState title={t("doctor.noSlots")} hint={t("doctor.noSlotsHint")} /><WaitlistJoin providerId={d.id} typeId={activeVt?.id} /></div>
      ) : (
        <SlotPicker days={days} day={day} onDay={setDay} selected={selected} onSelect={setSelected} />
      )}

      {/* KXMPR04: cancellation policy is shown BEFORE the patient commits to a booking. */}
      <aside className="flex gap-3 rounded-xl border border-ocean/30 bg-info-soft p-4" aria-labelledby="policy-title" data-testid="cancellation-policy">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-info" aria-hidden="true" />
        <div><h3 id="policy-title" className="text-sm font-semibold text-info">{t("doctor.policyTitle")}</h3><p className="text-sm">{policy}</p></div>
      </aside>

      <div className="space-y-3 border-t pt-4">
        {authStatus === "signedIn" && <div><p className="mb-1.5 text-xs font-medium text-muted-foreground">{t("doctor.bookingFor")}</p><FamilySwitcher /></div>}
        <p className="text-sm" aria-live="polite" data-testid="selected-slot">
          {selected ? <>{t("doctor.selected")}: <b>{formatDay(selected.startsAt, lang)} · <span dir="ltr">{formatTime(selected.startsAt, lang)}</span></b></> : t("doctor.pickSlot")}
        </p>
        <Button size="lg" className="w-full" disabled={!canContinue} onClick={go} data-testid="continue-booking">
          {booking.isPending ? t("states.loading") : t("doctor.continue")}
        </Button>
      </div>
    </div>
  );

  const nextRel = nextSlot ? relativeDay(nextSlot.startsAt) : null;

  return (
    <div className="space-y-8 pb-20 lg:pb-0">
      <header className="kx-card overflow-hidden p-0">
        <div className="kx-hero relative h-24 border-b sm:h-32" aria-hidden="true">
          <svg className="absolute inset-x-0 bottom-3 h-6 w-full text-primary/20" viewBox="0 0 240 24" preserveAspectRatio="none"><path d="M0 12 H90 l5 -8 l6 16 l7 -22 l6 20 l4 -6 H240" fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </div>
        <div className="flex flex-col gap-5 px-5 pb-6 sm:flex-row sm:items-end sm:px-8">
          <DoctorAvatar name={name} photoUrl={d.photoUrl} verified={d.verified} size="xl" className="-mt-14 self-start sm:-mt-16 sm:self-auto" />
          <div className="flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-2"><h1 className="text-2xl md:text-3xl" data-testid="doctor-name">{name}</h1>{d.verified && <VerifiedBadge />}{d.badge && <Badge variant="info" data-testid="profession-badge">{lang.startsWith("ar") ? d.badge.ar : d.badge.en}</Badge>}</div>
            <p className="text-muted-foreground">{specialtyLabel(d.specialtyCode, lang, specialties.data)} · {pick(d, "clinicName", lang)}</p>
            {d.assignsClinician && <p className="text-sm text-muted-foreground" data-testid="agency-note">{t("hv.agencyAssigns")}</p>}
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm">
              <Rating avg={d.ratingAvg} count={d.ratingCount} />
              <span className="inline-flex items-center gap-1.5"><Wallet className="h-4 w-4 text-muted-foreground" aria-hidden="true" /><span className="kx-label-num font-semibold">{t("doctor.feeFrom", { fee: formatMoney(d.feeFromEgp, lang) })}</span></span>
              <span className="inline-flex items-center gap-1.5 text-muted-foreground"><Languages className="h-4 w-4" aria-hidden="true" />{langs}</span>
              {offersClinic && !!pick(d, "area", lang) && <span className="inline-flex items-center gap-1.5 text-muted-foreground"><MapPin className="h-4 w-4" aria-hidden="true" />{pick(d, "area", lang)}</span>}
            </div>
          </div>
          <Button variant="outline" onClick={() => void share()}><Link2 aria-hidden="true" />{t("doctor.share")}</Button>
        </div>
      </header>

      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_400px]">
        <div className="min-w-0 space-y-10">
          {bio && <Section id="about-title" title={t("doctor.about")}><p className="max-w-3xl leading-relaxed text-muted-foreground">{bio}</p></Section>}

          <Section id="cred-title" title={t("doctor.credentials")}>
            <ul className="kx-card divide-y" data-testid="credentials">
              <li className="flex gap-3 p-4"><BadgeCheck className={cn("mt-0.5 h-5 w-5 shrink-0", d.verified ? "text-ocean" : "text-muted-foreground")} aria-hidden="true" /><div><p className="font-medium">{d.verified ? t("doctor.credVerified") : t("doctor.credPending")}</p><p className="text-sm text-muted-foreground">{t("doctor.credBody")}</p></div></li>
              {subs.length > 0 && <li className="p-4"><p className="mb-2 text-sm font-medium">{t("doctor.subSpecialties")}</p><div className="flex flex-wrap gap-2">{subs.map((x) => <span key={x} className="rounded-full bg-accent px-3 py-1 text-sm text-accent-foreground">{x}</span>)}</div></li>}
              <li className="flex items-center gap-3 p-4"><Languages className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" /><div><p className="text-sm font-medium">{t("doctor.languagesSpoken")}</p><p className="text-sm text-muted-foreground">{langs}</p></div></li>
            </ul>
          </Section>

          {offersClinic && (
            <Section id="clinic-title" title={t("doctor.clinic")}>
              <ClinicMap clinic={p.clinic} />
              <div className="kx-card grid gap-px divide-y text-sm sm:grid-cols-2 sm:divide-x sm:divide-y-0 sm:rtl:divide-x-reverse">
                <a className="flex min-h-14 items-center gap-3 p-4 text-ocean hover:bg-accent" href={`tel:${p.clinic.phone.replace(/\s/g, "")}`}><Phone className="h-4 w-4" aria-hidden="true" /><span dir="ltr" className="font-medium">{p.clinic.phone}</span></a>
                <div className="flex min-h-14 items-center gap-3 p-4 text-muted-foreground"><Clock className="h-4 w-4 shrink-0" aria-hidden="true" />{hours || t("doctor.hoursUnknown")}</div>
              </div>
            </Section>
          )}

          <section aria-labelledby="reviews-title" className="space-y-4">
            <h2 id="reviews-title" className="kx-section-title">{t("doctor.reviews")}</h2>
            {reviews.isLoading ? <CardSkeleton rows={1} /> : reviews.error ? <ErrorState error={reviews.error} onRetry={() => void reviews.refetch()} /> : reviews.data!.items.length === 0 ? (
              <EmptyState title={t("doctor.noReviews")} hint={t("doctor.noReviewsHint")} />
            ) : (
              <>
                <ReviewSummary avg={reviews.data!.ratingAvg} count={reviews.data!.ratingCount} items={reviews.data!.items} />
                <ul className="space-y-3">
                  {reviews.data!.items.slice(0, 20).map((r) => (
                    <li key={r.id} className="kx-card space-y-2 p-4" data-testid="review">
                      <div className="flex flex-wrap items-center justify-between gap-2"><Rating avg={r.rating} count={1} /><span className="flex items-center gap-2 text-xs text-muted-foreground"><Badge variant="info">{t("doctor.verifiedVisit")}</Badge>{formatDay(r.createdAt, lang)}</span></div>
                      {r.text && <p>{r.text}</p>}
                      {r.clinicReply && <div className="rounded-lg bg-muted p-3 text-sm"><b>{t("doctor.clinicReply")}</b><p>{r.clinicReply.text}</p></div>}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        </div>

        {desktop ? (
          <aside aria-labelledby="book-title" className="kx-card sticky top-24 p-5 shadow-float">{panel}</aside>
        ) : (
          <>
            <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-card/95 px-4 py-3 backdrop-blur-md" style={{ bottom: authStatus === "signedIn" ? "3.5rem" : 0 }} data-testid="booking-bar">
              <div className="container flex items-center justify-between gap-3 px-0">
                <div className="min-w-0 text-sm">
                  <p className="text-xs text-muted-foreground">{selected ? t("doctor.selected") : t("doctor.nextAvailable")}</p>
                  <p className="truncate font-semibold">{selected ? <>{formatDay(selected.startsAt, lang)} · <span dir="ltr">{formatTime(selected.startsAt, lang)}</span></> : nextSlot ? <>{nextRel ? t(`results.${nextRel}`) : formatDay(nextSlot.startsAt, lang)} · <span dir="ltr">{formatTime(nextSlot.startsAt, lang)}</span></> : t("doctor.feeFrom", { fee: formatMoney(d.feeFromEgp, lang) })}</p>
                </div>
                <Button size="lg" onClick={() => (canContinue ? go() : setSheetOpen(true))} data-testid="open-booking">{canContinue ? t("doctor.continue") : t("doctor.bookTitle")}</Button>
              </div>
            </div>
            <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
              <SheetContent side="bottom" className="max-h-[92dvh] overflow-y-auto rounded-t-3xl p-5 pb-8" data-testid="booking-sheet">
                <span className="mx-auto mb-3 block h-1.5 w-10 rounded-full bg-border" aria-hidden="true" />
                <SheetHeader className="sr-only"><SheetTitle>{t("doctor.bookTitle")}</SheetTitle><SheetDescription>{t("doctor.sheetHint")}</SheetDescription></SheetHeader>
                {panel}
              </SheetContent>
            </Sheet>
          </>
        )}
      </div>

      <SlotTakenDialog alternatives={booking.alternatives} onClose={booking.clearAlternatives} onPick={(s) => { booking.clearAlternatives(); setSelected(s); setDay(dayKey(s.startsAt)); }} />
    </div>
  );
}
