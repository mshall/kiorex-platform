import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowRight, Building2, Info, LogIn, ShieldCheck, TriangleAlert, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/auth/AuthProvider";
import { useMarkets } from "@/api/services";
import { regionName, useMarket } from "@/components/MarketSelector";
import { LoadingState } from "@/components/states";
import { KIORLY_JOIN_URL } from "@/lib/hosts";
import { safeNext } from "@/lib/onboarding";
import { cn } from "@/lib/utils";

type Mode = "signin" | "register";

/** The Kiorex entry: `/signin` and `/join`. Sign in or create an account, then Passport (phone verification), then back here. Never a dead end: browsing and the provider path stay one tap away. */
export default function EntryPage({ initial }: { initial: Mode }) {
  const { t, i18n } = useTranslation();
  const { status, login } = useAuth();
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const mode: Mode = initial;
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const returnTo = safeNext(sp.get("returnTo"));
  const reason = sp.get("reason");
  const market = useMarket();
  const markets = useMarkets();
  const row = markets.data?.find((m) => m.code === market);
  const notLive = !!markets.data && !(row && row.live);
  const join = mode === "register";

  if (status === "loading") return <LoadingState />;

  const go = async () => {
    setBusy(true); setFailed(false);
    try { await login(returnTo, { intent: mode }); } catch { setBusy(false); setFailed(true); }
  };
  const note = failed ? "unavailable" : reason === "cancelled" ? "cancelled" : reason === "expired" ? "expired" : reason === "required" ? "required" : reason === "error" ? "error" : null;
  const tab = (m: Mode, label: string, Icon: typeof LogIn) => (
    <button type="button" role="tab" id={`tab-${m}`} aria-selected={mode === m} aria-controls="entry-panel" tabIndex={mode === m ? 0 : -1} data-testid={`entry-tab-${m}`}
      onClick={() => nav(`${m === "register" ? "/join" : "/signin"}${window.location.search}`, { replace: true })}
      onKeyDown={(e) => { if (e.key === "ArrowLeft" || e.key === "ArrowRight") { const o: Mode = m === "signin" ? "register" : "signin"; nav(`${o === "register" ? "/join" : "/signin"}${window.location.search}`, { replace: true }); setTimeout(() => document.getElementById(`tab-${o}`)?.focus(), 0); } }}
      className={cn("inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition-colors", mode === m ? "bg-primary text-primary-foreground shadow-raised" : "text-muted-foreground hover:bg-accent")}>
      <Icon className="h-4 w-4 rtl-flip" aria-hidden="true" />{label}
    </button>
  );

  return (
    <div className="mx-auto grid max-w-5xl items-start gap-8 py-4 md:py-10 lg:grid-cols-[1fr_0.9fr]">
      <section className="kx-card space-y-6 p-6 md:p-8" aria-labelledby="entry-title" data-testid="entry">
        <div role="tablist" aria-label={t("entry.signinTab") + " / " + t("entry.joinTab")} className="flex gap-1 rounded-2xl bg-muted p-1">
          {tab("signin", t("entry.signinTab"), LogIn)}{tab("register", t("entry.joinTab"), UserPlus)}
        </div>
        <div role="tabpanel" id="entry-panel" aria-labelledby={`tab-${mode}`} className="space-y-5">
          <div className="space-y-2">
            <h1 id="entry-title" className="text-3xl md:text-4xl">{join ? t("entry.joinTitle") : t("entry.signinTitle")}</h1>
            <p className="text-muted-foreground">{join ? t("entry.joinLead") : t("entry.signinLead")}</p>
          </div>
          {note && (
            <p role={note === "cancelled" || note === "required" || note === "expired" ? "status" : "alert"} data-testid={`entry-note-${note}`}
              className={cn("flex items-start gap-2 rounded-xl border px-4 py-3 text-sm", note === "error" || note === "unavailable" ? "border-destructive/40 bg-destructive/10 text-destructive" : "border-info/30 bg-info-soft text-foreground")}>
              {note === "error" || note === "unavailable" ? <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> : <Info className="mt-0.5 h-4 w-4 shrink-0 text-ocean" aria-hidden="true" />}{t(`entry.${note}`)}
            </p>
          )}
          {notLive && <p className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning-soft px-4 py-3 text-sm text-foreground" data-testid="entry-market-soon"><Info className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />{t("entry.marketSoon", { country: regionName(market, i18n.language) })}</p>}
          {status === "signedIn" ? (
            <div className="space-y-3"><p className="text-sm">{t("entry.alreadyIn")}</p><Button asChild size="lg"><Link to={returnTo}>{t("nav.home")}</Link></Button></div>
          ) : (
            <Button size="lg" className="w-full sm:w-auto" onClick={() => void go()} disabled={busy} data-testid="entry-continue">
              {busy ? t("welcome.saving") : join ? t("entry.continueJoin") : t("entry.continue")}<ArrowRight className="rtl-flip" aria-hidden="true" />
            </Button>
          )}
          <p className="flex items-start gap-2 text-sm text-muted-foreground"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-ocean" aria-hidden="true" />{t("entry.passportNote")}</p>
          <p className="text-sm"><Link to="/search" className="font-medium text-primary underline underline-offset-4">{t("entry.browse")}</Link></p>
        </div>
      </section>

      <aside className="space-y-4" aria-label={t("entry.how")}>
        <section className="kx-card space-y-4 p-6">
          <h2 className="text-lg">{t("entry.how")}</h2>
          <ol className="space-y-3">
            {(["s1", "s2", "s3"] as const).map((k, i) => (
              <li key={k} className="flex items-start gap-3 text-sm"><span className="kx-label-num flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">{i + 1}</span><span className="pt-0.5">{t(`entry.${k}`)}</span></li>
            ))}
          </ol>
        </section>
        <section className="kx-card flex items-center justify-between gap-3 p-5">
          <div className="min-w-0"><p className="flex items-center gap-2 text-sm font-semibold"><Building2 className="h-4 w-4 text-ocean" aria-hidden="true" />{t("entry.providersQ")}</p></div>
          <a href={KIORLY_JOIN_URL} target="_blank" rel="noopener noreferrer" data-testid="entry-providers" className="inline-flex min-h-11 shrink-0 items-center rounded-xl border px-4 text-sm font-semibold text-ocean hover:bg-accent">{t("entry.providers")}<span className="sr-only"> ({t("lp.kiorly.external")})</span></a>
        </section>
      </aside>
    </div>
  );
}
