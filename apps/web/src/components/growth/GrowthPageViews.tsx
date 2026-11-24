import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { CONSENT_CHANGED_EVENT } from "@/lib/consent";
import { flushGrowth, trackGrowth } from "@/lib/growth";
import { landingKindFor } from "@/lib/consent";
import { captureLinkToken } from "@/lib/linkToken";

/** One PageViewed per route (landing kind only: no path, no query, no id), flushes when the visitor decides and on page hide; keeps the provider link token for the tab. */
export function GrowthPageViews() {
  const loc = useLocation();
  useEffect(() => {
    captureLinkToken(loc.search);
    trackGrowth("PageViewed", { landingKind: landingKindFor(loc.pathname) as never });
  }, [loc.pathname, loc.search]);
  useEffect(() => {
    const onChoice = () => flushGrowth();
    const onHide = () => { if (document.visibilityState === "hidden") flushGrowth(true); };
    window.addEventListener(CONSENT_CHANGED_EVENT, onChoice);
    document.addEventListener("visibilitychange", onHide);
    return () => { window.removeEventListener(CONSENT_CHANGED_EVENT, onChoice); document.removeEventListener("visibilitychange", onHide); };
  }, []);
  return null;
}
