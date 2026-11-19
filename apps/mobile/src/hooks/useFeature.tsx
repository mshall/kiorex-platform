import type { ReactNode } from "react";
import { useFlags } from "@/api/hooks";
import { UnavailableState } from "@/components/states";

/** Effective flag value. While loading or if the control plane is unreachable we fail open (code default = ON);
 *  the API still enforces with 403 FEATURE_DISABLED, which the UI also renders as 'temporarily unavailable'. */
export function useFeature(key: string) {
  const { data, isLoading } = useFlags();
  const entry = data?.flags?.[key];
  return { enabled: entry ? entry.enabled : true, scope: entry?.scope, isLoading };
}

export function FeatureGate({ flag, children, fallback }: { flag: string; children: ReactNode; fallback?: ReactNode }) {
  const { enabled, scope } = useFeature(flag);
  return <>{enabled ? children : fallback ?? <UnavailableState featureKey={flag} scope={scope} />}</>;
}
