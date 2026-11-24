import { useEffect } from "react";
import { useRouter } from "expo-router";
import { useAuth } from "@/auth/AuthProvider";
import { loadBootstrap } from "@/lib/bootstrap";
import { readInstallReferrerOnce } from "@/lib/deferred-link";
import { getGrowthConsent } from "@/lib/growthConsent";
import { getPendingRef, sendPendingTouch } from "@/lib/linkRef";
import { takePendingRoute } from "@/lib/pendingRoute";

/**
 * Mount once under AuthProvider (GRW-P1-H).
 * 1. Warms the bootstrap cache (market-aware link routing reads it).
 * 2. Replays a held appointment link after sign-in (the link itself never signs in).
 * 3. First run on Android: reads the install referrer once; a found ref opens the consent screen (consent first).
 * 4. Sends the pending ref only when growth consent is granted.
 */
export function useDeepLinkRouting() {
  const router = useRouter();
  const { status } = useAuth();
  useEffect(() => {
    void loadBootstrap();
    void (async () => {
      const ref = await readInstallReferrerOnce();
      if (ref && (await getGrowthConsent()) === null) router.push(`/r/${ref.code}?k=${ref.kind === "provider" ? "p" : "r"}` as never);
      else if ((await getGrowthConsent()) === "granted") void sendPendingTouch();
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (status !== "signedIn") return;
    const p = takePendingRoute();
    if (p) router.push(p as never);
    void (async () => { if ((await getGrowthConsent()) === "granted" && (await getPendingRef())) void sendPendingTouch(); })();
  }, [status]); // eslint-disable-line react-hooks/exhaustive-deps
}
