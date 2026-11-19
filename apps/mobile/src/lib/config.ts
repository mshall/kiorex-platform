import { apiOrigin } from "./apiBase";

export const config = {
  apiOrigin: apiOrigin(process.env.EXPO_PUBLIC_API_URL),
  oidcIssuer: process.env.EXPO_PUBLIC_OIDC_ISSUER ?? "http://localhost:4400",
  oidcClientId: process.env.EXPO_PUBLIC_OIDC_CLIENT_ID ?? "kiorex-mobile",
  mock: process.env.EXPO_PUBLIC_MOCK === "1",
  // offline_access ⇒ refresh token (access tokens live ≤ 15 min; without it the patient is signed out every 15 minutes).
  oidcScopes: ["openid", "profile", "phone", "offline_access"],
};
