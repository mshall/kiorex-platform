/**
 * Console edition. The same Ops console is served on two host families (ADR-059): the Kiorex super admin (`admin.<env>.kiorex.com`, registry service `kiorex.admin`)
 * and the Kiorly admin (`admin.<env>.kiorly.com`, `kiorly.admin`). Same code, same Passport client (`kiorex-ops`, one more redirect URI registered), same API, same role gate:
 * only the BRAND and the SET OF VIEWS differ. The edition is never a permission: the API enforces roles, and a hidden view is simply not offered or routed.
 *
 *   VITE_OPS_EDITION          "kiorly" | "kiorex": force the edition of a dedicated build (optional)
 *   VITE_KIORLY_ADMIN_HOSTS   comma-separated hosts of the Kiorly admin, generated from the registry (`scripts/emit-env-from-registry.mjs`); one build serves both host families
 *                             and the edition follows the host the page was loaded from. No host is typed in code.
 */
export type OpsEdition = "kiorex" | "kiorly";

export const parseHosts = (v: string | undefined): string[] => (v ?? "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);

export function resolveEdition(env: { VITE_OPS_EDITION?: string; VITE_KIORLY_ADMIN_HOSTS?: string }, hostname: string): OpsEdition {
  if (env.VITE_OPS_EDITION === "kiorly" || env.VITE_OPS_EDITION === "kiorex") return env.VITE_OPS_EDITION;
  return parseHosts(env.VITE_KIORLY_ADMIN_HOSTS).includes(hostname.toLowerCase()) ? "kiorly" : "kiorex";
}

export const OPS_EDITION: OpsEdition = resolveEdition(import.meta.env, typeof window === "undefined" ? "" : window.location.hostname);
export const isKiorly = OPS_EDITION === "kiorly";

/**
 * Views of the Kiorly admin: what concerns the provider products (clinics, pharmacies, labs): the provider directory, onboarding and leads, orders, fees,
 * commissions and commission policy, finance and payment operations, messaging, integrations, feature flags, operations and the outbox. Patient-side views
 * (bookings, moderation, liquidity, safety, held deposits, home-visit gate, market policy, growth and acquisition) stay in the Kiorex super admin.
 */
export const KIORLY_ROUTES = [
  "/providers", "/orders", "/fees", "/commissions", "/commission-policy", "/finance", "/reconciliation", "/pay-ops", "/payments-connection",
  "/messaging", "/integrations", "/onboarding", "/partner-onboarding", "/partner-leads", "/leads", "/kiorly-markets", "/kiorly-plans", "/flags", "/operations", "/outbox",
] as const;
export const KIORLY_HOME_ROUTE = "/providers";

export const pathInEdition = (edition: OpsEdition, pathname: string): boolean =>
  edition === "kiorex" || KIORLY_ROUTES.some((r) => pathname === r || pathname.startsWith(`${r}/`));
