import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CONSENT_OPEN_EVENT, CONSENT_TEXT_PLACEHOLDER, needsDecision } from "@/lib/consent";
import { StatusChip } from "@/components/kit";
import { useVisitorConsent } from "./useVisitorConsent";

const isDraft = (v: string) => v.startsWith("TODO_NEEDS_HUMAN") && import.meta.env.MODE !== "production";

/**
 * Consent banner and cookie preferences (GRW-P1-I). Equal-weight Accept and Reject (same variant, same size, same row), nothing pre-ticked, granular
 * analytics and marketing switches behind "Choose what to allow", the stored choice carries the wording version and is asked again when it changes.
 * Wording is a draft until counsel approves it (NEEDS_HUMAN): a visible "draft" chip shows outside production. Light by default, tokens only, RTL via logical classes.
 */
export function ConsentBanner() {
  const { t } = useTranslation();
  const { consent, textVersion, save } = useVisitorConsent();
  const [open, setOpen] = useState(false); // the customise dialog
  const [forced, setForced] = useState(false); // opened from the footer link or the preference centre
  const [analytics, setAnalytics] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const decide = useRef(false);
  const show = needsDecision(consent, textVersion) || forced;

  useEffect(() => {
    const onOpen = () => { setAnalytics(consent?.analytics ?? false); setMarketing(consent?.marketing ?? false); setForced(true); setOpen(true); };
    window.addEventListener(CONSENT_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(CONSENT_OPEN_EVENT, onOpen);
  }, [consent]);

  const choose = async (a: boolean, m: boolean, evidence: string) => {
    if (decide.current) return; decide.current = true;
    setOpen(false); setForced(false);
    try { await save({ analytics: a, marketing: m }, evidence); } finally { decide.current = false; }
  };
  if (!show) return null;
  const draft = isDraft(textVersion || CONSENT_TEXT_PLACEHOLDER);
  return (
    <>
      {!open && (
        <section role="region" aria-label={t("consent.banner.regionLabel")} data-testid="consent-banner" className="kx-sheet-up fixed inset-x-0 bottom-0 z-40 border-t bg-card shadow-lg" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
          <div className="container flex flex-col gap-3 py-3 md:flex-row md:items-center md:justify-between md:gap-4 md:py-4">
            <div className="flex min-w-0 items-start gap-3">
              <span className="mt-0.5 hidden h-9 w-9 shrink-0 items-center sm:flex justify-center rounded-xl bg-accent text-primary" aria-hidden="true"><ShieldCheck className="h-5 w-5" /></span>
              <div className="min-w-0">
                <h2 className="flex flex-wrap items-center gap-2 text-base font-semibold">{t("consent.banner.title")}{draft && <StatusChip tone="warning" data-testid="consent-draft">{t("consent.banner.draft")}</StatusChip>}</h2>
                <p className="mt-1 max-w-3xl text-[13px] leading-snug text-muted-foreground sm:text-sm">{t("consent.banner.body")}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 items-center gap-2 sm:flex sm:flex-wrap md:shrink-0">
              {/* equal weight: identical variant and size, so neither answer is visually steered */}
              <Button variant="outline" className="min-h-11 sm:min-w-28" onClick={() => void choose(false, false, "reject")} data-testid="consent-reject">{t("consent.banner.reject")}</Button>
              <Button variant="outline" className="min-h-11 sm:min-w-28" onClick={() => void choose(true, false, "accept")} data-testid="consent-accept">{t("consent.banner.accept")}</Button>
              <Button variant="ghost" className="col-span-2 min-h-10 sm:col-span-1 sm:min-h-11" onClick={() => { setAnalytics(consent?.analytics ?? false); setMarketing(consent?.marketing ?? false); setOpen(true); }} data-testid="consent-customise">{t("consent.banner.customise")}</Button>
            </div>
          </div>
        </section>
      )}
      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setForced(false); }}>
        <DialogContent className="max-w-lg" data-testid="consent-dialog">
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center gap-2">{t("consent.banner.title")}{draft && <StatusChip tone="warning">{t("consent.banner.draft")}</StatusChip>}</DialogTitle>
            <DialogDescription>{t("consent.banner.body")}</DialogDescription>
          </DialogHeader>
          <ul className="space-y-3">
            <li className="kx-card flex items-start justify-between gap-3 p-3">
              <div><p className="font-medium">{t("consent.banner.essentialTitle")}</p><p className="text-sm text-muted-foreground">{t("consent.banner.essentialBody")}</p></div>
              <Switch checked disabled aria-label={t("consent.banner.essentialTitle")} />
            </li>
            <li className="kx-card flex items-start justify-between gap-3 p-3">
              <div className="min-w-0"><Label htmlFor="cb-analytics" className="text-base">{t("consent.banner.analyticsTitle")}</Label><p className="text-sm text-muted-foreground">{t("consent.banner.analyticsBody")}</p></div>
              <Switch id="cb-analytics" checked={analytics} onCheckedChange={setAnalytics} data-testid="consent-analytics" />
            </li>
            <li className="kx-card flex items-start justify-between gap-3 p-3">
              <div className="min-w-0"><Label htmlFor="cb-marketing" className="text-base">{t("consent.banner.marketingTitle")}</Label><p className="text-sm text-muted-foreground">{t("consent.banner.marketingBody")}</p></div>
              <Switch id="cb-marketing" checked={marketing} onCheckedChange={setMarketing} data-testid="consent-marketing" />
            </li>
          </ul>
          <DialogFooter className="gap-2 sm:justify-start">
            <Button className="min-h-11" onClick={() => void choose(analytics, marketing, "customise")} data-testid="consent-save">{t("consent.banner.save")}</Button>
            <Button variant="outline" className="min-h-11" onClick={() => void choose(false, false, "reject")}>{t("consent.banner.reject")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
