import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { PauseCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/api/errors";
import { PulseLoader } from "./PulseLine";
import { StateArt } from "./kit";
import { useOnline } from "@/hooks/useOnline";

/** Sandbox/mock provider notice (CLAUDE.md: mocks are surfaced honestly). Rendered only when the data proves a mock provider is behind it. */
export function MockNotice({ kind, proven = false }: { kind: "payment" | "video" | "messaging" | "lab" | "pharmacy"; proven?: boolean }) {
  const { t } = useTranslation();
  if (!proven && !import.meta.env.DEV) return null; // dev builds always flag mock partners; prod only when the data itself proves a sandbox provider
  return (
    <p role="note" className="rounded-xl border border-dashed border-warning/60 bg-warning-soft px-4 py-2 text-sm text-warning" data-testid="mock-notice" data-kind={kind}>
      <span className="font-semibold">{t("mock.label")}</span> {t(`mock.${kind}`)}
    </p>
  );
}

export function LoadingState({ label }: { label?: string }) {
  const { t } = useTranslation();
  return <PulseLoader label={label ?? t("states.loading")} />;
}

export function CardSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-4" aria-hidden="true" data-testid="card-skeleton">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="kx-card space-y-4 p-5">
          <div className="flex gap-4">
            <Skeleton className="h-20 w-20 shrink-0 rounded-full" />
            <div className="flex-1 space-y-3"><Skeleton className="h-5 w-2/5" /><Skeleton className="h-4 w-3/5" /><div className="flex gap-3"><Skeleton className="h-4 w-16" /><Skeleton className="h-4 w-20" /><Skeleton className="h-4 w-24" /></div></div>
          </div>
          <div className="space-y-2 rounded-xl bg-muted/60 p-3"><Skeleton className="h-3 w-24" /><div className="flex gap-2"><Skeleton className="h-11 w-20 rounded-xl" /><Skeleton className="h-11 w-20 rounded-xl" /><Skeleton className="h-11 w-20 rounded-xl" /><Skeleton className="hidden h-11 w-20 rounded-xl sm:block" /></div></div>
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ title, hint, action, icon, art = "empty" }: { title: string; hint?: string; action?: ReactNode; icon?: ReactNode; art?: "empty" | "search" | "offline" }) {
  return (
    <div className="kx-card flex flex-col items-center gap-3 px-6 py-12 text-center" data-testid="empty-state">
      {icon ? <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-accent text-primary [&_svg]:h-8 [&_svg]:w-8">{icon}</div> : <StateArt kind={art} />}
      <h3 className="text-lg">{title}</h3>
      {hint && <p className="max-w-md text-sm text-muted-foreground">{hint}</p>}
      {action}
    </div>
  );
}

/** Flag OFF ⇒ 'temporarily unavailable' in AR/EN (KX-08 §08). Never hides existing data elsewhere. */
export function UnavailableState({ featureKey, awaiting }: { featureKey?: string; awaiting?: boolean }) {
  const { t } = useTranslation();
  return (
    <div role="status" className="kx-card flex flex-col items-center gap-3 px-6 py-12 text-center" data-testid="feature-unavailable" data-feature={featureKey} data-awaiting={awaiting ? "true" : undefined}>
      <PauseCircle className="h-10 w-10 text-ocean" aria-hidden="true" />
      <h3 className="text-lg">{awaiting ? t("unavailable.awaitingTitle") : t("unavailable.title")}</h3>
      <p className="max-w-md text-sm text-muted-foreground">{awaiting ? t("unavailable.awaitingBody") : t("unavailable.body")}</p>
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error?: unknown; onRetry?: () => void }) {
  const { t } = useTranslation();
  const online = useOnline();
  if (error instanceof ApiError && error.isFeatureDisabled) return <UnavailableState featureKey={error.featureKey} awaiting={error.isAwaitingApproval} />;
  if (!online) return <OfflineState onRetry={onRetry} />;
  return (
    <div role="alert" className="kx-card flex flex-col items-center gap-3 border-destructive/40 px-6 py-10 text-center" data-testid="error-state">
      <StateArt kind="error" className="h-24 w-24" />
      <h3 className="text-lg">{t("states.errorTitle")}</h3>
      <p className="max-w-md text-sm text-muted-foreground">{t("states.errorBody")}</p>
      {onRetry && <Button variant="outline" onClick={onRetry}>{t("states.retry")}</Button>}
      <p className="text-xs text-muted-foreground">{t("p3.errorId")}</p>
    </div>
  );
}

/** Shown instead of the generic error when the browser reports no connection. */
export function OfflineState({ onRetry }: { onRetry?: () => void }) {
  const { t } = useTranslation();
  return (
    <div role="status" className="kx-card flex flex-col items-center gap-3 px-6 py-12 text-center" data-testid="offline-state">
      <StateArt kind="offline" className="h-28 w-28" />
      <h3 className="text-lg">{t("p3.offlineTitle")}</h3>
      <p className="max-w-md text-sm text-muted-foreground">{t("p3.offlineBody")}</p>
      {onRetry && <Button variant="outline" onClick={onRetry}>{t("states.retry")}</Button>}
    </div>
  );
}
