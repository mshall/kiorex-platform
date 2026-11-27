# Kiorly admin (`admin.<env>.kiorly.com`)

Decision (27 Nov 2026, ADR-059 service `kiorly.admin`): **the Kiorly admin is the same Ops console (`apps/ops`) served on the Kiorly admin host.** No second app, no second API, no second Passport client. What differs is the *edition*, chosen by the host the page is loaded from:

| | Kiorex super admin (`kiorex.admin`) | Kiorly admin (`kiorly.admin`) |
|---|---|---|
| Hosts (registry) | `admin.test.kiorex.com`, ... | `admin.test.kiorly.com`, ... |
| Brand | Kiorex logo, "Kiorex Ops" | Kiorly lockup (Arabic lockup in Arabic), mark on phones, tab title "Kiorly Admin", Kiorly favicon, `noindex` |
| Views | everything | provider-product views: providers, onboarding, partner onboarding and leads, orders, fees, commissions and commission policy, finance, reconciliation, Kiorly Pay ops, payments connection, messaging, integrations, feature flags, operations, outbox |
| Not offered (nor routed; a direct URL redirects to `/providers`) | | bookings, moderation, liquidity, safety, held deposits, home-visit gate, market policy, growth and acquisition |
| Sign-in | Passport, client `kiorex-ops`, roles `ops_admin`, `super_admin`, `growth_admin`, `finance` | the same client and roles (an extra redirect URI is registered on `kiorex-ops`) |
| API | same-origin `/api/*` | same-origin `/api/*` (the Kiorex API) |

The edition is a presentation choice, never a permission: the API enforces roles on every call, so opening a Kiorex-only URL on the Kiorly host would be refused or redirected, not a bypass. Code: `apps/ops/src/lib/edition.ts` (resolution and the view list), `OpsLayout.tsx`, `App.tsx` (route gate), `components/KiorlyLogo.tsx`, `components/EditionHead.tsx`, assets `apps/ops/public/kiorly/` (the Kiorly marks, identical to the workspace brand kit).

## Configuration (generated from the registry, nothing typed)

`scripts/emit-env-from-registry.mjs` writes `VITE_KIORLY_ADMIN_HOSTS=<host of kiorly.admin>` into `.generated/env/<env>/ops.build.env`, next to `VITE_OIDC_AUTHORITY`. **One build serves both host families**: the edition follows `window.location.hostname`. A dedicated Kiorly-only build can set `VITE_OPS_EDITION=kiorly` instead. Registry additions (`_docs/registry/service-url-registry.yaml`): `kiorly.admin` status `planned` with that env var, and OIDC client `kiorex-ops-kiorly` (service `kiorly.admin`, `/auth/callback`, post-logout `/`); in Passport `scripts/lib/client-overrides.ts` it maps onto the existing `kiorex-ops` client, so `npm run client-overrides:emit -- --env test` registers both admin hosts on it.

## Hosting (not applied; founder-gated)

1. Serve the same `apps/ops` build (S3 + CloudFront, SPA fallback to `index.html`) on the Kiorly admin host: add `admin.<env>.kiorly.com` as an alias of the distribution that serves the Kiorex admin, or a second distribution with the same origin; ACM certificate of the `kiorly.com` environment zone covers it.
2. The console calls the API **same-origin**: the distribution on the Kiorly admin host needs the same behaviour as the Kiorex admin host, `/api/*` to the Kiorex API origin (no CORS entry is needed).
3. Register the Passport redirect URIs (`client-overrides:emit`), then deploy. Cookies stay host-only.
4. Security headers as for the Kiorex admin host (HSTS, `frame-ancestors 'none'`); the app already serves `noindex`.

## Tests

`npx vitest run src/__tests__/edition.test.tsx` (resolution, view list, layout per edition, head, route gate) and `npx playwright test -c playwright.kiorly.config.ts` in `apps/ops` (its own Vite server on port 5281, an injected session and `/api` answered by the test; the Kiorly host is `admin.kiorly.localhost`, which Chrome resolves to loopback).

## Open

- Whether the Kiorly admin should later get Kiorly-specific views (for example per-organisation subscription management) that do not exist in the Kiorex console: product decision; the view list in `edition.ts` is the one place to extend.
- A role split (a Kiorly-only ops role that cannot reach Kiorex-only data) would be an API and Passport change; today the same ops roles see the same data on both hosts.
