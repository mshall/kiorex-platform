import { useId, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { FlaskConical, House, Pill, X, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { rememberCard, useContinuityCards, useDismissContinuityCard, useSetContinuityConsent, type ContinuityCard } from "@/api/continuity";

const META: Record<ContinuityCard["kind"], { icon: LucideIcon; k: "rx" | "lab" | "home" }> = {
  RX_TO_PHARMACY: { icon: Pill, k: "rx" }, LAB_ORDER_TO_LAB: { icon: FlaskConical, k: "lab" }, CARE_PLAN_TO_HOME_VISIT: { icon: House, k: "home" },
};

/** Where a card leads: the existing pharmacy, lab and care-plan flows. The pharmacy flow opens with the patient's own prescription already chosen. */
export const cardTarget = (c: ContinuityCard) => (c.kind === "RX_TO_PHARMACY" && c.recordId ? `${c.path}?rx=${encodeURIComponent(c.recordId)}` : c.path);

/**
 * GRW-P4-A continuity cards: shown only for the patient's own data, in the app, when the service gate of the destination is open. Nothing is sent by growth. The wording never mentions a condition,
 * a drug or a test. The optional switch connects the visit to the order for measurement only (no reward, no price change); it is off by default and can be turned off any time.
 * Renders nothing at all when the package is OFF, locked or has no card, so the home page looks exactly as before.
 */
export function ContinuityCards() {
  const { t } = useTranslation(); const nav = useNavigate();
  const q = useContinuityCards(); const setConsent = useSetContinuityConsent(); const dismiss = useDismissContinuityCard();
  const [link, setLink] = useState<boolean | null>(null); const uid = useId();
  const cards = q.data?.cards ?? [];
  if (!q.data?.enabled || cards.length === 0) return null;
  const connected = link ?? q.data.consent;
  const open = (c: ContinuityCard) => { if (connected !== q.data!.consent) setConsent.mutate(connected); rememberCard(c.id); nav(cardTarget(c)); };
  return (
    <section aria-labelledby={`${uid}-h`} className="space-y-3" data-testid="continuity-cards">
      <div><h2 id={`${uid}-h`} className="kx-section-title">{t("continuity.title")}</h2><p className="text-sm text-muted-foreground">{t("continuity.intro")}</p></div>
      <ul className="grid gap-3 md:grid-cols-2" aria-label={t("continuity.listLabel")}>
        {cards.map((c) => {
          const m = META[c.kind]; if (!m) return null; const Icon = m.icon; const title = t(`continuity.${m.k}.title`);
          return (
            <li key={c.id} className="kx-card relative flex min-w-0 flex-col gap-3 p-4" data-testid={`continuity-card-${m.k}`}>
              <Button variant="ghost" size="icon" className="absolute end-1 top-1 h-11 w-11" aria-label={t("continuity.dismissLabel", { title })} onClick={() => dismiss.mutate(c.id)} data-testid={`continuity-dismiss-${m.k}`}><X aria-hidden="true" className="h-4 w-4" /></Button>
              <div className="flex items-start gap-3 pe-10">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-accent text-primary" aria-hidden="true"><Icon className="h-5 w-5" /></span>
                <div className="min-w-0"><h3 className="text-base font-semibold">{title}</h3><p className="mt-1 text-sm text-muted-foreground">{t(`continuity.${m.k}.body`)}</p></div>
              </div>
              <div className="flex items-start gap-3 rounded-xl bg-muted/40 p-3">
                <Switch id={`${uid}-${c.id}`} checked={connected} onCheckedChange={setLink} aria-describedby={`${uid}-${c.id}-d`} className="mt-0.5 shrink-0" data-testid="continuity-consent" />
                <div className="min-w-0 text-sm"><label htmlFor={`${uid}-${c.id}`} className="font-medium">{t("continuity.consent.label")}</label>
                  <p id={`${uid}-${c.id}-d`} className="mt-1 text-xs text-muted-foreground">{t("continuity.consent.help")}{" "}{q.data?.consent ? null : <span data-testid="continuity-draft">{t("continuity.consent.draft")}</span>}</p></div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button className="min-h-11" onClick={() => open(c)} data-testid={`continuity-open-${m.k}`}>{t(`continuity.${m.k}.cta`)}</Button>
                <Button variant="ghost" className="min-h-11" onClick={() => dismiss.mutate(c.id)}>{t("continuity.dismiss")}</Button>
              </div>
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-muted-foreground">{t("continuity.privacy")}</p>
    </section>
  );
}
