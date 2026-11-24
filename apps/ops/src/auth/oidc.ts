import { UserManager, WebStorageStateStore, type User } from "oidc-client-ts";

export const oidcConfig = {
  // the local Passport is a development default only: a production build never falls back to a local address (the build-time env must name Passport; check-production-bundles.mjs fails on a localhost URL)
  authority: import.meta.env.VITE_OIDC_AUTHORITY ?? (import.meta.env.DEV ? "http://localhost:4400" : ""),
  client_id: import.meta.env.VITE_OIDC_CLIENT_ID ?? "kiorex-ops",
  redirect_uri: `${window.location.origin}/auth/callback`,
  post_logout_redirect_uri: `${window.location.origin}/`,
  response_type: "code",
  scope: "openid profile",
  automaticSilentRenew: true,
  loadUserInfo: false,
  userStore: new WebStorageStateStore({ store: window.sessionStorage }),
};

let manager: UserManager | null = null;
export const getManager = () => {
  if (!oidcConfig.authority) throw new Error("VITE_OIDC_AUTHORITY is not set: this build has no Passport to sign in with");
  return (manager ??= new UserManager(oidcConfig));
};

export type AuthUser = { sub: string; name?: string; token: string; roles: string[] };

/** Roles live in the access token (`kx_roles`, INTEGRATION.md); the id token may not carry them. UI-only: the API enforces roles. */
export function rolesFromToken(token: string): string[] {
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))) as { kx_roles?: string[] };
    return payload.kx_roles ?? [];
  } catch { return []; }
}

export const toAuthUser = (u: User): AuthUser => ({
  sub: u.profile.sub,
  name: (u.profile.name as string | undefined) ?? undefined,
  token: u.access_token,
  roles: [...new Set([...(((u.profile as Record<string, unknown>).kx_roles as string[] | undefined) ?? []), ...rolesFromToken(u.access_token)])],
});
