/**
 * The only file of the patient web app that may hold a network host literal (ADR-059). Builds override it with VITE_KIORLY_CLINICS_URL, generated
 * from the service registry; the literal is the production fallback. A unit test fails on a host literal anywhere else in runtime code.
 */
export const KIORLY_CLINICS_URL: string = (import.meta.env.VITE_KIORLY_CLINICS_URL as string | undefined)?.trim() || "https://kiorly.com";
export const hostLabel = (url: string): string => url.replace(/^https?:\/\//, "").replace(/\/+$/, "");

/** The Kiorly marketing site (provider join form). Builds override it with VITE_KIORLY_SITE_URL; the literal is the production fallback. The lead form lives there only: Kiorex links to it and never duplicates it. */
export const KIORLY_SITE_URL: string = ((import.meta.env.VITE_KIORLY_SITE_URL as string | undefined)?.trim() || "https://kiorly.com").replace(/\/+$/, "");
export const KIORLY_JOIN_URL = `${KIORLY_SITE_URL}/#join`;
