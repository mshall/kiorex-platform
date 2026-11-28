import { useEffect, useMemo, useRef, useState } from "react";
import type { Patient } from "@/api/types";
import type { PreferencesView } from "@/api/consent";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowLeft, ArrowRight, BellRing, Check, Globe2, HeartHandshake, Languages, Lock, PartyPopper, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { ErrorState, LoadingState } from "@/components/states";
import { Logo } from "@/components/Logo";
import { regionName, useMarket } from "@/components/MarketSelector";
import { useAuth } from "@/auth/AuthProvider";
import { useMe } from "@/api/hooks";
import { useUpdateProfile } from "@/api/engagement";
import { usePreferences, useUpdatePreferences, type MarketingChannel } from "@/api/consent";
import { useMarkets } from "@/api/services";
import { setMarket } from "@/lib/market";
import { cn } from "@/lib/utils";
import { INTERESTS, TOTAL_STEPS, cleanName, getInterests, getStep, isDeviceDone, isOnboarded, markDeviceDone, nameField, safeNext, setInterests, setStep, validName, type Interest } from "@/lib/onboarding";

const CHANNELS: MarketingChannel[] = ["WHATSAPP", "SMS", "EMAIL", "PUSH"];
const STEP_ICON = [HeartHandshake, UserRound, Globe2, Check, Lock, BellRing] as const;

/** `/welcome`: first-run onboarding. Existing members pass straight through to `next`. Everything is optional, nothing asks for medical data, each step saves through the profile and preference APIs, and the step is remembered so a closed tab resumes. */
export default function WelcomePage() {
  const [sp] = useSearchParams();
  const next = safeNext(sp.get("next"));
  const review = sp.get("review") === "1";
  const { user } = useAuth();
  const sub = user?.sub ?? "anon";
  const me = useMe();
  const prefs = usePreferences();
  const [started, setStarted] = useState(false);
  if (me.isLoading || prefs.isLoading) return <LoadingState />;
  if (me.error || prefs.error || !me.data || !prefs.data) return <ErrorState error={(me.error ?? prefs.error) as Error} onRetry={() => { void me.refetch(); void prefs.refetch(); }} />;
  // existing members (a recorded decision, an older account, or this device finished) pass straight through; a flow that has begun is never interrupted by its own saves
  if (!started && !review && isOnboarded({ createdAt: me.data.createdAt, prefs: prefs.data, deviceDone: isDeviceDone(sub) })) return <Navigate to={next} replace />;
  return <WelcomeFlow me={me.data} prefs={prefs.data} sub={sub} next={next} onStart={() => setStarted(true)} />;
}

