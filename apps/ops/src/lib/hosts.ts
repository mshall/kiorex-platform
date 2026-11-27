/**
 * The only file of the ops console that may hold a network host literal (ADR-059). Builds override it with VITE_SITE_CANONICAL_HOST, generated from
 * the service registry; the literal is the production fallback used only for the campaign link preview.
 */
export const SITE_CANONICAL_HOST: string = (import.meta.env.VITE_SITE_CANONICAL_HOST as string | undefined)?.trim() || "https://kiorex.com";
