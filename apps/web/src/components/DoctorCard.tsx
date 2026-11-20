import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { MapPin, Wallet } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { formatMoney, formatNumber, pick } from "@/lib/format";
import { SponsoredLabel } from "@/components/ChannelBadge";
import { track } from "@/lib/analytics";
import type { DoctorSummary, Slot, Specialty } from "@/api/types";
import { VerifiedBadge } from "./VerifiedBadge";
import { Rating } from "./StarRating";
import { specialtyLabel } from "@/lib/specialties";
import { districtLabel } from "@/lib/districts";
import { SlotButton } from "./SlotButton";

export function DoctorCard({ doctor, specialties, onPickSlot }: { doctor: DoctorSummary; specialties?: Specialty[]; onPickSlot: (d: DoctorSummary, s: Slot) => void }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const name = pick(doctor, "name", lang);
  return (
    <article className="kx-card p-5" data-testid="doctor-card" aria-label={name}>
      <div className="flex gap-4">
        <Avatar className="h-16 w-16">
          {doctor.photoUrl && <AvatarImage src={doctor.photoUrl} alt="" />}
          <AvatarFallback className="bg-accent text-lg font-semibold text-primary">{name.replace(/^(د\.|Dr\.)\s*/, "").slice(0, 1)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-lg"><Link to={`/doctors/${doctor.id}`} className="hover:underline">{name}</Link></h3>
            {doctor.verified && <VerifiedBadge />}
            {doctor.sponsored && <SponsoredLabel />}
            {doctor.badge && <Badge variant="info" data-testid="profession-badge">{lang.startsWith("ar") ? doctor.badge.ar : doctor.badge.en}</Badge>}
          </div>
          <p className="text-sm text-muted-foreground">{specialtyLabel(doctor.specialtyCode, lang, specialties)} · {pick(doctor, "clinicName", lang)}</p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <Rating avg={doctor.ratingAvg} count={doctor.ratingCount} />
            <span className="inline-flex items-center gap-1"><Wallet className="h-4 w-4 text-muted-foreground" aria-hidden="true" />{t("doctor.feeFrom", { fee: formatMoney(doctor.feeFromEgp, lang) })}</span>
            <span className="inline-flex items-center gap-1"><MapPin className="h-4 w-4 text-muted-foreground" aria-hidden="true" />{pick(doctor, "area", lang)}{doctor.distanceKm != null && ` · ${t("doctor.distance", { km: formatNumber(doctor.distanceKm, lang) })}`}</span>
            {doctor.depositRequired && <Badge variant="warning">{t("doctor.depositRequired")}</Badge>}
            {doctor.serviceLocations?.includes("HOME") && <Badge variant="success" data-testid="home-badge">{t("hv.homeVisits")}{doctor.homeFeeEgp ? ` · ${formatMoney(doctor.homeFeeEgp, lang)}` : ""}</Badge>}
          </div>
          {doctor.serviceLocations?.includes("HOME") && !!doctor.coverageDistricts?.length && <p className="text-xs text-muted-foreground" data-testid="coverage">{t("hv.visitsIn", { districts: doctor.coverageDistricts.map((d) => districtLabel(d, lang)).join(" · ") })}</p>}
        </div>
      </div>
      <div className="mt-4">
        <p className="mb-2 text-xs font-medium text-muted-foreground">{t("results.nextSlots")}</p>
        {doctor.serviceLocations && !doctor.serviceLocations.includes("IN_CLINIC") && doctor.serviceLocations.includes("HOME") ? (
          <p className="text-sm text-muted-foreground" data-testid="home-only">{t("hv.homeOnlyHint")} <Link to={`/doctors/${doctor.id}?loc=home`} className="text-ocean underline underline-offset-4">{t("hv.seeHomeTimes")}</Link></p>
        ) : !doctor.bookable ? (
          <p className="text-sm text-muted-foreground" data-testid="not-bookable">{t("results.callClinic")} {doctor.clinicPhone && <a className="text-ocean underline underline-offset-4" dir="ltr" href={`tel:${doctor.clinicPhone.replace(/\s/g, "")}`}>{doctor.clinicPhone}</a>}</p>
        ) : doctor.nextSlots.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("results.noSlots")} <Link to={`/doctors/${doctor.id}`} className="text-ocean underline underline-offset-4" data-testid="card-waitlist-link">{t("waitlist.joinShort")}</Link></p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {doctor.nextSlots.slice(0, 3).map((s) => (
              <SlotButton key={s.slotId} slot={s} onPick={(sl) => { track("slot_viewed", { providerId: doctor.id }); onPickSlot(doctor, sl); }} />
            ))}
          </div>
        )}
      </div>
    </article>
  );
}
