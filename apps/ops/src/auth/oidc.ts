import { UserManager, WebStorageStateStore, type User } from "oidc-client-ts";

export const oidcConfig = {
  authority: import.meta.env.VITE_OIDC_AUTHORITY ?? "http://localhost:4400",
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
export const getManager = () => (manager ??= new UserManager(oidcConfig));

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
