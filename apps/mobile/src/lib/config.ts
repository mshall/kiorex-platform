import { apiOrigin } from "./apiBase";

/** Production builds must be pointed at real services by build-time env (EAS environment variables): a missing value fails the app start loudly instead of calling localhost. */
function requiredInProduction(name: string, value: string | undefined, fallback?: string): string | undefined {
  if (process.env.EXPO_PUBLIC_ENV === "production" && !value && process.env.EXPO_PUBLIC_MOCK !== "1") throw new Error(`${name} is required for production builds (set it as an EAS environment variable)`);
  return value ?? fallback;
}

export const config = {
  apiOrigin: apiOrigin(requiredInProduction("EXPO_PUBLIC_API_URL", process.env.EXPO_PUBLIC_API_URL)),
  oidcIssuer: requiredInProduction("EXPO_PUBLIC_OIDC_ISSUER", process.env.EXPO_PUBLIC_OIDC_ISSUER, "http://localhost:4400") as string,
  oidcClientId: process.env.EXPO_PUBLIC_OIDC_CLIENT_ID ?? "kiorex-mobile",
  mock: process.env.EXPO_PUBLIC_MOCK === "1",
  // offline_access ⇒ refresh token (access tokens live ≤ 15 min; without it the patient is signed out every 15 minutes).
  oidcScopes: ["openid", "profile", "phone", "offline_access"],
};
