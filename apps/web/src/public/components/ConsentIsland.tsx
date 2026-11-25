import { useEffect, useRef, useState } from "react";
import { CONSENT_TEXT_PLACEHOLDER, needsDecision, readConsent, saveConsent } from "@/lib/consent";
import type { TemplateCtx } from "../types";

/** What the server says about the visitor key in this market (`available` = growth.analytics_visitor is effective; launch-locked, so false until a human records the gate). */
export async function fetchConsentAvailability(cc: string, fetchFn: typeof fetch = globalThis.fetch.bind(globalThis)): Promise<{ available: boolean; textVersion: string }> {
  try {
    const r = await fetchFn("/api/v1/growth/v1/consent/versions", { headers: { Accept: "application/json", "X-Kiorex-Market": cc.toUpperCase() } });
    if (!r.ok) throw new Error(String(r.status));
    const b = (await r.json()) as { available?: boolean; analytics?: string };
    return { available: b.available === true, textVersion: typeof b.analytics === "string" ? b.analytics : CONSENT_TEXT_PLACEHOLDER };
  } catch { return { available: false, textVersion: CONSENT_TEXT_PLACEHOLDER }; }
}

/**
 * G-20: consent banner island for the server-rendered public pages. It renders NOTHING on the server and on the first client render (so the cached HTML is the same for every
 * visitor and hydration matches), then asks the API whether the visitor key is available in this market. Hidden while the flag is locked OFF, and hidden once the visitor chose
 * under the current wording version. Accept and Reject are identical (same element, class and size), nothing is pre-ticked, the wording is a versioned draft (NEEDS_HUMAN).
 * The choice goes through the shared `saveConsent` (local first, then the audit row), so the SPA and the public pages read the same record.
 */
export function ConsentIsland({ ctx }: { ctx: TemplateCtx }) {
  const [state, setState] = useState<{ show: boolean; textVersion: string }>({ show: false, textVersion: CONSENT_TEXT_PLACEHOLDER });
  const busy = useRef(false);
  useEffect(() => {
    let live = true;
    void fetchConsentAvailability(ctx.cc).then((a) => { if (live && a.available && needsDecision(readConsent(), a.textVersion)) setState({ show: true, textVersion: a.textVersion }); });
    const reopen = () => { void fetchConsentAvailability(ctx.cc).then((a) => { if (live && a.available) setState({ show: true, textVersion: a.textVersion }); }); };
    window.addEventListener("kx:consent:open", reopen);
    return () => { live = false; window.removeEventListener("kx:consent:open", reopen); };
  }, [ctx.cc]);
  if (!state.show) return null;
  const choose = async (analytics: boolean, evidence: string) => {
    if (busy.current) return; busy.current = true;
    setState((s) => ({ ...s, show: false }));
    try { await saveConsent({ analytics, marketing: false }, state.textVersion, { evidence }); } finally { busy.current = false; }
  };
  const draft = state.textVersion.startsWith("TODO_NEEDS_HUMAN");
  return (
    <section className="kxp-consent" role="region" aria-label={ctx.t("consent.region")} data-testid="public-consent">
      <div className="kxp-wrap kxp-consent-row">
        <div className="kxp-consent-text">
          <h2 className="kxp-consent-title">{ctx.t("consent.title")}{draft ? <span className="kxp-chip" data-testid="public-consent-draft">{ctx.t("consent.draft")}</span> : null}</h2>
          <p>{ctx.t("consent.body")} <a href={`/${ctx.locale}/${ctx.cc}/preferences`}>{ctx.t("consent.more")}</a></p>
        </div>
        <div className="kxp-consent-actions">
          <button type="button" className="kxp-btn" onClick={() => void choose(false, "reject")} data-testid="public-consent-reject">{ctx.t("consent.reject")}</button>
          <button type="button" className="kxp-btn" onClick={() => void choose(true, "accept")} data-testid="public-consent-accept">{ctx.t("consent.accept")}</button>
        </div>
      </div>
    </section>
  );
}
