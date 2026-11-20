import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";
import { toast } from "sonner";
import { Check, CircleDot, HeartPulse } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePublicVisitStatus, useStopVisitStatus } from "@/api/home";
import { ApiError } from "@/api/errors";
import { EmptyState, ErrorState, LoadingState } from "@/components/states";
import { Logo } from "@/components/Logo";
import { formatDayLong, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";

/** KXMHV07 family link (no login): visit status only. The API never returns the address, fee, phone or any reason; neither do we render them. */
export default function VisitStatusPage() {
  const { token = "" } = useParams();
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const q = usePublicVisitStatus(token);
  const stop = useStopVisitStatus(token);
  const gone = q.error instanceof ApiError && q.error.status === 404;
  return (
    <main className="container mx-auto max-w-xl space-y-5 py-8" aria-labelledby="vs-title">
      <Logo />
      {q.isLoading ? <LoadingState /> : gone ? <EmptyState title={t("hv.linkGoneTitle")} hint={t("hv.linkGoneBody")} /> : q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : (() => {
        const s = q.data!; const steps = s.steps as { key: string; at: string | null; reached: boolean }[]; const eta = s.eta as { minutes?: number | null; shared?: boolean };
        return (
          <>
            <h1 id="vs-title" className="flex items-center gap-2 text-2xl"><HeartPulse className="h-6 w-6 text-pulse" aria-hidden="true" />{t("hv.familyTitle", { name: s.patientFirstName ?? "" })}</h1>
            <p className="text-muted-foreground" data-testid="family-when">{formatDayLong(s.startsAt, lang)} · <span dir="ltr">{formatTime(s.startsAt, lang)}</span></p>
            {s.stopped ? <div role="status" className="kx-card p-4" data-testid="family-stopped">{t("hv.familyStopped")}</div> : (
              <>
                {s.provider && <p className="kx-card p-4 text-sm" data-testid="family-provider">{t("hv.familyProvider", { name: (s.provider as { displayName?: string }).displayName ?? "" })}</p>}
                {eta.shared && eta.minutes != null && <p role="status" className="font-medium" data-testid="family-eta">{t("hv.eta", { count: eta.minutes })}</p>}
                <ol className="kx-card space-y-3 p-5" aria-label={t("hv.progressTitle")} data-testid="family-steps">
                  {steps.map((st) => (
                    <li key={st.key} className="flex items-center gap-3" data-reached={st.reached}>
                      <span className={cn("flex h-6 w-6 items-center justify-center rounded-full border-2", st.reached ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40")}>{st.reached ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <CircleDot className="h-3 w-3 text-muted-foreground" aria-hidden="true" />}</span>
                      <span className={cn("font-medium", !st.reached && "text-muted-foreground")}>{t(`hv.step.${st.key}`, { defaultValue: st.key })}</span>
                    </li>
                  ))}
                </ol>
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
