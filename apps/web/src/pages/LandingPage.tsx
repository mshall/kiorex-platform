import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { BadgeCheck, CalendarClock, MessageSquareText, Search, ShieldCheck, Wallet } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Button } from "@/components/ui/button";
import { SearchBar, SpecialtyChips } from "@/components/SearchBar";
import { FeatureCard } from "@/components/FeatureCard";
import { PulseDivider } from "@/components/PulseLine";
import { LogoMark } from "@/components/Logo";
import { useAuth } from "@/auth/AuthProvider";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";

/** Marketing landing for signed-out visitors. Kiorex voice (KX-14): proof points only, no testimonials or invented numbers. */
export default function LandingPage() {
  const { t } = useTranslation();
  const { login } = useAuth();
  const nav = useNavigate();
  const features = [
    { icon: BadgeCheck, k: "verified" }, { icon: CalendarClock, k: "slots" }, { icon: MessageSquareText, k: "reviews" }, { icon: Wallet, k: "fees" },
  ] as const;
  const steps = [{ icon: Search, k: "find" }, { icon: CalendarClock, k: "pick" }, { icon: ShieldCheck, k: "confirm" }] as const;

  return (
    <div className="space-y-16">
      <section className="relative overflow-hidden rounded-2xl bg-card px-5 py-12 shadow-card md:px-12 md:py-16" aria-labelledby="hero-title">
        <LogoMark className="pointer-events-none absolute -end-10 -top-6 h-64 w-auto opacity-[0.06]" />
        <div className="relative max-w-2xl space-y-6">
          <p className="text-sm font-semibold uppercase tracking-wider text-ocean">{t("landing.eyebrow")}</p>
          <h1 id="hero-title" className="text-4xl leading-tight md:text-5xl">{t("landing.title")}</h1>
          <p className="text-lg text-muted-foreground">{t("landing.subtitle")}</p>
          <SearchBar />
          <SpecialtyChips onPick={(code) => nav(code ? `/search?specialty=${code}` : "/search")} />
        </div>
      </section>

      <section aria-labelledby="how-title" className="space-y-6">
        <h2 id="how-title" className="text-2xl">{t("landing.howTitle")}</h2>
        <PulseDivider />
        <ol className="grid gap-4 md:grid-cols-3">
          {steps.map(({ icon: Icon, k }, i) => (
            <li key={k} className="kx-card flex gap-4 p-5">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground kx-label-num">{i + 1}</span>
              <div><h3 className="flex items-center gap-2 text-lg"><Icon className="h-5 w-5 text-ocean" aria-hidden="true" />{t(`landing.steps.${k}.title`)}</h3><p className="text-muted-foreground">{t(`landing.steps.${k}.body`)}</p></div>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="why-title" className="space-y-6">
        <h2 id="why-title" className="text-2xl">{t("landing.whyTitle")}</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {features.map(({ icon, k }) => <FeatureCard key={k} icon={icon} title={t(`landing.features.${k}.title`)} body={t(`landing.features.${k}.body`)} />)}
        </div>
      </section>

      <section className="rounded-2xl bg-primary px-6 py-12 text-center text-primary-foreground" aria-labelledby="cta-title">
        <h2 id="cta-title" className="text-2xl md:text-3xl">{t("landing.ctaTitle")}</h2>
        <p className="mx-auto mt-3 max-w-xl opacity-90">{t("landing.ctaBody")}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Button size="lg" variant="pulse" onClick={() => void login("/")} data-testid="cta-signin">{t("landing.ctaPrimary")}</Button>
          <Link to="/search" className={cn(buttonVariants({ size: "lg", variant: "outline" }), "border-primary-foreground/40 bg-transparent text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground")}>{t("landing.ctaSecondary")}</Link>
        </div>
      </section>

      <p className="text-center text-sm text-muted-foreground">
        {t("landing.forClinics")} <a className="font-medium text-ocean underline underline-offset-4" href="https://kiorly.com" target="_blank" rel="noreferrer">kiorly.com</a>
      </p>
    </div>
  );
}
