/**
 * THE ONLY runtime file of the API that may contain a network host literal (ADR-059, ENVIRONMENT_CONFIGURATION_STANDARD rule 1).
 * `test/unit/host-literals.unit.spec.ts` fails when a host literal appears anywhere else in runtime code.
 *
 * Every value resolves from an environment variable first; the literal is only the production fallback kept so existing behaviour is unchanged.
 * Deployed environments get the variables from the registry (`scripts/emit-env-from-registry.mjs`, from `_docs/registry/service-url-registry.yaml`),
 * so a non-production environment never reaches these fallbacks: outside local (KX_ENV test, staging, pilot or prod) `assertHostConfig()` refuses to boot
 * while any variable of HOST_ENV_VARS is unset, unless ALLOW_HOST_DEFAULTS=true is set explicitly (a documented, logged escape hatch). Frozen event identifiers (schemas host) are not network hosts and stay where they are.
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

/** The environment variable behind each production fallback. All of them must be set outside local (fail closed), because a missing one would silently send a test or pilot environment to production hosts. */
export const HOST_ENV_VARS = ['SITE_CANONICAL_HOST', 'PUBLIC_APP_URL', 'RX_VERIFY_BASE_URL', 'WIDGET_PRODUCTION_HOST', 'WIDGET_EMBED_HOST', 'CREATIVE_CDN_HOST', 'PROVIDER_LINK_BASE_URL'] as const;
/** Registry environment ids that are not local: they must carry every host variable. `dev` is the local developer plane and keeps the fallbacks. */
export const STRICT_HOST_ENVS = ['test', 'staging', 'pilot', 'prod'] as const;
const LOCAL_HOST_ENVS = ['', 'local', 'dev'];

export type HostConfigState = { env: string; strict: boolean; unknownEnv: boolean; missing: string[]; allowDefaults: boolean };

/** Pure inspection of the host configuration; never prints a value. */
export function inspectHostConfig(env: Record<string, string | undefined> = process.env): HostConfigState {
  const kx = (env.KX_ENV ?? '').trim().toLowerCase();
  const strict = (STRICT_HOST_ENVS as readonly string[]).includes(kx);
  const unknownEnv = !strict && !LOCAL_HOST_ENVS.includes(kx);
  const missing = strict || unknownEnv ? HOST_ENV_VARS.filter((n) => (env[n] ?? '').trim() === '') : [];
  return { env: kx || 'local', strict, unknownEnv, missing: [...missing], allowDefaults: (env.ALLOW_HOST_DEFAULTS ?? '').trim().toLowerCase() === 'true' };
}

/**
 * Boot guard (fail closed outside local). Logs the missing NAMES (never values) and throws unless ALLOW_HOST_DEFAULTS=true. An unrecognised KX_ENV
 * value (a typo such as "production") is treated like a strict environment so a misspelt tag cannot reopen the production fallbacks.
 */
export function assertHostConfig(env: Record<string, string | undefined> = process.env, log: (m: string) => void = (m) => console.error(m)): HostConfigState {
  const s = inspectHostConfig(env);
  if (!s.missing.length) return s;
  const names = s.missing.join(', ');
  if (s.allowDefaults) {
    log(`WARNING host configuration: KX_ENV=${s.env} is missing ${names}; ALLOW_HOST_DEFAULTS=true so the production host fallbacks are used (not for a real test, pilot or production environment)`);
    return s;
  }
  log(`FATAL host configuration: KX_ENV=${s.env}${s.unknownEnv ? ' (not a known environment id)' : ''} requires ${names} to be set; generate them with scripts/emit-env-from-registry.mjs, or set ALLOW_HOST_DEFAULTS=true to accept the production fallbacks knowingly`);
  throw new Error(`Refusing to start: host variables not set for KX_ENV=${s.env}: ${names} (ALLOW_HOST_DEFAULTS=true overrides)`);
}
