import { apiOrigin } from "./apiBase";

export const config = {
  apiOrigin: apiOrigin(process.env.EXPO_PUBLIC_API_URL),
  oidcIssuer: process.env.EXPO_PUBLIC_OIDC_ISSUER ?? "http://localhost:4400",
  oidcClientId: process.env.EXPO_PUBLIC_OIDC_CLIENT_ID ?? "kiorex-mobile",
  mock: process.env.EXPO_PUBLIC_MOCK === "1",
  oidcScopes: ["openid", "profile", "phone"],
};
