import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { CalendarClock, Languages, Link2, Phone, ShieldCheck } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useDoctor, useDoctorReviews, useSlots, useSpecialties } from "@/api/hooks";
import { ApiError } from "@/api/errors";
import { CardSkeleton, EmptyState, ErrorState, LoadingState } from "@/components/states";
import { VerifiedBadge } from "@/components/VerifiedBadge";
import { Rating } from "@/components/StarRating";
import { SlotButton } from "@/components/SlotButton";
import { SlotTakenDialog } from "@/components/SlotTakenDialog";
import { ClinicMap } from "@/components/ClinicMap";
import { WaitlistJoin } from "@/components/WaitlistJoin";
import { PulseDivider } from "@/components/PulseLine";
import { FamilySwitcher } from "@/components/FamilySwitcher";
import { useAuth } from "@/auth/AuthProvider";
import { useStartBooking } from "@/hooks/useStartBooking";
import { dayKey, formatDay, formatDayLong, formatMoney, formatTime, pick } from "@/lib/format";
import { pushRecent } from "@/lib/recent";
import { cn } from "@/lib/utils";
import type { Slot } from "@/api/types";

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
  const { status: authStatus } = useAuth();

  const visitTypes = doctor.data?.visitTypes;
  const activeVt = visitTypes?.find((v) => v.id === vtId) ?? visitTypes?.[0];
  const slots = useSlots(id, activeVt?.id);

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
  const spec = specialties.data?.find((s) => s.code === d.specialtyCode);
  const policy = pick(p.cancellationPolicy, "text", lang);
  const dayList = days.find(([k]) => k === day)?.[1] ?? [];
  const bio = pick(p, "bio", lang);
  const share = async () => {
    try { await navigator.clipboard.writeText(window.location.origin + `/doctors/${d.id}`); toast.success(t("doctor.linkCopied")); } catch { toast.error(t("doctor.linkCopyFailed")); }
  };

  return (
    <div className="space-y-8">
      <header className="kx-card flex flex-col gap-5 p-6 sm:flex-row sm:items-center">
        <Avatar className="h-24 w-24">
          {d.photoUrl && <AvatarImage src={d.photoUrl} alt="" />}
          <AvatarFallback className="bg-accent text-3xl font-semibold text-primary">{name.replace(/^(د\.|Dr\.)\s*/, "").slice(0, 1)}</AvatarFallback>
        </Avatar>
        <div className="flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2"><h1 className="text-2xl" data-testid="doctor-name">{name}</h1>{d.verified && <VerifiedBadge />}</div>
          <p className="text-muted-foreground">{spec ? pick(spec, "name", lang) : d.specialtyCode} · {pick(d, "clinicName", lang)}</p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <Rating avg={d.ratingAvg} count={d.ratingCount} />
            <span className="inline-flex items-center gap-1"><Languages className="h-4 w-4 text-muted-foreground" aria-hidden="true" />{d.languages.map((l) => (l === "ar" ? "العربية" : l === "en" ? "English" : l)).join(" · ")}</span>
          </div>
        </div>
        <Button variant="outline" onClick={() => void share()}><Link2 aria-hidden="true" />{t("doctor.share")}</Button>
      </header>

      {bio && <p className="max-w-3xl text-muted-foreground">{bio}</p>}

      <section aria-labelledby="book-title" className="space-y-4">
        <h2 id="book-title" className="flex items-center gap-2 text-xl"><CalendarClock className="h-5 w-5 text-ocean" aria-hidden="true" />{t("doctor.bookTitle")}</h2>
        <div role="radiogroup" aria-label={t("doctor.visitType")} className="flex flex-wrap gap-2">
          {visitTypes?.map((v) => (
            <button key={v.id} type="button" role="radio" aria-checked={activeVt?.id === v.id} data-active={activeVt?.id === v.id} className="kx-chip" onClick={() => { setVtId(v.id); setSelected(null); setDay(null); }}>
              <span>{pick(v, "name", lang)}</span><b className="kx-label-num">{formatMoney(v.feeEgp, lang)}</b>
              {v.depositRequired && v.depositEgp != null && <Badge variant="warning">{t("doctor.deposit", { amount: formatMoney(v.depositEgp, lang) })}</Badge>}
            </button>
          ))}
        </div>

        {slots.isLoading ? <CardSkeleton rows={1} /> : slots.error ? <ErrorState error={slots.error} onRetry={() => void slots.refetch()} /> : days.length === 0 ? (
          <div className="space-y-4" data-testid="no-slots"><EmptyState title={t("doctor.noSlots")} hint={t("doctor.noSlotsHint")} /><WaitlistJoin providerId={d.id} typeId={activeVt?.id} /></div>
        ) : (
          <div className="kx-card space-y-4 p-5" data-testid="slot-calendar">
            <div className="-mx-1 overflow-x-auto px-1" role="tablist" aria-label={t("doctor.days")}>
              <div className="flex gap-2">
                {days.map(([k, list]) => (
                  <button key={k} role="tab" aria-selected={day === k} onClick={() => setDay(k)} className={cn("flex min-h-14 min-w-[4.75rem] shrink-0 flex-col items-center justify-center rounded-xl border px-3 text-sm", day === k ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-accent")}>
                    <span className="font-medium">{formatDay(list[0].startsAt, lang)}</span>
                    <span className="text-xs opacity-80">{t("doctor.slotsCount", { count: list.length })}</span>
                  </button>
                ))}
              </div>
            </div>
            <p className="text-sm text-muted-foreground">{day && dayList[0] ? formatDayLong(dayList[0].startsAt, lang) : ""}</p>
            <div className="flex flex-wrap gap-2" role="group" aria-label={t("doctor.times")}>
              {dayList.map((s) => <SlotButton key={s.slotId} slot={s} showDay={false} selected={selected?.slotId === s.slotId} onPick={setSelected} />)}
            </div>
          </div>
        )}

        {/* KXMPR04: cancellation policy is shown BEFORE the patient commits to a booking. */}
        <aside className="flex gap-3 rounded-xl border border-ocean/30 bg-info-soft p-4" aria-labelledby="policy-title" data-testid="cancellation-policy">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-info" aria-hidden="true" />
          <div><h3 id="policy-title" className="font-semibold text-info">{t("doctor.policyTitle")}</h3><p className="text-sm">{policy}</p></div>
        </aside>

        <div className="sticky bottom-20 z-30 md:static">
          <div className="kx-card flex flex-wrap items-center justify-between gap-3 p-4">
            {authStatus === "signedIn" && <div className="w-full"><p className="mb-1 text-xs font-medium text-muted-foreground">{t("doctor.bookingFor")}</p><FamilySwitcher /></div>}
            <p className="text-sm" aria-live="polite" data-testid="selected-slot">
              {selected ? <>{t("doctor.selected")}: <b>{formatDay(selected.startsAt, lang)} · <span dir="ltr">{formatTime(selected.startsAt, lang)}</span></b></> : t("doctor.pickSlot")}
            </p>
            <Button size="lg" disabled={!selected || booking.isPending} onClick={() => selected && booking.start(d.id, selected)} data-testid="continue-booking">
              {booking.isPending ? t("states.loading") : t("doctor.continue")}
            </Button>
          </div>
        </div>
      </section>

      <PulseDivider />

      <section aria-labelledby="reviews-title" className="space-y-4">
        <div className="flex items-center justify-between"><h2 id="reviews-title" className="text-xl">{t("doctor.reviews")}</h2>{reviews.data && <Rating avg={reviews.data.ratingAvg} count={reviews.data.ratingCount} />}</div>
        {reviews.isLoading ? <CardSkeleton rows={1} /> : reviews.error ? <ErrorState error={reviews.error} onRetry={() => void reviews.refetch()} /> : reviews.data!.items.length === 0 ? (
          <EmptyState title={t("doctor.noReviews")} hint={t("doctor.noReviewsHint")} />
        ) : (
          <ul className="space-y-3">
            {reviews.data!.items.slice(0, 20).map((r) => (
              <li key={r.id} className="kx-card space-y-2 p-4" data-testid="review">
                <div className="flex items-center justify-between"><Rating avg={r.rating} count={1} /><span className="text-xs text-muted-foreground"><Badge variant="info">{t("doctor.verifiedVisit")}</Badge> · {formatDay(r.createdAt, lang)}</span></div>
                {r.text && <p>{r.text}</p>}
                {r.clinicReply && <div className="rounded-lg bg-muted p-3 text-sm"><b>{t("doctor.clinicReply")}</b><p>{r.clinicReply.text}</p></div>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="clinic-title" className="space-y-3">
        <h2 id="clinic-title" className="text-xl">{t("doctor.clinic")}</h2>
        <ClinicMap clinic={p.clinic} />
        <div className="flex flex-wrap gap-4 text-sm">
          <a className="inline-flex min-h-11 items-center gap-2 text-ocean underline underline-offset-4" href={`tel:${p.clinic.phone.replace(/\s/g, "")}`}><Phone className="h-4 w-4" aria-hidden="true" /><span dir="ltr">{p.clinic.phone}</span></a>
          <span className="inline-flex min-h-11 items-center text-muted-foreground">{(lang.startsWith("ar") ? p.clinic.hoursAr : p.clinic.hoursEn).join(" · ")}</span>
        </div>
      </section>

      <SlotTakenDialog alternatives={booking.alternatives} onClose={booking.clearAlternatives} onPick={(s) => { booking.clearAlternatives(); setSelected(s); setDay(dayKey(s.startsAt)); }} />
    </div>
  );
}
