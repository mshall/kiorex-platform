import type { ReactNode } from "react";
import { useFlags } from "@/api/hooks";
import { UnavailableState } from "@/components/states";

type FlagEntry = { enabled: boolean; scope?: string; reason?: string };

/** Effective flag value. While loading or if the control plane is unreachable we fail open (code default = ON);
 *  the API still enforces with 403 FEATURE_DISABLED, which the UI also renders as 'unavailable'.
 *  `awaiting` = launch-locked and no gate evidence recorded yet (ADR-024) → "awaiting approval" copy, not "temporarily unavailable". */
export function useFeature(key: string) {
  const { data, isLoading } = useFlags();
  const entry = (data?.flags as Record<string, FlagEntry> | undefined)?.[key];
  return { enabled: entry ? entry.enabled : true, scope: entry?.scope, awaiting: entry?.reason === "AWAITING_GATE" || entry?.scope === "GATE", isLoading };
}

export function FeatureGate({ flag, children, fallback }: { flag: string; children: ReactNode; fallback?: ReactNode }) {
  const { enabled, awaiting } = useFeature(flag);
  return <>{enabled ? children : fallback ?? <UnavailableState featureKey={flag} awaiting={awaiting} />}</>;
}
