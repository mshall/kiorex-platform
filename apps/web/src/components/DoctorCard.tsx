import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { MapPin, Wallet } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { formatMoney, formatNumber, pick } from "@/lib/format";
import { track } from "@/lib/analytics";
import type { DoctorSummary, Slot, Specialty } from "@/api/types";
import { VerifiedBadge } from "./VerifiedBadge";
import { Rating } from "./StarRating";
import { SlotButton } from "./SlotButton";

export function DoctorCard({ doctor, specialties, onPickSlot }: { doctor: DoctorSummary; specialties?: Specialty[]; onPickSlot: (d: DoctorSummary, s: Slot) => void }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const name = pick(doctor, "name", lang);
  const spec = specialties?.find((s) => s.code === doctor.specialtyCode);
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
          </div>
          <p className="text-sm text-muted-foreground">{spec ? pick(spec, "name", lang) : doctor.specialtyCode} · {pick(doctor, "clinicName", lang)}</p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <Rating avg={doctor.ratingAvg} count={doctor.ratingCount} />
            <span className="inline-flex items-center gap-1"><Wallet className="h-4 w-4 text-muted-foreground" aria-hidden="true" />{t("doctor.feeFrom", { fee: formatMoney(doctor.feeFromEgp, lang) })}</span>
            <span className="inline-flex items-center gap-1"><MapPin className="h-4 w-4 text-muted-foreground" aria-hidden="true" />{pick(doctor, "area", lang)}{doctor.distanceKm != null && ` · ${t("doctor.distance", { km: formatNumber(doctor.distanceKm, lang) })}`}</span>
            {doctor.depositRequired && <Badge variant="warning">{t("doctor.depositRequired")}</Badge>}
          </div>
        </div>
      </div>
      <div className="mt-4">
        <p className="mb-2 text-xs font-medium text-muted-foreground">{t("results.nextSlots")}</p>
        {doctor.nextSlots.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("results.noSlots")}</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {doctor.nextSlots.slice(0, 3).map((s) => (
              <SlotButton key={s.slotId} slot={s} onPick={(sl) => { track("slot_viewed", { doctorId: doctor.id }); onPickSlot(doctor, sl); }} />
            ))}
          </div>
        )}
      </div>
    </article>
  );
}
