import { BadgeCheck, CalendarClock, Search, Wallet } from "lucide-react";
import { useTranslation } from "react-i18next";
import { KiorexLogo } from "@/brand/kiorex-logo";
import { cn } from "@/lib/utils";

/** Hero visual: a phone drawn in CSS showing the real shape of the Kiorex booking screen (search, a doctor card with the verified mark, real-slot pills, the fee line).
 *  It is an illustration: names are skeleton bars, so it shows no invented doctor, price or rating. The animated brand mark sits in its header. */
export function PhoneMockup({ className }: { className?: string }) {
  const { t } = useTranslation();
  const bar = "rounded-full bg-muted-foreground/20";
  return (
    <div className={cn("relative mx-auto w-full max-w-[22rem]", className)} role="img" aria-label={t("lp.hero.illustration")} data-testid="phone-mockup">
      <div className="kx-orb absolute -inset-6 -z-10 rounded-full bg-linear-to-br from-primary/25 via-accent to-ocean/25 blur-2xl" aria-hidden="true" />
      <div className="kx-phone mx-auto aspect-[9/16.5] w-[16.5rem] rounded-[2.4rem] border-[7px] border-foreground/90 bg-background p-3 sm:w-[17.5rem]" aria-hidden="true">
        <div className="mx-auto mb-3 h-1.5 w-16 rounded-full bg-foreground/15" />
        <div className="flex items-center justify-between px-1">
          <KiorexLogo variant="mark" height={40} followSystem={false} title="" animated className="kx-logo-live h-8 w-auto" />
          <span className="h-7 w-7 rounded-full bg-accent" />
        </div>
        <div className="mt-3 flex items-center gap-2 rounded-xl border bg-card px-3 py-2.5"><Search className="h-4 w-4 text-muted-foreground" /><span className={cn(bar, "h-2 w-28")} /></div>
        <div className="mt-3 space-y-3 rounded-2xl border bg-card p-3 shadow-card">
          <div className="flex items-center gap-3">
            <span className="h-11 w-11 shrink-0 rounded-full bg-linear-to-br from-primary/30 to-ocean/30" />
            <div className="min-w-0 flex-1 space-y-1.5"><span className={cn(bar, "block h-2.5 w-3/4 bg-foreground/25")} /><span className={cn(bar, "block h-2 w-1/2")} /></div>
          </div>
          <span className="inline-flex items-center gap-1 rounded-full bg-success-soft px-2 py-1 text-[11px] font-semibold text-foreground"><BadgeCheck className="h-3.5 w-3.5" />{t("lp.claims.verified.title")}</span>
          <div>
            <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground"><CalendarClock className="h-3.5 w-3.5 text-primary" />{t("lp.claims.slots.title")}</p>
            <div className="grid grid-cols-3 gap-1.5 text-center text-[11px] font-semibold kx-label-num" dir="ltr">
              <span className="rounded-lg border bg-card py-1.5">10:00</span>
              <span className="kx-slot-demo rounded-lg border py-1.5">10:30</span>
              <span className="rounded-lg border bg-card py-1.5">11:00</span>
            </div>
          </div>
          <p className="flex items-center gap-1.5 border-t pt-2.5 text-[11px] font-semibold"><Wallet className="h-3.5 w-3.5 text-pulse" />{t("lp.claims.fees.title")}</p>
        </div>
        <div className="mt-3 space-y-2 rounded-2xl border bg-card/60 p-3"><span className={cn(bar, "block h-2.5 w-2/3 bg-foreground/20")} /><span className={cn(bar, "block h-2 w-1/3")} /></div>
      </div>
    </div>
  );
}
