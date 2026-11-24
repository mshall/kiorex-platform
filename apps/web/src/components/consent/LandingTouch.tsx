import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { CONSENT_CHANGED_EVENT, readConsent, sendTouch, touchBodyFrom } from "@/lib/consent";

const RENDERED_MS = 1200;
let sentFor = "";

/**
 * Sends ONE landing touch per page load, and only once analytics consent exists (sendTouch does nothing otherwise: no request, no storage).
 * It waits until the page has actually been on screen (`dwellMs`), which is what lets a provider-link landing count as a real touch and a bare redirect not.
 */
export function LandingTouch() {
  const loc = useLocation();
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      if (!readConsent()?.analytics || sentFor === loc.key + loc.search) return;
      const started = performance.now();
      timer = setTimeout(() => { sentFor = loc.key + loc.search; void sendTouch(touchBodyFrom(loc.search, loc.pathname, Math.round(performance.now() - started))); }, RENDERED_MS);
    };
    arm();
    const onChange = () => { if (timer) clearTimeout(timer); arm(); };
    window.addEventListener(CONSENT_CHANGED_EVENT, onChange);
    return () => { if (timer) clearTimeout(timer); window.removeEventListener(CONSENT_CHANGED_EVENT, onChange); };
  }, [loc.key, loc.search, loc.pathname]);
  return null;
}
