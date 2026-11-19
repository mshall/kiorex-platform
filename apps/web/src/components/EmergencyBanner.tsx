import { useTranslation } from "react-i18next";
import { Phone, Siren } from "lucide-react";
import { EMERGENCY_NUMBER } from "@/lib/emergency";

/** KXMDS06 / KX-16 H07: urgent keywords route to emergency guidance; booking is not offered. */
export function EmergencyBanner() {
  const { t } = useTranslation();
  return (
    <section role="alert" aria-labelledby="emergency-title" data-testid="emergency-banner" className="rounded-xl border-2 border-destructive bg-card p-5">
      <div className="flex items-start gap-4">
        <Siren className="mt-1 h-7 w-7 shrink-0 text-destructive" aria-hidden="true" />
        <div className="space-y-3">
          <h2 id="emergency-title" className="text-xl text-destructive">{t("emergency.title")}</h2>
          <p>{t("emergency.body")}</p>
          <a href={`tel:${EMERGENCY_NUMBER}`} className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-destructive px-6 text-lg font-semibold text-destructive-foreground">
            <Phone className="h-5 w-5" aria-hidden="true" />
            <span dir="ltr">{t("emergency.call", { number: EMERGENCY_NUMBER })}</span>
          </a>
          <p className="text-sm text-muted-foreground">{t("emergency.note")}</p>
        </div>
      </div>
    </section>
  );
}
