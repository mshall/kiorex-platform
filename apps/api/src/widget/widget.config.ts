import { widgetProductionHost } from '../common/hosts';
import { resolve } from 'node:path';

/**
 * Widget host runtime configuration (GRW-P1-G). Read lazily so tests can override process.env. No secret lives here.
 *
 * WIDGET_HOST      the dedicated widget host (default `book.kiorex.com`, NEEDS_HUMAN, same value as kiorex-account config/domains.json `widget`). When set, the embed,
 *                  SDK and callback routes answer 404 on every other Host header, so the patient site and the API host never serve a framable document. UNSET = local dev:
 *                  the routes answer on the API port (http://localhost:4000, the `widget` entry of domains.json `local`).
 * WIDGET_DIST      the built widget app (apps/widget/dist). WIDGET_ENABLED=false is a hard off-switch (the flag growth.widgets is the soft one).
 * WIDGET_DEV_ORIGINS  comma separated extra embedding origins (http://localhost:PORT or http://127.0.0.1:PORT), honoured ONLY when NODE_ENV and SITE_ENVIRONMENT are not
 *                  production/staging. Used by the Playwright suite, whose test host cannot be https. Ignored (and logged once) otherwise.
 */
const env = (k: string, d = ''): string => process.env[k] ?? d;
const bool = (k: string, d: boolean): boolean => (process.env[k] === undefined || process.env[k] === '' ? d : process.env[k] === 'true');

export const widgetCfg = () => {
  const nonProd = env('NODE_ENV') !== 'production' && !['production', 'staging'].includes(env('SITE_ENVIRONMENT', 'development'));
  return {
    enabled: bool('WIDGET_ENABLED', true),
    /** Host (no scheme) the widget answers on; empty = any host (local development only). */
    host: env('WIDGET_HOST', env('NODE_ENV') === 'production' ? widgetProductionHost() : '').toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, ''),
    dist: env('WIDGET_DIST', resolve(__dirname, '..', '..', '..', 'widget', 'dist')),
    nonProd,
    devOrigins: nonProd ? env('WIDGET_DEV_ORIGINS').split(',').map((s) => s.trim()).filter(Boolean) : [],
    /** The sandbox demo page may frame the widget from the widget host itself (own, static page: nothing else can ever be served on that origin). */
    sandbox: bool('WIDGET_SANDBOX', true),
    /** Passport (OIDC) client of the widget: registered in kiorex-account config/idp.json (`kiorex-widget`). */
    oidcAuthority: env('OIDC_ISSUER', 'http://localhost:4400').replace(/\/+$/, ''),
    oidcClientId: env('WIDGET_OIDC_CLIENT_ID', 'kiorex-widget'),
    /** Patient web origin for the confirmation deep link (the app link fallback pages live on it, package H). */
    patientUrl: env('WEB_BASE_URL', 'http://localhost:5180').replace(/\/+$/, ''),
  };
};
