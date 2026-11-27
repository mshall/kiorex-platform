import { apiOrigin } from "./apiBase";

/** Every release build (kx-test, pilot, production: anything that is not a dev-server build) must be pointed at real services by build-time env (a config/env profile or EAS environment variables):
 *  a missing value fails the app start loudly instead of calling localhost or a relative URL. */
function requiredInProduction(name: string, value: string | undefined, fallback?: string): string | undefined {
  const release = process.env.EXPO_PUBLIC_ENV === "production" || !__DEV__;
  if (release && !value && process.env.EXPO_PUBLIC_MOCK !== "1") throw new Error(`${name} is required for release builds (use a config/env profile: node scripts/with-env.mjs test -- ..., or set it as an EAS environment variable)`);
  return value ?? fallback;
}

export const config = {
  apiOrigin: apiOrigin(requiredInProduction("EXPO_PUBLIC_API_URL", process.env.EXPO_PUBLIC_API_URL)),
  // a local Passport only in development; the production export folds it away (check:dev-test-users)
  oidcIssuer: requiredInProduction("EXPO_PUBLIC_OIDC_ISSUER", process.env.EXPO_PUBLIC_OIDC_ISSUER, __DEV__ ? "http://localhost:4400" : undefined) as string,
  oidcClientId: process.env.EXPO_PUBLIC_OIDC_CLIENT_ID ?? "kiorex-mobile",
  mock: process.env.EXPO_PUBLIC_MOCK === "1",
  // offline_access ⇒ refresh token (access tokens live ≤ 15 min; without it the patient is signed out every 15 minutes).
  oidcScopes: ["openid", "profile", "phone", "email", "offline_access"],
};
