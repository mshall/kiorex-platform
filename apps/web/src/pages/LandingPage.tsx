import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowRight, BadgeCheck, CalendarClock, ChevronDown, ExternalLink, FlaskConical, Lock, MessageSquareText, Pill, Search, Shield, ShieldCheck, Stethoscope, UserRoundCheck, Video, Wallet, type LucideIcon } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { PhoneMockup } from "@/components/landing/PhoneMockup";
import { useMarkets } from "@/api/services";
import { useMarket } from "@/components/MarketSelector";
import { useReveal } from "@/hooks/useReveal";
import { cn } from "@/lib/utils";
import { KIORLY_JOIN_URL } from "@/lib/hosts";

const CLAIMS: { icon: LucideIcon; k: "verified" | "slots" | "fees" }[] = [{ icon: BadgeCheck, k: "verified" }, { icon: CalendarClock, k: "slots" }, { icon: Wallet, k: "fees" }];
const CARE: { icon: LucideIcon; k: "doctors" | "labs" | "pharmacies" | "tele"; to: string }[] = [
  { icon: Stethoscope, k: "doctors", to: "/search" }, { icon: FlaskConical, k: "labs", to: "/services" }, { icon: Pill, k: "pharmacies", to: "/services" }, { icon: Video, k: "tele", to: "/services" },
];
const STEPS: { icon: LucideIcon; k: "find" | "pick" | "confirm" }[] = [{ icon: Search, k: "find" }, { icon: CalendarClock, k: "pick" }, { icon: ShieldCheck, k: "confirm" }];

function Reveal({ children, i = 0, className, as: Tag = "div" }: { children: React.ReactNode; i?: number; className?: string; as?: "div" | "li" | "section" }) {
  const [ref, seen] = useReveal<HTMLDivElement>();
  const Comp = Tag as "div";
  return <Comp ref={ref} className={cn("kx-reveal", className)} data-in={seen} style={{ ["--i" as string]: i }}>{children}</Comp>;
}

const eyebrow = "kx-eyebrow";
const btnLg = (v: "default" | "outline" | "pulse" = "default") => cn(buttonVariants({ size: "lg", variant: v }), "w-full sm:w-auto");

