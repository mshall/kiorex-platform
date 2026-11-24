import { useCallback, useEffect, useState } from "react";
import { CONSENT_CHANGED_EVENT, CONSENT_TEXT_PLACEHOLDER, fetchTextVersions, readConsent, saveConsent, type ConsentChoice, type StoredConsent } from "@/lib/consent";

/** Shared state of the visitor's cookie choice for the banner, the preference centre and anything that must react to a change. */
export function useVisitorConsent() {
  const [consent, setConsent] = useState<StoredConsent | null>(() => readConsent());
  const [textVersion, setTextVersion] = useState<string>(consent?.textVersion ?? CONSENT_TEXT_PLACEHOLDER);
  useEffect(() => {
    let live = true;
    void fetchTextVersions().then((v) => { if (live) setTextVersion(v.analytics); });
    const onChange = (e: Event) => setConsent((e as CustomEvent<StoredConsent>).detail ?? readConsent());
    window.addEventListener(CONSENT_CHANGED_EVENT, onChange);
    return () => { live = false; window.removeEventListener(CONSENT_CHANGED_EVENT, onChange); };
  }, []);
  const save = useCallback((choice: ConsentChoice, evidence: string) => saveConsent(choice, textVersion, { evidence }), [textVersion]);
  return { consent, textVersion, save };
}
