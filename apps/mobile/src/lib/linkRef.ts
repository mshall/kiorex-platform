import { config } from "./config";
import { getGrowthConsent } from "./growthConsent";
import type { LinkRef } from "./deepLink";
import { prefs } from "./storage";

/**
 * Pending acquisition reference from a deep link, an install referrer or a claim code. It is a PUBLIC link code (no person, no device identifier),
 * held on the device for at most 30 days. It is sent to POST /growth/v1/touch only after the person granted growth consent; a decline discards it.
 * Codes are never logged.
 */
const KEY = "kx.link.pending.v1";
const TTL_MS = 30 * 24 * 3600_000;

export async function setPendingRef(ref: LinkRef, now = Date.now()) { await prefs.set(KEY, JSON.stringify({ ...ref, at: now })); }
export async function getPendingRef(now = Date.now()): Promise<LinkRef | null> {
  try {
    const o = JSON.parse((await prefs.get(KEY)) ?? "null") as (LinkRef & { at: number }) | null;
    if (!o || typeof o.at !== "number" || now - o.at > TTL_MS || (o.kind !== "referral" && o.kind !== "provider") || typeof o.code !== "string") return null;
    return { kind: o.kind, code: o.code };
  } catch { return null; }
}
export async function clearPendingRef() { await prefs.set(KEY, ""); }

/** Body of POST /growth/v1/touch for a ref (landing kinds from the contract). */
export const touchBody = (ref: LinkRef) => ({ landingKind: ref.kind === "provider" ? "PROVIDER_LINK" : "REFERRAL", ref: ref.code });

/** Sends the pending ref once if (and only if) consent is granted. Returns what happened so tests and screens can react; never throws. */
export async function sendPendingTouch(fetchImpl: typeof fetch = fetch): Promise<"sent" | "no-consent" | "none" | "retry"> {
  const ref = await getPendingRef();
  if (!ref) return "none";
  if ((await getGrowthConsent()) !== "granted") return "no-consent";
  try {
    const res = await fetchImpl(`${config.apiOrigin}/api/v1/growth/v1/touch`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(touchBody(ref)) });
    if (res.status >= 500 || res.status === 429) return "retry";
    await clearPendingRef(); // accepted, or rejected as unknown/invalid: either way never resend
    return "sent";
  } catch { return "retry"; }
}
