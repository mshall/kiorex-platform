import { cachedBootstrap } from "@/lib/bootstrap";
import { resolveLink } from "@/lib/deepLink";
import { setPendingRef } from "@/lib/linkRef";
import { setPendingRoute } from "@/lib/pendingRoute";

/**
 * Every incoming URL (Universal Link, App Link, kiorex:// scheme) passes through here before expo-router matches a route (GRW-P1-H).
 * The result is always an in-app path from the closed route table in lib/deepLink.ts; unknown or malicious links open Home ("/").
 * Nothing in the URL is ever followed as a redirect, and nothing here signs in, links or merges an account. A referral or provider code only becomes a
 * pending ref on the device; it is sent after consent (see lib/linkRef.ts).
 */
export async function redirectSystemPath({ path }: { path: string; initial: boolean }): Promise<string> {
  const b = await cachedBootstrap();
  const target = resolveLink(path, { liveMarkets: b?.liveMarkets, defaultMarket: b?.defaultMarket, allowInsecureLocal: __DEV__ });
  if (target.ref) await setPendingRef(target.ref);
  if (target.requiresSignIn) { setPendingRoute(target.route); return "/"; } // the link never signs anyone in: Home decides (sign-in or tabs), then the hook replays the route
  return target.route;
}