function WelcomeFlow({ me, prefs, sub, next, onStart }: { me: Patient; prefs: PreferencesView; sub: string; next: string; onStart: () => void }) {
  const { t, i18n } = useTranslation();
  const nav = useNavigate();
  const markets = useMarkets();
  const saveProfile = useUpdateProfile();
  const savePrefs = useUpdatePreferences();
  const market = useMarket();
  const heading = useRef<HTMLHeadingElement>(null);

  const [step, setStepState] = useState(() => getStep(sub));
  const [name, setName] = useState(me.nameEn ?? me.nameAr ?? "");
  const [nameTouched, setNameTouched] = useState(false);
  const [picked, setPicked] = useState<Interest[]>(() => getInterests());
  const [analytics, setAnalytics] = useState(prefs.analytics.consent);
  const [reminders, setReminders] = useState(prefs.reminders.consent);
  const [offers, setOffers] = useState<Partial<Record<MarketingChannel, boolean>>>({});
  const [err, setErr] = useState(false);
  const [done, setDone] = useState<"finished" | "skipped" | null>(null);

  useEffect(() => { heading.current?.focus(); }, [step, done]);

  const goto = (n: number) => { onStart(); setErr(false); setStepState(n); setStep(sub, n); };
  const fail = () => setErr(true);
  const finish = (how: "finished" | "skipped") => { markDeviceDone(sub); setDone(how); };

  const saveName = () => {
    const n = cleanName(name);
    if (!n || n === (me.nameEn ?? me.nameAr)) return goto(step + 1);
    saveProfile.mutate(nameField(n), { onSuccess: () => goto(step + 1), onError: fail });
  };
  const saveLang = () => {
    const lang = i18n.language.startsWith("ar") ? "ar" : "en";
    const body = { preferredLocale: lang as "ar" | "en", ...(me.market !== market ? { market } : {}) };
    saveProfile.mutate(body, { onSuccess: () => goto(step + 1), onError: fail });
  };
  const saveInterests = () => { setInterests(picked); goto(step + 1); };
  const savePrivacy = () => savePrefs.mutate({ analytics }, { onSuccess: () => goto(step + 1), onError: fail });
  const saveNotify = () => {
    const marketing = Object.fromEntries(Object.entries(offers).filter(([, v]) => v));
    savePrefs.mutate({ reminders, ...(Object.keys(marketing).length ? { marketing } : {}) }, { onSuccess: () => finish("finished"), onError: fail });
  };
  const skipAll = () => { onStart(); savePrefs.mutate({ analytics: false, reminders: false }, { onSuccess: () => finish("skipped"), onError: fail }); };

  const busy = saveProfile.isPending || savePrefs.isPending;
  const Icon = STEP_ICON[Math.min(step, TOTAL_STEPS - 1)];
  const marketRows = useMemo(() => (markets.data?.length ? markets.data : [{ code: market, live: false, flag: "", state: "AWAITING_GATE" }]), [markets.data, market]);

  const wrap = (children: React.ReactNode, narrow = true) => (
    <div className={cn("mx-auto space-y-6 py-4 md:py-10", narrow && "max-w-xl")} data-testid="welcome">{children}</div>
  );

  if (done) {
    return wrap(
      <section className="kx-card space-y-5 p-6 text-center md:p-8" aria-labelledby="ob-done" data-testid="welcome-done">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-accent text-primary"><PartyPopper className="h-7 w-7" aria-hidden="true" /></span>
        <h1 id="ob-done" ref={heading} tabIndex={-1} className="text-3xl outline-hidden">{done === "finished" ? t("welcome.done.title") : t("welcome.done.skippedTitle")}</h1>
        <p className="text-muted-foreground">{done === "finished" ? t("welcome.done.body") : t("welcome.done.skippedBody")}</p>
        <Button size="lg" onClick={() => nav(next, { replace: true })} data-testid="welcome-go">{t("welcome.done.go")}<ArrowRight className="rtl-flip" aria-hidden="true" /></Button>
      </section>,
    );
  }

  const titles = ["welcome", "name", "language", "interests", "privacy", "notify"] as const;
  const k = titles[step] ?? "welcome";
  const nameBad = !validName(name);
  const primary = step === 0 ? () => goto(1) : step === 1 ? saveName : step === 2 ? saveLang : step === 3 ? saveInterests : step === 4 ? savePrivacy : saveNotify;
  const primaryLabel = step === 0 ? t(`welcome.welcome.start`) : step === TOTAL_STEPS - 1 ? t("welcome.finish") : t("welcome.next");
  const optionalStep = step === 1 || step === 3;

  return wrap(
    <>
      <div className="flex items-center justify-between gap-3">
        <Logo height={56} />
        <button type="button" onClick={skipAll} disabled={busy} className="inline-flex min-h-11 items-center rounded-lg px-2 text-sm font-medium text-muted-foreground underline underline-offset-4 hover:text-foreground disabled:opacity-50" data-testid="welcome-skip-all">{t("welcome.skipAll")}</button>
      </div>
      <div className="space-y-2">
        <p className="kx-label-num text-sm font-medium text-muted-foreground" data-testid="welcome-step">{t("welcome.step", { n: step + 1, total: TOTAL_STEPS })}</p>
        <div role="progressbar" aria-valuemin={1} aria-valuemax={TOTAL_STEPS} aria-valuenow={step + 1} aria-label={t("welcome.title")} className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${((step + 1) / TOTAL_STEPS) * 100}%` }} />
        </div>
      </div>

      <section className="kx-card space-y-5 p-6 md:p-8" aria-labelledby="ob-title" key={step}>
        <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent text-primary"><Icon className="h-6 w-6" aria-hidden="true" /></span>
        <div className="space-y-2">
          <h1 id="ob-title" ref={heading} tabIndex={-1} className="text-2xl outline-hidden md:text-3xl">{t(`welcome.${k}.title`)}</h1>
          <p className="text-muted-foreground">{t(`welcome.${k}.body`)}</p>
        </div>

        {step === 1 && (
          <div className="space-y-2">
            <Label htmlFor="ob-name">{t("welcome.name.label")}</Label>
            <Input id="ob-name" value={name} autoComplete="name" maxLength={120} onChange={(e) => { setName(e.target.value); setNameTouched(true); }} aria-describedby="ob-name-hint" aria-invalid={nameBad} data-testid="welcome-name" className="min-h-12" />
            <p id="ob-name-hint" className={cn("text-xs", nameBad && nameTouched ? "font-medium text-destructive" : "text-muted-foreground")} role={nameBad ? "alert" : undefined}>{nameBad ? t("welcome.name.tooLong") : t("welcome.name.hint")}</p>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-5">
            <fieldset className="space-y-2"><legend className="flex items-center gap-2 text-sm font-medium"><Languages className="h-4 w-4 text-ocean" aria-hidden="true" />{t("welcome.language.lang")}</legend>
              <div className="grid grid-cols-2 gap-2">
                {([["en", "English"], ["ar", "العربية"]] as const).map(([c, label]) => {
                  const on = i18n.language.startsWith(c);
                  return <button key={c} type="button" lang={c} aria-pressed={on} onClick={() => void i18n.changeLanguage(c)} data-testid={`welcome-lang-${c}`} className={cn("min-h-12 rounded-xl border px-4 text-base font-semibold transition-colors", on ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent")}>{label}</button>;
                })}
              </div>
            </fieldset>
            <fieldset className="space-y-2"><legend className="flex items-center gap-2 text-sm font-medium"><Globe2 className="h-4 w-4 text-ocean" aria-hidden="true" />{t("welcome.language.market")}</legend>
              <div className="space-y-2">
                {marketRows.map((m) => {
                  const on = m.code === market;
                  return (
                    <button key={m.code} type="button" aria-pressed={on} onClick={() => setMarket(m.code)} data-testid={`welcome-market-${m.code}`} className={cn("flex min-h-12 w-full items-center justify-between gap-3 rounded-xl border px-4 text-start text-base font-semibold transition-colors", on ? "border-primary bg-accent" : "hover:bg-accent")}>
                      <span>{regionName(m.code, i18n.language)}</span>
                      <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-semibold", m.live ? "bg-success-soft text-foreground" : "bg-warning-soft text-foreground")}>{m.live ? t("welcome.language.live") : t("welcome.language.soon")}</span>
                    </button>
                  );
                })}
              </div>
              {marketRows.find((m) => m.code === market && !m.live) && <p className="text-sm text-muted-foreground" data-testid="welcome-market-soon">{t("welcome.language.soonNote")}</p>}
            </fieldset>
          </div>
        )}

        {step === 3 && (
          <fieldset className="space-y-3"><legend className="sr-only">{t("welcome.interests.title")}</legend>
            <div className="flex flex-wrap gap-2">
              {INTERESTS.map((i) => {
                const on = picked.includes(i);
                return <button key={i} type="button" aria-pressed={on} data-testid={`welcome-interest-${i}`} onClick={() => setPicked(on ? picked.filter((x) => x !== i) : [...picked, i])} className={cn("kx-chip", on && "border-primary bg-accent")}>{on && <Check className="h-4 w-4" aria-hidden="true" />}{t(`welcome.interests.items.${i}`)}</button>;
              })}
            </div>
            <p className="text-xs text-muted-foreground">{t("welcome.deviceNote")}</p>
          </fieldset>
        )}

        {step === 4 && (
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-4 rounded-xl border p-4">
              <Label htmlFor="ob-analytics" className="text-base leading-snug">{t("welcome.privacy.analytics")}</Label>
              <Switch id="ob-analytics" checked={analytics} onCheckedChange={setAnalytics} data-testid="welcome-analytics" />
            </div>
            <p className="flex items-start gap-2 text-sm text-muted-foreground"><Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />{t("welcome.privacy.service")}</p>
            <p className="text-sm"><Link to="/preferences" target="_blank" className="font-medium text-primary underline underline-offset-4">{t("welcome.privacy.link")}</Link></p>
          </div>
        )}

        {step === 5 && (
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-4 rounded-xl border p-4">
              <Label htmlFor="ob-reminders" className="text-base leading-snug">{t("welcome.notify.reminders")}</Label>
              <Switch id="ob-reminders" checked={reminders} onCheckedChange={setReminders} data-testid="welcome-reminders" />
            </div>
            <fieldset className="space-y-2 rounded-xl border p-4"><legend className="px-1 text-sm font-medium">{t("welcome.notify.offers")}</legend>
              {CHANNELS.map((c) => (
                <div key={c} className="flex items-center justify-between gap-4 py-1"><Label htmlFor={`ob-o-${c}`} className="text-base">{t(`consent.centre.channel.${c}`)}</Label><Switch id={`ob-o-${c}`} checked={!!offers[c]} onCheckedChange={(v) => setOffers({ ...offers, [c]: v })} data-testid={`welcome-offer-${c}`} /></div>
              ))}
              {!prefs.marketing.available && <p className="pt-1 text-xs text-muted-foreground">{t("welcome.notify.notAvailable")}</p>}
            </fieldset>
          </div>
        )}

        {err && <p role="alert" className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive" data-testid="welcome-error">{t("welcome.saveError")}</p>}

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
          {step > 0 ? <Button type="button" variant="ghost" onClick={() => goto(step - 1)} disabled={busy} data-testid="welcome-back"><ArrowLeft className="rtl-flip" aria-hidden="true" />{t("welcome.back")}</Button> : <span />}
          <div className="flex flex-wrap items-center gap-2">
            {optionalStep && <Button type="button" variant="outline" onClick={() => goto(step + 1)} disabled={busy} data-testid="welcome-skip">{t("welcome.skip")}</Button>}
            <Button type="button" size="lg" onClick={primary} disabled={busy || (step === 1 && nameBad)} data-testid="welcome-next">{busy ? t("welcome.saving") : primaryLabel}{!busy && step < TOTAL_STEPS - 1 && <ArrowRight className="rtl-flip" aria-hidden="true" />}</Button>
          </div>
        </div>
      </section>
    </>,
  );
}
