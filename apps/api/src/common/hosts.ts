/**
 * THE ONLY runtime file of the API that may contain a network host literal (ADR-059, ENVIRONMENT_CONFIGURATION_STANDARD rule 1).
 * `test/unit/host-literals.unit.spec.ts` fails when a host literal appears anywhere else in runtime code.
 *
 * Every value resolves from an environment variable first; the literal is only the production fallback kept so existing behaviour is unchanged.
 * Deployed environments get the variables from the registry (`scripts/emit-env-from-registry.mjs`, from `_docs/registry/service-url-registry.yaml`),
 * so a non-production environment never reaches these fallbacks. Frozen event identifiers (schemas host) are not network hosts and stay where they are.
 */
const trimSlash = (s: string): string => s.replace(/\/+$/, '');
const pick = (name: string, fallback: string): string => {
  const v = process.env[name];
  return v !== undefined && v.trim() !== '' ? v.trim() : fallback;
};

/** Production fallbacks. Keep this table tiny and registry-aligned. */
export const HOST_FALLBACKS = {
  siteCanonical: 'https://kiorex.com',
  appLinkBase: 'https://kiorex.com/app',
  rxVerifyBase: 'https://kiorex.com/rx/verify',
  widgetHost: 'book.kiorex.com',
  widgetEmbed: 'https://book.kiorex.com',
  creativeCdnHost: 'cdn.kiorex.com',
  bookingLinkBase: 'https://kiorly.link',
} as const;

/** `https://<canonical site>` (SITE_CANONICAL_HOST), no trailing slash. */
export const siteCanonicalHost = (): string => trimSlash(pick('SITE_CANONICAL_HOST', HOST_FALLBACKS.siteCanonical));
/** Patient app deep-link base (PUBLIC_APP_URL). */
export const appLinkBaseUrl = (): string => pick('PUBLIC_APP_URL', HOST_FALLBACKS.appLinkBase);
/** Prescription QR verification base (RX_VERIFY_BASE_URL). */
export const rxVerifyBaseUrl = (): string => pick('RX_VERIFY_BASE_URL', HOST_FALLBACKS.rxVerifyBase);
/** Host (no scheme) the booking widget answers on in production; WIDGET_HOST overrides it in widget.config. */
export const widgetProductionHost = (): string => pick('WIDGET_PRODUCTION_HOST', HOST_FALLBACKS.widgetHost);
/** Widget embed origin default of the WIDGET_POLICY configuration (WIDGET_EMBED_HOST). */
export const widgetEmbedHost = (): string => trimSlash(pick('WIDGET_EMBED_HOST', HOST_FALLBACKS.widgetEmbed));
/** Only https host campaign creatives may be served from (CREATIVE_CDN_HOST). */
export const creativeCdnHost = (): string => pick('CREATIVE_CDN_HOST', HOST_FALLBACKS.creativeCdnHost).toLowerCase();
/** Short booking-link origin (PROVIDER_LINK_BASE_URL). */
export const bookingLinkBaseUrl = (): string => trimSlash(pick('PROVIDER_LINK_BASE_URL', HOST_FALLBACKS.bookingLinkBase));
/** Base used for placeholder example links in message templates (never delivered to a patient). */
export const sampleLinkBase = (): string => trimSlash(pick('SAMPLE_LINK_BASE_URL', siteCanonicalHost()));
