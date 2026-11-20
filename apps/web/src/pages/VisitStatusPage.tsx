import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";
import { toast } from "sonner";
import { HeartPulse, Navigation, ShieldCheck, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePublicVisitStatus, useStopVisitStatus } from "@/api/home";
import { ApiError } from "@/api/errors";
import { EmptyState, ErrorState, LoadingState } from "@/components/states";
import { Logo } from "@/components/Logo";
import { formatDayLong, formatTime } from "@/lib/format";
import { StatusBanner, Timeline } from "@/components/kit";

/** KXMHV07 family link (no login): visit status only. The API never returns the address, fee, phone or any reason; neither do we render them. */
export default function VisitStatusPage() {
  const { token = "" } = useParams();
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const q = usePublicVisitStatus(token);
  const stop = useStopVisitStatus(token);
  const gone = q.error instanceof ApiError && q.error.status === 404;
  return (
    <main className="container mx-auto max-w-xl space-y-5 px-4 py-8" aria-labelledby="vs-title">
      <Logo />
      {q.isLoading ? <LoadingState /> : gone ? <EmptyState title={t("hv.linkGoneTitle")} hint={t("hv.linkGoneBody")} /> : q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : (() => {
        const s = q.data!; const steps = s.steps as { key: string; at: string | null; reached: boolean }[]; const eta = s.eta as { minutes?: number | null; shared?: boolean };
        const showEta = !s.stopped && eta.shared && eta.minutes != null;
        return (
          <>
            <section className="kx-hero relative overflow-hidden rounded-3xl border p-6 shadow-float">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-card text-pulse shadow-card" aria-hidden="true"><HeartPulse className="h-6 w-6" /></span>
              <h1 id="vs-title" className="mt-4 text-2xl md:text-3xl">{t("hv.familyTitle", { name: s.patientFirstName ?? "" })}</h1>
              <p className="mt-1 text-muted-foreground" data-testid="family-when">{formatDayLong(s.startsAt, lang)} · <span dir="ltr" className="kx-label-num">{formatTime(s.startsAt, lang)}</span></p>
              {showEta && <p role="status" className="mt-5 inline-flex items-center gap-2 rounded-full bg-card px-4 py-2 text-lg font-semibold shadow-card" data-testid="family-eta"><Navigation className="h-5 w-5 text-ocean" aria-hidden="true" /><span className="kx-label-num">{t("hv.eta", { count: eta.minutes as number })}</span></p>}
            </section>
            {s.stopped ? <StatusBanner tone="neutral" icon={<ShieldCheck />} data-testid="family-stopped">{t("hv.familyStopped")}</StatusBanner> : (
              <>
                {s.provider && <p className="kx-card flex items-center gap-3 p-4 text-sm" data-testid="family-provider"><span className="flex h-10 w-10 items-center justify-center rounded-full bg-accent text-primary" aria-hidden="true"><UserRound className="h-5 w-5" /></span>{t("hv.familyProvider", { name: (s.provider as { displayName?: string }).displayName ?? "" })}</p>}
                <div className="kx-card p-5" data-testid="family-steps-card"><Timeline label={t("hv.progressTitle")} testId="family-steps" steps={steps.map((st) => ({ key: st.key, reached: st.reached, label: t(`hv.step.${st.key}`, { defaultValue: st.key }) }))} /></div>
                <Button variant="outline" disabled={stop.isPending || stop.isSuccess} data-testid="family-stop" onClick={() => stop.mutate(undefined, { onSuccess: () => { toast.success(t("hv.familyStopDone")); void q.refetch(); }, onError: () => toast.error(t("states.errorTitle")) })}>{t("hv.familyStop")}</Button>
              </>
            )}
            <p className="text-xs text-muted-foreground">{t("hv.familyPrivacy")}</p>
          </>
        );
      })()}
    </main>
  );
}
