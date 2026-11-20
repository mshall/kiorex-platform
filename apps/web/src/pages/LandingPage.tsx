import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { BadgeCheck, CalendarClock, MessageSquareText, Search, ShieldCheck, Wallet } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { HeroSearch } from "@/components/HeroSearch";
import { HeroArt } from "@/components/HeroArt";
import { SpecialtyChips } from "@/components/SearchBar";
import { CareTypeTabs } from "@/components/CareTypeTabs";
import { PulseDivider } from "@/components/PulseLine";
import { useAuth } from "@/auth/AuthProvider";
import { useInView } from "@/hooks/useInView";
import { cn } from "@/lib/utils";

const FEATURES = [{ icon: BadgeCheck, k: "verified" }, { icon: CalendarClock, k: "slots" }, { icon: MessageSquareText, k: "reviews" }, { icon: Wallet, k: "fees" }] as const;
const STEPS = [{ icon: Search, k: "find" }, { icon: CalendarClock, k: "pick" }, { icon: ShieldCheck, k: "confirm" }] as const;

/** Marketing landing for signed-out visitors. Kiorex voice (KX-14): proof points only, no testimonials or invented numbers. */
export default function LandingPage() {
  const { t } = useTranslation();
  const { login } = useAuth();
  const nav = useNavigate();
  const [howRef, howSeen] = useInView<HTMLDivElement>(0.3);

  return (
    <div className="space-y-16 md:space-y-24">
      <section className="kx-hero relative overflow-hidden rounded-3xl border px-5 py-10 shadow-float md:px-12 md:py-16" aria-labelledby="hero-title">
        <div className="relative grid items-center gap-10 lg:grid-cols-[1.25fr_0.75fr]">
          <div className="min-w-0 space-y-6">
            <p className="kx-eyebrow kx-rise" style={{ ["--i" as string]: 0 }}>{t("landing.eyebrow")}</p>
            <h1 id="hero-title" className="kx-rise max-w-3xl text-balance text-4xl leading-[1.08] sm:text-5xl lg:text-6xl" style={{ ["--i" as string]: 1 }}>{t("landing.title")}</h1>
            <p className="kx-rise max-w-xl text-lg text-muted-foreground" style={{ ["--i" as string]: 2 }}>{t("landing.subtitle")}</p>
            <div className="kx-rise" style={{ ["--i" as string]: 3 }}><HeroSearch /></div>
            <div className="kx-rise space-y-3" style={{ ["--i" as string]: 4 }}>
              <CareTypeTabs onPick={(c) => nav(c ? `/search?careType=${c}${c === "HOME_NURSING" ? "&serviceLocation=HOME" : ""}` : "/search")} />
              <SpecialtyChips onPick={(code) => nav(code ? `/search?specialty=${code}` : "/search")} />
            </div>
          </div>
          <HeroArt className="hidden lg:block" labels={{ verified: t("landing.features.verified.title"), slots: t("landing.features.slots.title"), fees: t("landing.features.fees.title") }} />
        </div>
      </section>

      <section aria-labelledby="why-title" className="space-y-6">
        <div className="max-w-2xl space-y-2"><p className="kx-eyebrow">{t("landing.whyEyebrow")}</p><h2 id="why-title" className="text-2xl md:text-3xl">{t("landing.whyTitle")}</h2></div>
        <ul className="grid gap-px overflow-hidden rounded-xl border bg-border shadow-card sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map(({ icon: Icon, k }, i) => (
            <li key={k} className="kx-rise space-y-3 bg-card p-6" style={{ ["--i" as string]: i }}>
              <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-accent text-primary"><Icon className="h-5 w-5" aria-hidden="true" /></span>
              <h3 className="text-lg">{t(`landing.features.${k}.title`)}</h3>
              <p className="text-sm text-muted-foreground">{t(`landing.features.${k}.body`)}</p>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="how-title" className="space-y-8">
        <div className="max-w-2xl space-y-2"><p className="kx-eyebrow">{t("landing.howEyebrow")}</p><h2 id="how-title" className="text-2xl md:text-3xl">{t("landing.howTitle")}</h2></div>
        <div className="relative" ref={howRef} data-testid="how-it-works" data-drawn={howSeen}>
          {/* The coral pulse line draws itself between the steps once the section scrolls into view (reduced motion: shown instantly). */}
          <svg className="pointer-events-none absolute inset-x-0 top-[12px] hidden h-6 w-full md:block rtl:-scale-x-100" viewBox="0 0 900 24" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
            <path d="M60 12 H300 l6 -8 l7 16 l8 -22 l8 20 l4 -6 H840" pathLength={1} fill="none" className={cn("stroke-pulse", howSeen ? "kx-draw" : "opacity-0")} style={{ ["--kx-draw-ms" as string]: "1600ms" }} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <svg className="pointer-events-none absolute inset-y-6 inset-s-3 w-6 md:hidden" viewBox="0 0 24 300" preserveAspectRatio="none" aria-hidden="true">
            <path d="M12 0 V118 l-7 8 l12 14 l-9 -30 l4 8 V300" pathLength={1} fill="none" className={cn("stroke-pulse", howSeen ? "kx-draw" : "opacity-0")} style={{ ["--kx-draw-ms" as string]: "1600ms" }} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <ol className="relative grid gap-6 md:grid-cols-3">
            {STEPS.map(({ icon: Icon, k }, i) => (
              <li key={k} className="kx-rise flex items-start gap-4 md:block md:space-y-4 md:text-center" style={{ ["--i" as string]: i + 1 }}>
                <span className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-raised ring-8 ring-background kx-label-num text-lg font-semibold md:mx-auto">{i + 1}</span>
                <div className="kx-card min-w-0 flex-1 space-y-2 p-5 md:text-start">
                  <h3 className="flex items-center gap-2 text-lg"><Icon className="h-5 w-5 text-ocean" aria-hidden="true" />{t(`landing.steps.${k}.title`)}</h3>
                  <p className="text-sm text-muted-foreground">{t(`landing.steps.${k}.body`)}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="kx-gradient-brand relative overflow-hidden rounded-3xl px-6 py-14 text-center text-white shadow-float" aria-labelledby="cta-title">
        <PulseDivider className="absolute inset-x-0 bottom-6 h-6 text-white/15" />
        <div className="relative">
          <h2 id="cta-title" className="text-balance text-3xl text-white md:text-4xl">{t("landing.ctaTitle")}</h2>
          <p className="mx-auto mt-3 max-w-xl text-white/85">{t("landing.ctaBody")}</p>
          <div className="mt-7 flex flex-wrap justify-center gap-3">
            <Button size="lg" variant="pulse" onClick={() => void login("/")} data-testid="cta-signin">{t("landing.ctaPrimary")}</Button>
            <Link to="/search" className={cn(buttonVariants({ size: "lg", variant: "outline" }), "border-white/40 bg-transparent text-white hover:bg-white/10 hover:text-white")}>{t("landing.ctaSecondary")}</Link>
          </div>
        </div>
      </section>

      <p className="text-center text-sm text-muted-foreground">
        {t("landing.forClinics")} <a className="font-medium text-ocean underline underline-offset-4" href="https://kiorly.com" target="_blank" rel="noreferrer">kiorly.com</a>
      </p>
    </div>
  );
}
