import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { PauseCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/api/errors";
import { PulseLoader } from "./PulseLine";
import { StateArt } from "./kit";

export function LoadingState({ label }: { label?: string }) {
  const { t } = useTranslation();
  return <PulseLoader label={label ?? t("states.loading")} />;
}

export function CardSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-4" aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="kx-card flex gap-4 p-5">
          <Skeleton className="h-16 w-16 rounded-full" />
          <div className="flex-1 space-y-3"><Skeleton className="h-5 w-1/2" /><Skeleton className="h-4 w-1/3" /><Skeleton className="h-11 w-full" /></div>
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ title, hint, action, icon, art = "empty" }: { title: string; hint?: string; action?: ReactNode; icon?: ReactNode; art?: "empty" | "search" | "offline" }) {
  return (
    <div className="kx-card flex flex-col items-center gap-3 px-6 py-12 text-center" data-testid="empty-state">
      {icon ? <div className="text-muted-foreground">{icon}</div> : <StateArt kind={art} />}
      <h3 className="text-lg">{title}</h3>
      {hint && <p className="max-w-md text-sm text-muted-foreground">{hint}</p>}
      {action}
    </div>
  );
}

/** Flag OFF ⇒ 'temporarily unavailable' in AR/EN (KX-08 §08). Never hides existing data elsewhere. */
export function UnavailableState({ featureKey }: { featureKey?: string }) {
  const { t } = useTranslation();
  return (
    <div role="status" className="kx-card flex flex-col items-center gap-3 px-6 py-12 text-center" data-testid="feature-unavailable" data-feature={featureKey}>
      <PauseCircle className="h-10 w-10 text-ocean" aria-hidden="true" />
      <h3 className="text-lg">{t("unavailable.title")}</h3>
      <p className="max-w-md text-sm text-muted-foreground">{t("unavailable.body")}</p>
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error?: unknown; onRetry?: () => void }) {
  const { t } = useTranslation();
  if (error instanceof ApiError && error.isFeatureDisabled) return <UnavailableState featureKey={error.featureKey} />;
  return (
    <div role="alert" className="kx-card flex flex-col items-center gap-3 border-destructive/40 px-6 py-10 text-center" data-testid="error-state">
      <StateArt kind="error" className="h-20 w-20" />
      <h3 className="text-lg">{t("states.errorTitle")}</h3>
      <p className="max-w-md text-sm text-muted-foreground">{t("states.errorBody")}</p>
      {onRetry && <Button variant="outline" onClick={onRetry}>{t("states.retry")}</Button>}
    </div>
  );
}
