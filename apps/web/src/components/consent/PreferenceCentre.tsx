import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { BellRing, Cookie, ShieldCheck, Megaphone, Moon, LockKeyhole } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CardSkeleton, ErrorState } from "@/components/states";
import { StatusChip } from "@/components/kit";
import { useAuth } from "@/auth/AuthProvider";
import { usePreferences, useUnsubscribeMarketing, useUpdatePreferences, type MarketingChannel, type PreferencesUpdate } from "@/api/consent";
import { openConsentPreferences } from "@/lib/consent";
import { useVisitorConsent } from "./useVisitorConsent";

const CHANNELS: MarketingChannel[] = ["WHATSAPP", "SMS", "EMAIL", "PUSH"];
const HOURS = Array.from({ length: 24 }, (_, h) => h);
const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;

/** The patient preference centre (GRW-P1-I): service messages (required), reminders, measurement, per-channel marketing, quiet hours, unsubscribe-all, cookie choice. */
export function PreferenceCentre() {
  const { t } = useTranslation();
  const { status, login } = useAuth();
  const signedIn = status === "signedIn";
  const q = usePreferences(signedIn);
  const update = useUpdatePreferences();
  const unsub = useUnsubscribeMarketing();
  const { consent } = useVisitorConsent();
  const fail = () => toast.error(t("consent.centre.error"));
  const ok = () => toast.success(t("consent.centre.saved"));
  const change = (b: PreferencesUpdate) => update.mutate(b, { onSuccess: ok, onError: fail });

  return (
    <div className="space-y-6" data-testid="preference-centre">
      <section className="kx-card space-y-3 p-4" aria-labelledby="pc-cookies">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent text-primary" aria-hidden="true"><Cookie className="h-5 w-5" /></span>
          <div className="min-w-0 flex-1"><h2 id="pc-cookies" className="text-lg">{t("consent.centre.cookiesTitle")}</h2><p className="text-sm text-muted-foreground">{t("consent.centre.cookiesBody")}</p>
            <p className="mt-2"><StatusChip tone={consent?.analytics ? "success" : "neutral"} data-testid="pc-cookie-state">{consent?.analytics ? t("consent.centre.cookiesOn") : t("consent.centre.cookiesOff")}</StatusChip></p></div>
          <Button variant="outline" className="min-h-11" onClick={openConsentPreferences} data-testid="pc-open-cookies">{t("consent.centre.cookiesOpen")}</Button>
        </div>
      </section>

      {!signedIn ? (
        <section className="kx-card flex flex-wrap items-center justify-between gap-3 p-4">
          <p className="text-sm text-muted-foreground">{t("consent.centre.signInHint")}</p>
          <Button className="min-h-11" onClick={() => void login()}>{t("consent.centre.signIn")}</Button>
        </section>
      ) : q.isLoading ? <CardSkeleton rows={3} /> : q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : q.data && (
        <>
          {q.data.draftWording && import.meta.env.MODE !== "production" && <p><StatusChip tone="warning">{t("consent.banner.draft")}</StatusChip></p>}
          <section className="kx-card space-y-3 p-4" aria-labelledby="pc-service">
            <div className="flex items-start gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent text-primary" aria-hidden="true"><ShieldCheck className="h-5 w-5" /></span>
              <div><h2 id="pc-service" className="text-lg">{t("consent.centre.serviceTitle")}</h2><p className="text-sm text-muted-foreground">{t("consent.centre.serviceBody")}</p></div></div>
            <ul className="space-y-2">
              {q.data.serviceMessages.map((s) => (
                <li key={s.purpose} className="flex items-center justify-between gap-3 text-sm"><span className="inline-flex items-center gap-2"><LockKeyhole className="h-4 w-4 text-muted-foreground" aria-hidden="true" />{t(`consent.centre.${s.purpose.toLowerCase()}`)}</span><StatusChip tone="success">{t("consent.centre.required")}</StatusChip></li>
              ))}
            </ul>
          </section>

          <section className="kx-card space-y-3 p-4" aria-labelledby="pc-classes" data-testid="pc-classes">
            <div><h2 id="pc-classes" className="text-lg">{t("consent.centre.classesTitle")}</h2><p className="text-sm text-muted-foreground">{t("consent.centre.classesBody")}</p></div>
            <dl className="space-y-3">
              {(["TRANSACTIONAL", "SECURITY", "CLINICAL", "MARKETING"] as const).map((c) => (
                <div key={c} className="space-y-1" data-testid={`pc-class-${c}`}>
                  <dt className="flex flex-wrap items-center gap-2 text-sm font-semibold">{t(`consent.centre.classes.${c}.name`)}<StatusChip tone={c === "MARKETING" ? "neutral" : "success"}>{c === "MARKETING" ? t("consent.centre.classOptional") : t("consent.centre.classRequired")}</StatusChip></dt>
                  <dd className="text-sm text-muted-foreground">{t(`consent.centre.classes.${c}.body`)}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="kx-card space-y-4 p-4" aria-labelledby="pc-choices">
            <h2 id="pc-choices" className="sr-only">{t("consent.centre.title")}</h2>
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent text-primary" aria-hidden="true"><BellRing className="h-5 w-5" /></span>
                <div><Label htmlFor="pc-reminders" className="text-base">{t("consent.centre.remindersTitle")}</Label><p className="text-sm text-muted-foreground">{t("consent.centre.remindersBody")}</p></div></div>
              <Switch id="pc-reminders" checked={q.data.reminders.consent} onCheckedChange={(v) => change({ reminders: v })} data-testid="pc-reminders" />
            </div>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0"><Label htmlFor="pc-analytics" className="text-base">{t("consent.centre.analyticsTitle")}</Label><p className="text-sm text-muted-foreground">{t("consent.centre.analyticsBody")}</p></div>
              <Switch id="pc-analytics" checked={q.data.analytics.consent} onCheckedChange={(v) => change({ analytics: v })} data-testid="pc-analytics" />
            </div>
          </section>

          <section className="kx-card space-y-3 p-4" aria-labelledby="pc-marketing">
            <div className="flex items-start gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent text-primary" aria-hidden="true"><Megaphone className="h-5 w-5" /></span>
              <div><h2 id="pc-marketing" className="text-lg">{t("consent.centre.marketingTitle")}</h2><p className="text-sm text-muted-foreground">{t("consent.centre.marketingBody")}</p>
                {!q.data.marketing.available && <p className="mt-1 text-sm text-muted-foreground" data-testid="pc-marketing-inactive">{t("consent.centre.marketingNotActive")}</p>}</div></div>
            <ul className="divide-y">
              {CHANNELS.map((ch) => {
                const row = q.data!.marketing.channels.find((c) => c.channel === ch);
                return (
                  <li key={ch} className="flex items-center justify-between gap-3 py-3">
                    <div><Label htmlFor={`pc-m-${ch}`} className="text-base">{t(`consent.centre.channel.${ch}`)}</Label>{row?.suppressed && <p className="text-xs text-warning">{t("consent.centre.suppressed")}</p>}</div>
                    <Switch id={`pc-m-${ch}`} checked={row?.marketingConsent ?? false} onCheckedChange={(v) => change({ marketing: { [ch]: v } })} data-testid={`pc-marketing-${ch}`} />
                  </li>
                );
              })}
            </ul>
            <p className="text-xs text-muted-foreground">{t("consent.centre.capsNote", { day: q.data.caps.perDay, week: q.data.caps.perWeek })}</p>
            <Button variant="outline" className="min-h-11" disabled={!q.data.marketing.anyConsent || unsub.isPending} onClick={() => unsub.mutate(undefined, { onSuccess: () => toast.success(t("consent.centre.unsubscribed")), onError: fail })} data-testid="pc-unsubscribe">{t("consent.centre.unsubscribe")}</Button>
          </section>

          <section className="kx-card space-y-3 p-4" aria-labelledby="pc-quiet">
            <div className="flex items-start gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent text-primary" aria-hidden="true"><Moon className="h-5 w-5" /></span>
              <div><h2 id="pc-quiet" className="text-lg">{t("consent.centre.quietTitle")}</h2><p className="text-sm text-muted-foreground">{t("consent.centre.quietBody")}</p>
                <p className="text-xs text-muted-foreground">{t("consent.centre.quietDefault", { start: hh(q.data.quietHours.defaultStart), end: hh(q.data.quietHours.defaultEnd), zone: q.data.quietHours.timezone })}</p></div></div>
            <div className="flex flex-wrap items-end gap-3">
              {(["start", "end"] as const).map((k) => (
                <div key={k} className="space-y-1">
                  <Label htmlFor={`pc-q-${k}`}>{t(k === "start" ? "consent.centre.quietFrom" : "consent.centre.quietTo")}</Label>
                  <Select value={String(q.data!.quietHours[k] ?? (k === "start" ? q.data!.quietHours.defaultStart : q.data!.quietHours.defaultEnd))} onValueChange={(v) => change({ quietHours: { start: k === "start" ? Number(v) : q.data!.quietHours.start ?? q.data!.quietHours.defaultStart, end: k === "end" ? Number(v) : q.data!.quietHours.end ?? q.data!.quietHours.defaultEnd } })}>
                    <SelectTrigger id={`pc-q-${k}`} className="min-h-11 w-32" data-testid={`pc-quiet-${k}`}><SelectValue /></SelectTrigger>
                    <SelectContent>{HOURS.map((h) => <SelectItem key={h} value={String(h)}>{hh(h)}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              ))}
              {q.data.quietHours.start !== null && <Button variant="ghost" className="min-h-11" onClick={() => change({ quietHours: null })}>{t("consent.centre.quietReset")}</Button>}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
