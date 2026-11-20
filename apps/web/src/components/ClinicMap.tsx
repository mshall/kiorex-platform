import { Navigation } from "lucide-react";
import { useTranslation } from "react-i18next";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Clinic } from "@/api/types";
import { pick } from "@/lib/format";
import { LazyMap } from "@/components/map/LazyMap";
import { pointFromClinic } from "@/lib/map/points";

export const directionsUrl = (c: Clinic) =>
  c.lat != null && c.lng != null
    ? `https://www.google.com/maps/dir/?api=1&destination=${c.lat},${c.lng}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(pick(c, "address", "en"))}`;

/** Clinic location (KXMPR02 / KXMDS05): interactive map when the clinic has coordinates, address + directions link always. */
export function ClinicMap({ clinic }: { clinic: Clinic }) {
  const { t, i18n } = useTranslation();
  const point = pointFromClinic(clinic, i18n.language);
  const address = (
    <div className="flex min-h-40 items-center justify-center bg-accent px-4 text-center text-sm text-muted-foreground" role="img" aria-label={t("doctor.mapPlaceholder")}>{pick(clinic, "address", i18n.language)}</div>
  );
  return (
    <div className="overflow-hidden rounded-xl border" data-testid="clinic-map">
      {point ? <LazyMap label={t("map.clinicLabel", { name: pick(clinic, "name", i18n.language) })} className="h-52 rounded-none border-0 sm:h-64" points={[point]} selectedId={point.id} fallback={address} /> : address}
      <div className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div><p className="font-medium">{pick(clinic, "name", i18n.language)}</p><p className="text-sm text-muted-foreground">{pick(clinic, "address", i18n.language)}</p></div>
        <a href={directionsUrl(clinic)} target="_blank" rel="noreferrer" className={cn(buttonVariants({ variant: "outline" }))}><Navigation className="h-4 w-4 rtl-flip" aria-hidden="true" />{t("appointment.directions")}</a>
      </div>
    </div>
  );
}
