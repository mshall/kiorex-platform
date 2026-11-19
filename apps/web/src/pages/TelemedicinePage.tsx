import { useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { CalendarCheck, Video } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/api/errors";
import { useBookings, useSpecialties } from "@/api/hooks";
import { useCreateTeleSession, useTeleProviders, useTeleSessions, type TeleSession } from "@/api/services";
import { CardSkeleton, EmptyState, ErrorState, MockNotice, UnavailableState } from "@/components/states";
import { useFeature } from "@/hooks/useFeature";
import { formatDateTime, pick } from "@/lib/format";
import { cn } from "@/lib/utils";

export const sessionVariant = (s: TeleSession["status"]) => (s === "IN_PROGRESS" ? "success" : s === "WAITING" ? "warning" : s === "ENDED" || s === "CANCELLED" ? "secondary" : "info") as "success" | "warning" | "secondary" | "info";

export default function TelemedicinePage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const feat = useFeature("kiorex.telemedicine");
  const [specialty, setSpecialty] = useState("");
  const [q, setQ] = useState("");
  const [term, setTerm] = useState("");
  const specialties = useSpecialties();
  const providers = useTeleProviders(specialty, term);
  const sessions = useTeleSessions();
  const bookings = useBookings();
  const create = useCreateTeleSession();
  const withSession = new Set((sessions.data ?? []).map((s) => s.bookingId));
  const eligible = (bookings.data ?? []).filter((b) => b.status === "CONFIRMED" && !withSession.has(b.id));
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3"><Video className="h-7 w-7 text-ocean" aria-hidden="true" /><h1 className="text-2xl">{t("tele.title")}</h1></div>
      <p className="max-w-2xl text-muted-foreground">{t("tele.intro")}</p>
      <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm" role="note" data-testid="tele-emergency">{t("tele.emergency")}</div>

      <section className="space-y-3" aria-labelledby="sess-h">
        <h2 id="sess-h" className="text-xl">{t("tele.mySessions")}</h2>
        {sessions.isLoading ? <CardSkeleton rows={1} /> : sessions.error ? <ErrorState error={sessions.error} onRetry={() => void sessions.refetch()} /> : sessions.data!.length === 0 ? <EmptyState icon={<Video className="h-10 w-10" aria-hidden="true" />} title={t("tele.noSessions")} hint={t("tele.noSessionsHint")} /> : (
          <ul className="space-y-3" data-testid="tele-sessions">
            {sessions.data!.map((s) => (
              <li key={s.id}><Link to={`/telemedicine/${s.id}`} className="kx-card flex items-center justify-between gap-3 p-4 hover:border-primary" data-testid="tele-session-row">
                <div><p className="font-semibold">{formatDateTime(s.scheduledStartsAt, lang)}</p><p className="text-sm text-muted-foreground">{t("tele.joinOpens", { time: formatDateTime(s.joinOpensAt, lang) })}</p></div>
                <Badge variant={sessionVariant(s.status)}>{t(`tele.status.${s.status}`)}</Badge>
              </Link></li>
            ))}
          </ul>
        )}
        {eligible.length > 0 && (
          <div className="kx-card space-y-3 p-5" data-testid="tele-eligible">
            <h3 className="text-lg">{t("tele.eligibleTitle")}</h3><p className="text-sm text-muted-foreground">{t("tele.eligibleHint")}</p>
            <ul className="space-y-2">{eligible.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm"><CalendarCheck className="me-1 inline h-4 w-4" aria-hidden="true" />{pick(b.doctor, "name", lang)} · {formatDateTime(b.startsAt, lang)}</span>
                <Button size="sm" disabled={create.isPending || !feat.enabled} data-testid="tele-create" onClick={() => create.mutate(b.id, { onSuccess: () => toast.success(t("tele.created")), onError: (e) => toast.error(e instanceof ApiError && e.isFeatureDisabled ? t("unavailable.title") : t("tele.errors.generic")) })}>{t("tele.createSession")}</Button></li>
            ))}</ul>
          </div>
        )}
      </section>

      <section className="space-y-3" aria-labelledby="prov-h">
        <h2 id="prov-h" className="text-xl">{t("tele.providers")}</h2>
        {!feat.enabled ? <UnavailableState featureKey="kiorex.telemedicine" awaiting={feat.awaiting} /> : (
          <>
            <form role="search" className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); setTerm(q.trim()); }}>
              <div><Label htmlFor="tele-spec" className="sr-only">{t("search.specialties")}</Label>
                <select id="tele-spec" value={specialty} onChange={(e) => setSpecialty(e.target.value)} className="h-11 rounded-xl border border-input bg-card px-3 text-sm" data-testid="tele-specialty">
                  <option value="">{t("tele.anySpecialty")}</option>
                  {specialties.data?.map((s) => <option key={s.code} value={s.code}>{pick(s, "name", lang)}</option>)}
                </select></div>
              <div className="min-w-48 flex-1"><Label htmlFor="tele-q" className="sr-only">{t("search.label")}</Label><Input id="tele-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("search.placeholder")} /></div>
              <Button type="submit">{t("search.submit")}</Button>
            </form>
            {providers.isLoading ? <CardSkeleton rows={2} /> : providers.error ? <ErrorState error={providers.error} onRetry={() => void providers.refetch()} /> : !providers.data!.items.length ? <EmptyState title={t("tele.noProviders")} hint={t("tele.noProvidersHint")} /> : (
              <ul className="space-y-3" data-testid="tele-providers">
                {providers.data!.items.map((p) => (
                  <li key={p.id} className="kx-card flex flex-wrap items-center justify-between gap-3 p-4" data-testid="tele-provider">
                    <div><p className="font-semibold">{pick(p, "name", lang)}</p><p className="text-sm text-muted-foreground">{specialties.data?.find((s) => s.code === p.specialty) ? pick(specialties.data.find((s) => s.code === p.specialty)!, "name", lang) : p.specialty ?? ""}{p.nextSlots?.[0]?.startsAt ? ` · ${t("results.nextSlots")}: ${formatDateTime(p.nextSlots[0].startsAt, lang)}` : ""}</p></div>
                    <Link to={`/doctors/${p.id}${p.defaultTypeId ? `?vt=${encodeURIComponent(p.defaultTypeId)}` : ""}`} className={cn(buttonVariants({ size: "sm" }))}>{t("tele.book")}</Link>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>
      <MockNotice kind="video" />
    </div>
  );
}
