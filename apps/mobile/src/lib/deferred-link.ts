import { Platform } from "react-native";
import { parseClaimCode, parseInstallReferrer, type LinkRef } from "./deepLink";
import { setPendingRef } from "./linkRef";
import { prefs } from "./storage";

/**
 * Deferred deep linking (GRW-P1-H), token based and consent first, no device fingerprinting:
 * - Android: the Play Install Referrer carries `kxref=<p|r>.<code>` (set by the web fallback page only after the visitor allowed it). It is read ONCE on
 *   first run through expo-application (`getInstallReferrerAsync`, Android only), parsed strictly and stored as a pending ref.
 * - iOS: there is no install referrer; the web fallback page shows a claim code after consent and the person types or pastes it once on the claim screen.
 * Neither path sends anything by itself: the ref is sent by `sendPendingTouch` after growth consent.
 */
const DONE_KEY = "kx.install-referrer.done.v1";

type AppModule = { getInstallReferrerAsync?: () => Promise<string> };
function loadApplication(): AppModule | null {
  try { return require("expo-application") as AppModule; } catch { return null; } // eslint-disable-line @typescript-eslint/no-require-imports
}

export async function readInstallReferrerOnce(os: string = Platform.OS, load: () => AppModule | null = loadApplication): Promise<LinkRef | null> {
  if (os !== "android") return null;
  if ((await prefs.get(DONE_KEY)) === "1") return null;
  await prefs.set(DONE_KEY, "1"); // read once, whatever the outcome
  try {
    const raw = await load()?.getInstallReferrerAsync?.();
    const ref = parseInstallReferrer(raw);
    if (ref) await setPendingRef(ref);
    return ref;
  } catch { return null; }
}

/** The iOS first-launch claim: validates the typed code and stores it as the pending ref. */
export async function claimCode(input: string): Promise<LinkRef | null> {
  const ref = parseClaimCode(input);
  if (ref) await setPendingRef(ref);
  return ref;
}