/** The Kiorex landing page for signed-out visitors (redesign 28 Nov 2026). Proof points only: no testimonials, prices, doctor names or invented numbers (the product is in pilot). */
export default function LandingPage() {
  const { t } = useTranslation();
  const market = useMarket();
  const markets = useMarkets();
  const row = markets.data?.find((m) => m.code === market);
  const live = !!(row && row.live);
  const known = !!markets.data;

  return (
    <div className="space-y-20 md:space-y-28" data-testid="landing">
      {/* HERO: text and logo share the page gutter (no inset card), so the logo, the headline and the claims start on one edge in LTR and RTL. */}
      <section aria-labelledby="hero-title" className="grid items-center gap-12 pt-2 lg:grid-cols-[1.1fr_0.9fr] lg:gap-8">
        <div className="min-w-0 space-y-7">
          {known && (
            <p className={cn("kx-rise inline-flex items-start gap-2 rounded-full border px-3.5 py-1.5 text-sm font-medium", live ? "border-success/40 bg-success-soft text-foreground" : "border-warning/40 bg-warning-soft text-foreground")} style={{ ["--i" as string]: 0 }} data-testid="hero-status">
              <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", live ? "bg-success" : "bg-warning")} aria-hidden="true" />{live ? t("lp.hero.badgeLive") : t("lp.hero.badgeSoon")}
            </p>
          )}
          <div className="space-y-4">
            <p className={cn(eyebrow, "kx-rise")} style={{ ["--i" as string]: 1 }}>{t("lp.hero.eyebrow")}</p>
            <h1 id="hero-title" className="kx-rise max-w-2xl text-balance text-4xl leading-[1.08] sm:text-5xl lg:text-6xl" style={{ ["--i" as string]: 2 }}>{t("lp.hero.title")}</h1>
            <p className="kx-rise max-w-xl text-lg text-muted-foreground" style={{ ["--i" as string]: 3 }}>{t("lp.hero.subtitle")}</p>
          </div>
          <div className="kx-rise flex flex-col gap-3 sm:flex-row sm:flex-wrap" style={{ ["--i" as string]: 4 }}>
            <Link to="/search" className={btnLg()} data-testid="hero-find-care"><Search aria-hidden="true" />{t("lp.hero.findCare")}</Link>
            <Link to="/join" className={btnLg("outline")} data-testid="hero-join">{t("lp.hero.joinUs")}<ArrowRight className="rtl-flip" aria-hidden="true" /></Link>
          </div>
          <p className="kx-rise text-sm text-muted-foreground" style={{ ["--i" as string]: 5 }}>{t("lp.hero.haveAccount")}{" "}<Link to="/signin" className="inline-flex min-h-11 items-center font-semibold text-primary underline underline-offset-4" data-testid="hero-signin">{t("lp.hero.signIn")}</Link></p>
        </div>
        <PhoneMockup className="kx-rise" />
      </section>

      {/* THE THREE CLAIMS: one row, same container edges as the header logo and the hero text; equal columns, logical (RTL-safe) spacing. */}
      <section aria-labelledby="claims-title" className="">
        <h2 id="claims-title" className="sr-only">{t("lp.claims.title")}</h2>
        <ul className="grid gap-4 md:grid-cols-3" data-testid="claims">
          {CLAIMS.map(({ icon: Icon, k }, i) => (
            <Reveal as="li" key={k} i={i} className="kx-card kx-claim flex items-start gap-4 p-5 ps-6">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent text-primary"><Icon className="h-5 w-5" aria-hidden="true" /></span>
              <div className="min-w-0 space-y-1"><h3 className="text-base font-semibold">{t(`lp.claims.${k}.title`)}</h3><p className="text-sm text-muted-foreground">{t(`lp.claims.${k}.body`)}</p></div>
            </Reveal>
          ))}
        </ul>
      </section>

      <section aria-labelledby="care-title" className="space-y-8">
        <Reveal className="max-w-2xl space-y-2"><p className={eyebrow}>{t("lp.care.eyebrow")}</p><h2 id="care-title" className="text-3xl md:text-4xl">{t("lp.care.title")}</h2></Reveal>
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {CARE.map(({ icon: Icon, k, to }, i) => (
            <Reveal as="li" key={k} i={i}>
              <Link to={to} className="kx-card kx-card-interactive group flex h-full flex-col gap-3 p-6" data-testid={`care-${k}`}>
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-linear-to-br from-primary/15 to-ocean/15 text-primary"><Icon className="h-6 w-6" aria-hidden="true" /></span>
                <h3 className="text-lg">{t(`lp.care.${k}.title`)}</h3>
                <p className="flex-1 text-sm text-muted-foreground">{t(`lp.care.${k}.body`)}</p>
                <span className="inline-flex items-center gap-1 text-sm font-semibold text-primary">{t("lp.care.open")}<ArrowRight className="rtl-flip h-4 w-4 transition-transform group-hover:translate-x-0.5 rtl:group-hover:-translate-x-0.5" aria-hidden="true" /></span>
              </Link>
            </Reveal>
          ))}
        </ul>
      </section>

      <section aria-labelledby="how-title" className="space-y-8" id="how">
        <Reveal className="max-w-2xl space-y-2"><p className={eyebrow}>{t("lp.how.eyebrow")}</p><h2 id="how-title" className="text-3xl md:text-4xl">{t("lp.how.title")}</h2></Reveal>
        <ol className="grid gap-5 md:grid-cols-3" data-testid="how-it-works">
          {STEPS.map(({ icon: Icon, k }, i) => (
            <Reveal as="li" key={k} i={i} className="kx-card relative space-y-3 p-6">
              <span className="kx-label-num flex h-11 w-11 items-center justify-center rounded-full bg-primary text-lg font-semibold text-primary-foreground shadow-raised">{i + 1}</span>
              <h3 className="flex items-center gap-2 text-lg"><Icon className="h-5 w-5 text-ocean" aria-hidden="true" />{t(`lp.how.${k}.title`)}</h3>
              <p className="text-sm text-muted-foreground">{t(`lp.how.${k}.body`)}</p>
            </Reveal>
          ))}
        </ol>
      </section>

      <section aria-labelledby="trust-title" className="kx-hero rounded-3xl border p-6 shadow-float md:p-12">
        <Reveal className="max-w-2xl space-y-2"><p className={eyebrow}>{t("lp.trust.eyebrow")}</p><h2 id="trust-title" className="text-3xl md:text-4xl">{t("lp.trust.title")}</h2></Reveal>
        <ul className="mt-8 grid gap-5 sm:grid-cols-2">
          {([[UserRoundCheck, "verified"], [MessageSquareText, "reviews"], [Shield, "privacy"], [Lock, "nomedical"]] as [LucideIcon, string][]).map(([Icon, k], i) => (
            <Reveal as="li" key={k} i={i} className="flex items-start gap-4">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-card text-primary shadow-card"><Icon className="h-5 w-5" aria-hidden="true" /></span>
              <div className="space-y-1"><h3 className="text-lg">{t(`lp.trust.${k}.title`)}</h3><p className="text-sm text-muted-foreground">{t(`lp.trust.${k}.body`)}</p></div>
            </Reveal>
          ))}
        </ul>
        <p className="mt-6"><Link to="/preferences" className="inline-flex min-h-11 items-center font-semibold text-primary underline underline-offset-4">{t("lp.trust.prefs")}</Link></p>
      </section>

      <section aria-labelledby="kiorly-title" className="grid items-center gap-8 md:grid-cols-[1.2fr_0.8fr]">
        <Reveal className="space-y-3"><p className={eyebrow}>{t("lp.kiorly.eyebrow")}</p><h2 id="kiorly-title" className="text-3xl md:text-4xl">{t("lp.kiorly.title")}</h2><p className="max-w-xl text-muted-foreground">{t("lp.kiorly.body")}</p></Reveal>
        <Reveal i={1} className="kx-card space-y-4 p-6">
          <p className="flex items-center gap-2 text-sm font-semibold"><span className="h-2.5 w-2.5 rounded-full bg-primary" aria-hidden="true" />Kiorex <span className="font-normal text-muted-foreground">{t("lp.kiorly.patient")}</span></p>
          <p className="flex items-center gap-2 text-sm font-semibold"><span className="h-2.5 w-2.5 rounded-full bg-ocean" aria-hidden="true" />Kiorly <span className="font-normal text-muted-foreground">{t("lp.kiorly.provider")}</span></p>
          <a href={KIORLY_JOIN_URL} target="_blank" rel="noopener noreferrer" className={cn(buttonVariants({ variant: "outline", size: "lg" }), "w-full")} data-testid="landing-providers">{t("lp.kiorly.cta")}<ExternalLink aria-hidden="true" /><span className="sr-only"> ({t("lp.kiorly.external")})</span></a>
        </Reveal>
      </section>

      <section aria-labelledby="faq-title" className="mx-auto w-full max-w-3xl space-y-6" id="faq">
        <Reveal><h2 id="faq-title" className="text-3xl md:text-4xl">{t("lp.faq.title")}</h2></Reveal>
        <div className="divide-y rounded-2xl border bg-card" data-testid="faq">
          {(["f1", "f2", "f3", "f4", "f5", "f6"] as const).map((f) => (
            <details key={f} className="group p-5">
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 rounded-lg text-start text-base font-semibold focus-visible:outline-hidden focus-visible:ring-[3px] focus-visible:ring-ring [&::-webkit-details-marker]:hidden">{t(`lp.faq.items.${f}.q`)}<ChevronDown className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none" aria-hidden="true" /></summary>
              <p className="mt-3 text-muted-foreground">{t(`lp.faq.items.${f}.a`)}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="kx-gradient-brand relative overflow-hidden rounded-3xl px-6 py-14 text-center text-white shadow-float" aria-labelledby="cta-title">
        <div className="relative space-y-3">
          <h2 id="cta-title" className="text-balance text-3xl text-white md:text-4xl">{t("lp.cta.title")}</h2>
          <p className="mx-auto max-w-xl text-white/90">{t("lp.cta.body")}</p>
          <div className="flex flex-col items-stretch justify-center gap-3 pt-4 sm:flex-row sm:items-center">
            <Link to="/join" className={cn(buttonVariants({ size: "lg", variant: "pulse" }), "sm:w-auto")} data-testid="cta-join">{t("lp.hero.joinUs")}</Link>
            <Link to="/search" className={cn(buttonVariants({ size: "lg", variant: "outline" }), "border-white/50 bg-transparent text-white hover:bg-white/10 hover:text-white sm:w-auto")}>{t("lp.cta.browse")}</Link>
          </div>
        </div>
      </section>
    </div>
  );
}
