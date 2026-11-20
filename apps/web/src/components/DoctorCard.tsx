import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowUpRight, Clock, MapPin, Wallet } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatMoney, formatNumber, pick } from "@/lib/format";
import { SponsoredLabel } from "@/components/ChannelBadge";
import { track } from "@/lib/analytics";
import type { DoctorSummary, Slot, Specialty } from "@/api/types";
import { VerifiedBadge } from "./VerifiedBadge";
import { Rating } from "./StarRating";
import { DoctorAvatar } from "./DoctorAvatar";
import { StatusChip } from "./kit";
import { specialtyLabel } from "@/lib/specialties";
import { SpecialtyIcon } from "@/components/SpecialtyIcon";
import { districtLabel } from "@/lib/districts";
import { SlotButton } from "./SlotButton";

export function DoctorCard({ doctor, specialties, onPickSlot }: { doctor: DoctorSummary; specialties?: Specialty[]; onPickSlot: (d: DoctorSummary, s: Slot) => void }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const name = pick(doctor, "name", lang);
  const homeOnly = !!doctor.serviceLocations && !doctor.serviceLocations.includes("IN_CLINIC") && doctor.serviceLocations.includes("HOME");
  return (
    <article className="kx-card kx-card-interactive p-4 sm:p-5" data-testid="doctor-card" aria-label={name}>
      <div className="flex gap-4">
        <DoctorAvatar name={name} photoUrl={doctor.photoUrl} verified={doctor.verified} size="lg" />
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="text-lg leading-snug"><Link to={`/doctors/${doctor.id}`} className="hover:text-primary hover:underline hover:underline-offset-4">{name}</Link></h3>
            {doctor.verified && <VerifiedBadge />}
            {doctor.sponsored && <SponsoredLabel />}
            {doctor.badge && <Badge variant="info" data-testid="profession-badge">{lang.startsWith("ar") ? doctor.badge.ar : doctor.badge.en}</Badge>}
          </div>
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground"><SpecialtyIcon code={doctor.specialtyCode} className="h-[18px] w-[18px] text-primary" /><span>{specialtyLabel(doctor.specialtyCode, lang, specialties)} · {pick(doctor, "clinicName", lang)}</span></p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
            <Rating avg={doctor.ratingAvg} count={doctor.ratingCount} />
            <span className="inline-flex items-center gap-1.5"><Wallet className="h-4 w-4 text-muted-foreground" aria-hidden="true" /><span className="kx-label-num font-semibold">{t("doctor.feeFrom", { fee: formatMoney(doctor.feeFromEgp, lang) })}</span></span>
            {(!!pick(doctor, "area", lang) || doctor.distanceKm != null) && <span className="inline-flex items-center gap-1.5 text-muted-foreground"><MapPin className="h-4 w-4" aria-hidden="true" />{pick(doctor, "area", lang)}{doctor.distanceKm != null && `${pick(doctor, "area", lang) ? " · " : ""}${t("doctor.distance", { km: formatNumber(doctor.distanceKm, lang) })}`}</span>}
          </div>
          {(doctor.depositRequired || doctor.serviceLocations?.includes("HOME")) && (
            <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
              {doctor.depositRequired && <StatusChip tone="warning">{t("doctor.depositRequired")}</StatusChip>}
              {doctor.serviceLocations?.includes("HOME") && <StatusChip tone="success" data-testid="home-badge">{t("hv.homeVisits")}{doctor.homeFeeEgp ? ` · ${formatMoney(doctor.homeFeeEgp, lang)}` : ""}</StatusChip>}
            </div>
          )}
          {doctor.serviceLocations?.includes("HOME") && !!doctor.coverageDistricts?.length && <p className="text-xs text-muted-foreground" data-testid="coverage">{t("hv.visitsIn", { districts: doctor.coverageDistricts.map((d) => districtLabel(d, lang)).join(" · ") })}</p>}
        </div>
      </div>
      <div className="mt-4 rounded-xl bg-muted/60 p-3 dark:bg-muted/40">
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground"><Clock className="h-3.5 w-3.5 text-ocean" aria-hidden="true" />{t("results.nextSlots")}</p>
          <Link to={`/doctors/${doctor.id}`} className="inline-flex items-center gap-1 text-xs font-semibold text-ocean hover:underline">{t("results.viewProfile")}<ArrowUpRight className="rtl-flip h-3.5 w-3.5" aria-hidden="true" /></Link>
        </div>
        {homeOnly ? (
          <p className="text-sm text-muted-foreground" data-testid="home-only">{t("hv.homeOnlyHint")} <Link to={`/doctors/${doctor.id}?loc=home`} className="text-ocean underline underline-offset-4">{t("hv.seeHomeTimes")}</Link></p>
        ) : !doctor.bookable ? (
          <p className="text-sm text-muted-foreground" data-testid="not-bookable">{t("results.callClinic")} {doctor.clinicPhone && <a className="text-ocean underline underline-offset-4" dir="ltr" href={`tel:${doctor.clinicPhone.replace(/\s/g, "")}`}>{doctor.clinicPhone}</a>}</p>
        ) : doctor.nextSlots.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("results.noSlots")} <Link to={`/doctors/${doctor.id}`} className="text-ocean underline underline-offset-4" data-testid="card-waitlist-link">{t("waitlist.joinShort")}</Link></p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {doctor.nextSlots.slice(0, 4).map((s) => (
              <SlotButton key={s.slotId} slot={s} onPick={(sl) => { track("slot_viewed", { providerId: doctor.id }); onPickSlot(doctor, sl); }} />
            ))}
          </div>
        )}
      </div>
    </article>
  );
}
